import { db } from "@/lib/db";
import type { StoredSummary } from "@/lib/validation/summary";

export type BatchView = {
  id: string;
  status: string;
  createdAt: string;
  receipts: {
    id: string;
    fileName: string;
    status: string;
    merchant: string | null;
    date: string | null;
    totalMinor: number | null;
    currency: string | null;
    // Why the last attempt failed, while it is being retried or after it gave up.
    lastError: string | null;
    attempts: number;
  }[];
  summary: { source: string; modelId: string | null; data: StoredSummary } | null;
};

// One read shape for both the API and the page. Scoped to the owner: another user's batch id
// returns null, the same as a batch that doesn't exist.
export async function getBatchView(batchId: string, userId: string): Promise<BatchView | null> {
  const batch = await db.batch.findFirst({
    where: { id: batchId, userId },
    include: {
      receipts: { orderBy: { createdAt: "asc" }, include: { jobs: { select: { attempts: true, lastError: true } } } },
      summary: true,
    },
  });
  if (!batch) return null;

  return {
    id: batch.id,
    status: batch.status,
    createdAt: batch.createdAt.toISOString(),
    receipts: batch.receipts.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      status: r.status,
      merchant: r.merchant,
      date: r.receiptDate ? r.receiptDate.toISOString().slice(0, 10) : null,
      totalMinor: r.totalMinor,
      currency: r.currency,
      lastError: r.jobs[0]?.lastError ?? null,
      attempts: r.jobs[0]?.attempts ?? 0,
    })),
    summary: batch.summary
      ? { source: batch.summary.source, modelId: batch.summary.modelId, data: batch.summary.summaryJson as unknown as StoredSummary }
      : null,
  };
}
