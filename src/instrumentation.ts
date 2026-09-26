// Runs once when a Next.js server instance starts. The worker needs Node APIs (fs, crypto,
// Postgres), so it is only imported in the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/lib/jobs/worker");
    startWorker();
  }
}
