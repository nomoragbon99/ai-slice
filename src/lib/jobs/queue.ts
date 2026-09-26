import { aiConfig } from "@/config/ai";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type JobKind = keyof typeof aiConfig.jobs.concurrency;
export type Tx = Prisma.TransactionClient;

export type ClaimedJob = {
  id: string;
  kind: JobKind;
  batchId: string;
  receiptId: string | null;
  // The attempt number THIS claim holds. Used as the fencing value when finishing: if the lease
  // expired and another worker re-claimed the job, attempts moved on and our finish is ignored.
  attempts: number;
  maxAttempts: number;
};

const MAX_ERROR_LENGTH = 500;

export function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}

// Claims up to (concurrency cap - jobs already running) jobs of one kind, in one transaction.
//
// The cap is enforced by the DATABASE, not by a counter in memory: a per-kind advisory lock makes
// "count running, then claim" atomic, so two workers (or two dev-server instances) can't both see
// a free slot and exceed the cap together. FOR UPDATE SKIP LOCKED lets them claim different rows.
//
// A job is claimable if it is queued and its backoff has passed, OR it is 'running' but its lease
// has expired (the worker that held it died, e.g. a server restart mid-call). Claiming bumps
// attempts, so a crash still uses up an attempt and a poison job can't loop forever.
//
// Abandoned jobs that have already used every attempt are returned separately so the caller can
// apply the final-failure fallback to them.
export async function claimJobs(kind: JobKind): Promise<{ claimed: ClaimedJob[]; abandoned: ClaimedJob[] }> {
  const cap = aiConfig.jobs.concurrency[kind];
  const leaseMs = aiConfig.jobs.leaseMs;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`jobs:claim:${kind}`}, 0))) AS l`;

    const abandoned = await tx.$queryRaw<RawJob[]>`
      UPDATE jobs
      SET status = 'failed', locked_until = NULL, updated_at = now(),
          last_error = coalesce(last_error || ' | ', '') || 'lease expired on final attempt (worker stopped mid-job)'
      WHERE kind = ${kind} AND status = 'running' AND locked_until <= now() AND attempts >= max_attempts
      RETURNING id, kind, batch_id, receipt_id, attempts, max_attempts
    `;

    const [{ running }] = await tx.$queryRaw<{ running: number }[]>`
      SELECT count(*)::int AS running FROM jobs
      WHERE kind = ${kind} AND status = 'running' AND locked_until > now()
    `;
    const slots = cap - running;
    if (slots <= 0) return { claimed: [], abandoned: abandoned.map(toClaimed) };

    const claimed = await tx.$queryRaw<RawJob[]>`
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, updated_at = now(),
          locked_until = now() + (${leaseMs}::double precision * interval '1 millisecond')
      WHERE id IN (
        SELECT id FROM jobs
        WHERE kind = ${kind} AND attempts < max_attempts
          AND ((status = 'queued' AND run_after <= now()) OR (status = 'running' AND locked_until <= now()))
        ORDER BY run_after, created_at
        LIMIT ${slots}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind, batch_id, receipt_id, attempts, max_attempts
    `;
    return { claimed: claimed.map(toClaimed), abandoned: abandoned.map(toClaimed) };
  });
}

type RawJob = {
  id: string;
  kind: string;
  batch_id: string;
  receipt_id: string | null;
  attempts: number;
  max_attempts: number;
};

function toClaimed(row: RawJob): ClaimedJob {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    batchId: row.batch_id,
    receiptId: row.receipt_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

// Marks the job finished ONLY if this claim still owns it. Returns false if the lease was lost,
// in which case the caller's transaction must write nothing else (the other claimant owns it now).
// With retryDelayMs, the job becomes claimable again that long from now by the DATABASE clock, the
// same clock claimJobs compares against, so app/database clock skew can't shorten or stretch backoff.
export async function fencedFinish(
  tx: Tx,
  job: ClaimedJob,
  data: Prisma.JobUpdateManyMutationInput,
  retryDelayMs?: number,
): Promise<boolean> {
  const result = await tx.job.updateMany({
    where: { id: job.id, status: "running", attempts: job.attempts },
    data: { ...data, lockedUntil: null },
  });
  if (result.count !== 1) return false;
  if (retryDelayMs !== undefined) {
    await tx.$executeRaw`
      UPDATE jobs SET run_after = now() + (${retryDelayMs}::double precision * interval '1 millisecond') WHERE id = ${job.id}::uuid
    `;
  }
  return true;
}

// A failed attempt with attempts left goes back to the queue after a growing delay.
export function retryDelayMs(attempts: number): number {
  return aiConfig.jobs.retryBackoffMs * attempts;
}
