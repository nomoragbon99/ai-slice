// Proves jobs.attempt_errors keeps every failed attempt, including after a later success and when a
// worker dies mid-attempt. Drives the real queue functions against the database; no model calls.
// Uses its own throwaway batch and deletes it afterwards.
// STOP the dev server first (its worker would claim the test job).
// Run with: npm run check:attempt-errors
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { claimJobs, fencedFinish } from "../src/lib/jobs/queue";

type AttemptError = { attempt: number; at: string; error: string };

async function errorsOf(jobId: string): Promise<AttemptError[]> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  return job.attemptErrors as AttemptError[];
}

async function claimOne(jobId: string) {
  const { claimed } = await claimJobs("extract");
  const job = claimed.find((j) => j.id === jobId);
  assert.ok(job, "test job was not claimed");
  return job;
}

async function main() {
  const busy = await db.job.count({ where: { kind: "extract", status: { in: ["queued", "running"] } } });
  assert.equal(busy, 0, "other extract jobs are queued/running; stop the dev server first");

  const user = await db.user.findFirstOrThrow();
  const batch = await db.batch.create({ data: { userId: user.id } });
  try {
    const receipt = await db.receipt.create({
      data: {
        batchId: batch.id,
        storageKey: `receipts/attempt-errors-check-${batch.id}.png`,
        mimeType: "image/png",
        sizeBytes: 1,
        fileName: "check.png",
        jobs: { create: { kind: "extract", batchId: batch.id, maxAttempts: 3 } },
      },
      include: { jobs: true },
    });
    const jobId = receipt.jobs[0].id;

    // Attempt 1 fails (retryable), attempt 2 succeeds.
    let job = await claimOne(jobId);
    await db.$transaction((tx) =>
      fencedFinish(tx, job, { status: "queued", lastError: "503 attempt one" }, { retryDelayMs: 0, attemptError: "503 attempt one" }),
    );
    job = await claimOne(jobId);
    await db.$transaction((tx) => fencedFinish(tx, job, { status: "succeeded", lastError: null, rawResponse: null }));

    let errors = await errorsOf(jobId);
    const done = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(done.status, "succeeded");
    assert.equal(done.lastError, null);
    assert.deepEqual(errors.map((e) => [e.attempt, e.error]), [[1, "503 attempt one"]]);
    assert.ok(!Number.isNaN(Date.parse(errors[0].at)), "each entry is timestamped");
    console.log("ok  failure before success is kept after the job succeeds");

    // A worker dies mid-attempt: the lease expires and the job is re-claimed.
    await db.job.update({ where: { id: jobId }, data: { status: "queued", attempts: 0, attemptErrors: [] } });
    job = await claimOne(jobId);
    await db.$executeRaw`UPDATE jobs SET locked_until = now() - interval '1 second' WHERE id = ${jobId}::uuid`;
    job = await claimOne(jobId);
    await db.$transaction((tx) =>
      fencedFinish(tx, job, { status: "queued", lastError: "400 attempt two" }, { retryDelayMs: 0, attemptError: "400 attempt two" }),
    );
    errors = await errorsOf(jobId);
    assert.deepEqual(errors.map((e) => [e.attempt, e.error]), [
      [1, "lease expired (worker stopped mid-job)"],
      [2, "400 attempt two"],
    ]);
    console.log("ok  an attempt lost to a dead worker is recorded, in order");

    // A stale worker (lost its lease) must not append anything.
    const stale = { ...job };
    job = await claimOne(jobId);
    const wrote = await db.$transaction((tx) => fencedFinish(tx, stale, { status: "failed" }, { attemptError: "stale" }));
    assert.equal(wrote, false);
    assert.equal((await errorsOf(jobId)).length, 2);
    console.log("ok  a worker that lost its claim appends nothing");
  } finally {
    await db.batch.delete({ where: { id: batch.id } }); // cascades to receipts and jobs
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
