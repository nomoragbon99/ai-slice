// Proves the concurrency cap is enforced by the database: two workers claiming at the same moment
// can't exceed it together. Uses its own throwaway batch and deletes it afterwards.
// STOP the dev server first (its worker would claim the test jobs).
// Run with: npm run check:concurrency
import assert from "node:assert/strict";
import { aiConfig } from "../src/config/ai";
import { db } from "../src/lib/db";
import { claimJobs } from "../src/lib/jobs/queue";

const JOBS = 5;

async function main() {
  const cap = aiConfig.jobs.concurrency.extract;
  const busy = await db.job.count({ where: { kind: "extract", status: { in: ["queued", "running"] } } });
  assert.equal(busy, 0, "other extract jobs are queued/running; stop the dev server and let them finish first");

  const user = await db.user.findFirstOrThrow();
  const batch = await db.batch.create({ data: { userId: user.id } });
  try {
    for (let i = 0; i < JOBS; i++) {
      await db.receipt.create({
        data: {
          batchId: batch.id,
          storageKey: `receipts/concurrency-check-${batch.id}-${i}.png`,
          mimeType: "image/png",
          sizeBytes: 1,
          fileName: `check-${i}.png`,
          jobs: { create: { kind: "extract", batchId: batch.id, maxAttempts: 3 } },
        },
      });
    }

    // Two "workers" claim simultaneously.
    const [a, b] = await Promise.all([claimJobs("extract"), claimJobs("extract")]);
    const total = a.claimed.length + b.claimed.length;
    console.log(`worker A claimed ${a.claimed.length}, worker B claimed ${b.claimed.length} (cap ${cap}, ${JOBS} queued)`);
    assert.equal(total, cap, "together they must claim exactly the cap");
    assert.equal(new Set([...a.claimed, ...b.claimed].map((j) => j.id)).size, total, "no job claimed twice");

    const again = await claimJobs("extract");
    assert.equal(again.claimed.length, 0, "no slots left while the cap is full");
    console.log("third claim while full: 0");
    console.log("ok  concurrency cap holds across competing workers");
  } finally {
    await db.batch.delete({ where: { id: batch.id } }); // cascades to receipts and jobs
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
