"use client";

import { useEffect, useState } from "react";
import { aiConfig } from "@/config/ai";
import type { BatchView } from "@/lib/batches";
import { formatMoney } from "@/lib/money";

const RECEIPT_STATUS_LABEL: Record<string, string> = {
  pending: "Reading…",
  extracted: "Read",
  failed: "Couldn't be read",
};

// Re-fetches the batch until the summary exists. The server rendered the first state, so the
// page is complete without JavaScript; this only keeps it live.
export function BatchStatus({ initial }: { initial: BatchView }) {
  const [view, setView] = useState(initial);
  const [pollError, setPollError] = useState(false);

  useEffect(() => {
    if (view.status === "done") return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/batches/${view.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        setView(await response.json());
        setPollError(false);
      } catch {
        // Keep polling; say so rather than freezing silently.
        setPollError(true);
        setView((v) => ({ ...v }));
      }
    }, aiConfig.status.pollIntervalMs);
    return () => clearTimeout(timer);
  }, [view]);

  const summary = view.summary;
  const categoryOf = new Map(summary?.data.receipts.map((r) => [r.receiptId, r]) ?? []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">
        {view.status === "done" ? "Expense summary" : view.status === "summarising" ? "Summarising…" : "Reading receipts…"}
      </h1>
      {pollError && (
        <p role="status" className="text-sm text-[var(--slate)]">
          Lost contact with the server; still retrying.
        </p>
      )}

      {summary && (
        <section className="flex flex-col gap-3">
          {summary.source === "fallback" && (
            <p role="status" className="rounded-md border border-[var(--line)] bg-[var(--mist)] px-3 py-2 text-sm">
              Partial result: automatic categorisation wasn&apos;t available.
            </p>
          )}
          <p className="text-[15px]">{summary.data.overview}</p>
          {summary.data.totals.length > 0 && (
            <table className="tnum w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[var(--slate)]">
                  <th className="py-1.5 font-normal">Category</th>
                  <th className="py-1.5 font-normal">Receipts</th>
                  <th className="py-1.5 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.totals.map((t) => (
                  <tr key={`${t.category}-${t.currency}`} className="border-b border-[var(--line)]">
                    <td className="py-1.5">{t.category}</td>
                    <td className="py-1.5">{t.receiptCount}</td>
                    <td className="py-1.5 text-right">{formatMoney(t.totalMinor, t.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Receipts</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {view.receipts.map((r) => {
            const cat = categoryOf.get(r.id);
            return (
              <li key={r.id} className="rounded-md border border-[var(--line)] px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{r.merchant ?? r.fileName}</span>
                  <span className="tnum">
                    {r.totalMinor !== null && r.currency ? formatMoney(r.totalMinor, r.currency) : RECEIPT_STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="text-[var(--slate)]">
                  {[r.date, cat && `${cat.category}: ${cat.reason}`].filter(Boolean).join(" · ")}
                  {r.status === "pending" && r.attempts > 1 && ` Retrying (attempt ${r.attempts}).`}
                  {r.status === "failed" && " Left out of the totals."}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
