import { aiConfig } from "@/config/ai";
import { db } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { extractReceiptText } from "@/lib/ai/gemini";
import { summariseText } from "@/lib/ai/deepseek";
import { isRetryableProviderError } from "@/lib/ai/errors";
import { parseExtraction } from "@/lib/validation/extraction";
import {
  buildSummary,
  parseModelSummary,
  type StoredSummary,
  type SummaryInputReceipt,
} from "@/lib/validation/summary";
import { errorText, fencedFinish, retryDelayMs, type ClaimedJob, type Tx } from "./queue";

// Each job runs in three phases:
//   1. do the slow work (model call + validation) OUTSIDE any transaction, so no DB lock is held
//      while waiting on a provider;
//   2. in one transaction, fence on the claim and write the outcome (result, retry, or fallback);
//   3. after commit, move the batch forward if this settled a receipt.

// retryable: false unless the failure is one that can clear by itself (src/lib/ai/errors.ts).
// Invalid model output is not retried: temperature is low, so the same input gives the same answer.
type Outcome<T> = { ok: true; value: T } | { ok: false; error: string; retryable?: boolean };

async function attempt<T>(work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await work();
  } catch (error) {
    // Timeouts, network errors, missing key, provider 4xx/5xx: all end up here as one error text.
    return { ok: false, error: errorText(error), retryable: isRetryableProviderError(error) };
  }
}

function failureUpdate(job: ClaimedJob, outcome: { error: string; retryable?: boolean }) {
  const error = outcome.retryable ? outcome.error : `${outcome.error} (not retried)`;
  const final = !outcome.retryable || job.attempts >= job.maxAttempts;
  return {
    final,
    data: { status: final ? "failed" : "queued", lastError: error },
    // Retry time is set from the database clock inside fencedFinish.
    delay: final ? undefined : retryDelayMs(job.attempts),
  };
}

// ───────── extract: one receipt image -> validated structured receipt (Gemini, vision) ─────────

export async function runExtract(job: ClaimedJob): Promise<void> {
  const receipt = await db.receipt.findUniqueOrThrow({ where: { id: job.receiptId! } });

  const outcome = await attempt(async () => {
    const image = await getObject(receipt.storageKey);
    const text = await extractReceiptText(image, receipt.mimeType);
    const parsed = parseExtraction(text);
    return parsed.ok ? parsed : { ok: false as const, error: `invalid extraction: ${parsed.error}` };
  });

  let settled = false;
  await db.$transaction(async (tx) => {
    if (outcome.ok) {
      const v = outcome.value;
      if (!(await fencedFinish(tx, job, { status: "succeeded", lastError: null }))) return;
      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: "extracted",
          extractedJson: v,
          merchant: v.merchant,
          receiptDate: v.date ? new Date(`${v.date}T00:00:00Z`) : null,
          totalMinor: v.totalMinor,
          currency: v.currency,
        },
      });
      settled = true;
      return;
    }
    const { final, data, delay } = failureUpdate(job, outcome);
    if (!(await fencedFinish(tx, job, data, delay))) return;
    if (final) {
      await markReceiptUnreadable(tx, receipt.id);
      settled = true;
    }
  });

  if (settled) await queueSummaryIfReady(job.batchId);
}

// Fallback for a receipt that never extracted: it is kept, shown as unreadable, and left out of
// every total (never guessed at).
async function markReceiptUnreadable(tx: Tx, receiptId: string) {
  await tx.receipt.update({ where: { id: receiptId }, data: { status: "failed" } });
}

// Once no receipt in the batch is still pending, queue exactly one summarise job. Safe to call
// concurrently (the last two receipts can finish at the same moment): the batch-level advisory lock
// serialises the check, and dedupe_key makes a second insert a no-op anyway.
export async function queueSummaryIfReady(batchId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`batch:${batchId}`}, 0))) AS l`;
    const pending = await tx.receipt.count({ where: { batchId, status: "pending" } });
    if (pending > 0) return;
    await tx.job.createMany({
      data: [
        {
          kind: "summarise",
          batchId,
          dedupeKey: `summarise:${batchId}`,
          maxAttempts: aiConfig.jobs.maxAttempts.summarise,
        },
      ],
      skipDuplicates: true,
    });
    await tx.batch.updateMany({ where: { id: batchId, status: "extracting" }, data: { status: "summarising" } });
  });
}

// ───────── summarise: validated receipts -> categorised summary (DeepSeek, text only) ─────────

async function loadSummaryInputs(batchId: string) {
  const receipts = await db.receipt.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
  const inputs: SummaryInputReceipt[] = receipts
    .filter((r) => r.status === "extracted")
    .map((r) => {
      const v = r.extractedJson as { lineItems: SummaryInputReceipt["lineItems"] };
      return {
        id: r.id,
        merchant: r.merchant,
        date: r.receiptDate ? r.receiptDate.toISOString().slice(0, 10) : null,
        currency: r.currency!,
        totalMinor: r.totalMinor!,
        lineItems: v.lineItems,
      };
    });
  const excluded = receipts.filter((r) => r.status === "failed").map((r) => r.id);
  return { inputs, excluded };
}

// Fallback summary, built without any model: every readable receipt under "Other", totals still
// exact (they never came from the model anyway). The batch always finishes with a usable result.
function fallbackSummary(inputs: SummaryInputReceipt[], excluded: string[], why: string): StoredSummary {
  return buildSummary(
    inputs,
    inputs.map((r) => ({ receiptId: r.id, category: "Other" as const, reason: "Not categorised automatically." })),
    why,
    excluded,
  );
}

async function writeSummary(tx: Tx, batchId: string, summary: StoredSummary, modelId: string | null) {
  await tx.summary.create({
    data: { batchId, summaryJson: summary, source: modelId ? "model" : "fallback", modelId },
  });
  await tx.batch.update({ where: { id: batchId }, data: { status: "done" } });
}

export async function runSummarise(job: ClaimedJob): Promise<void> {
  const { inputs, excluded } = await loadSummaryInputs(job.batchId);

  // Nothing readable: no model call is worth making.
  if (inputs.length === 0) {
    await db.$transaction(async (tx) => {
      if (!(await fencedFinish(tx, job, { status: "succeeded", lastError: null }))) return;
      await writeSummary(tx, job.batchId, fallbackSummary(inputs, excluded, "None of the receipts could be read, so there is nothing to summarise."), null);
    });
    return;
  }

  const outcome = await attempt(async () => {
    const text = await summariseText(inputs);
    const parsed = parseModelSummary(text, inputs.map((r) => r.id));
    return parsed.ok ? parsed : { ok: false as const, error: `invalid summary: ${parsed.error}` };
  });

  await db.$transaction(async (tx) => {
    if (outcome.ok) {
      if (!(await fencedFinish(tx, job, { status: "succeeded", lastError: null }))) return;
      const categorisation = outcome.value.receipts.map((r) => ({ receiptId: r.receipt_id, category: r.category, reason: r.reason }));
      await writeSummary(tx, job.batchId, buildSummary(inputs, categorisation, outcome.value.overview, excluded), aiConfig.summary.model);
      return;
    }
    const { final, data, delay } = failureUpdate(job, outcome);
    if (!(await fencedFinish(tx, job, data, delay))) return;
    if (final) await writeSummary(tx, job.batchId, fallbackSummaryText(inputs, excluded), null);
  });
}

function fallbackSummaryText(inputs: SummaryInputReceipt[], excluded: string[]) {
  return fallbackSummary(
    inputs,
    excluded,
    "Automatic categorisation was unavailable, so every receipt is listed under Other. The totals are still exact.",
  );
}

// ───────── jobs whose worker died on their final attempt ─────────

export async function applyAbandonedFallback(job: ClaimedJob): Promise<void> {
  // claimJobs already marked the job failed; apply the same fallback a normal final failure gets.
  if (job.kind === "extract") {
    await db.receipt.updateMany({ where: { id: job.receiptId!, status: "pending" }, data: { status: "failed" } });
    await queueSummaryIfReady(job.batchId);
    return;
  }
  const { inputs, excluded } = await loadSummaryInputs(job.batchId);
  await db.$transaction(async (tx) => {
    const existing = await tx.summary.findUnique({ where: { batchId: job.batchId } });
    if (!existing) await writeSummary(tx, job.batchId, fallbackSummaryText(inputs, excluded), null);
  });
}
