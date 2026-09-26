import { aiConfig } from "@/config/ai";
import { claimJobs, type ClaimedJob, type JobKind } from "./queue";
import { applyAbandonedFallback, runExtract, runSummarise } from "./handlers";

// In-process worker, started once per server from src/instrumentation.ts. All state that matters
// (what is queued, running, retried, failed) lives in the jobs table, so a restart loses nothing:
// the new process re-claims anything whose lease expired.

const RUNNERS: Record<JobKind, (job: ClaimedJob) => Promise<void>> = {
  extract: runExtract,
  summarise: runSummarise,
};

const globalForWorker = globalThis as unknown as { receiptWorkerStarted?: boolean };

export function startWorker(): void {
  // Dev hot-reload re-evaluates modules; this flag keeps it to one polling loop per process.
  if (globalForWorker.receiptWorkerStarted) return;
  globalForWorker.receiptWorkerStarted = true;
  console.log("[worker] started");
  void loop();
}

async function loop(): Promise<void> {
  for (;;) {
    for (const kind of Object.keys(RUNNERS) as JobKind[]) {
      try {
        const { claimed, abandoned } = await claimJobs(kind);
        for (const job of abandoned) void safely(`abandoned ${job.kind} ${job.id}`, () => applyAbandonedFallback(job));
        // Not awaited: jobs run concurrently; the database-enforced cap decides how many.
        for (const job of claimed) void safely(`${job.kind} ${job.id} attempt ${job.attempts}`, () => RUNNERS[kind](job));
      } catch (error) {
        // e.g. database briefly unreachable: log and try again next tick, never crash the server.
        console.error(`[worker] claim ${kind} failed:`, error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, aiConfig.jobs.pollIntervalMs));
  }
}

async function safely(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    // A handler that throws past its own error handling (e.g. DB down while writing the outcome)
    // leaves the job 'running'; its lease expires and it is re-claimed, so nothing is lost.
    console.error(`[worker] ${label} crashed:`, error);
  }
}
