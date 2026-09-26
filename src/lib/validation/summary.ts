import { z } from "zod";
import { aiConfig, EXPENSE_CATEGORIES, type ExpenseCategory } from "@/config/ai";

// What Gemini is asked for: a category per receipt and a short overview. It is NOT asked for any
// totals: arithmetic is done in code (buildSummary), so a model can never produce a wrong sum.
export const modelSummarySchema = z.object({
  receipts: z.array(
    z.object({
      receipt_id: z.string(),
      category: z.enum(EXPENSE_CATEGORIES),
      // One short reason, shown next to the receipt.
      reason: z.string().trim().min(1).max(200),
    }),
  ),
  overview: z.string().trim().min(1).max(aiConfig.summary.maxOverviewLength),
});
export type ModelSummary = z.infer<typeof modelSummarySchema>;

// JSON Schema sent to Gemini as responseJsonSchema, derived from the Zod schema above so the two
// can never drift apart.
export const modelSummaryJsonSchema = z.toJSONSchema(modelSummarySchema);

export type SummaryInputReceipt = {
  id: string;
  merchant: string | null;
  date: string | null;
  currency: string;
  totalMinor: number;
  lineItems: { description: string; amountMinor: number }[];
};

// The stored summary (summaries.summary_json). Same shape for model and fallback summaries.
export type StoredSummary = {
  overview: string;
  // One row per (category, currency): amounts in different currencies are never added together.
  totals: { category: ExpenseCategory; currency: string; totalMinor: number; receiptCount: number }[];
  receipts: { receiptId: string; category: ExpenseCategory; reason: string }[];
  // Receipts that could not be read and are therefore not in any total.
  excludedReceiptIds: string[];
};

export type SummaryCheck = { ok: true; value: ModelSummary } | { ok: false; error: string };

// Model text -> validated categorisation, or a reason it was rejected.
// Every input receipt must be categorised exactly once, and no unknown ids may appear.
export function parseModelSummary(text: string | null | undefined, inputIds: string[]): SummaryCheck {
  if (!text) return { ok: false, error: "empty response" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }
  const parsed = modelSummarySchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  }

  const returned = parsed.data.receipts.map((r) => r.receipt_id);
  const expected = new Set(inputIds);
  if (returned.length !== expected.size || new Set(returned).size !== returned.length) {
    return { ok: false, error: `expected ${expected.size} receipts categorised once each, got ${returned.length}` };
  }
  const unknown = returned.filter((id) => !expected.has(id));
  if (unknown.length > 0) return { ok: false, error: `unknown receipt ids: ${unknown.join(", ")}` };

  return { ok: true, value: parsed.data };
}

// Totals come from the extracted (already validated) amounts, never from the model.
export function buildSummary(
  receipts: SummaryInputReceipt[],
  categorisation: { receiptId: string; category: ExpenseCategory; reason: string }[],
  overview: string,
  excludedReceiptIds: string[],
): StoredSummary {
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const totals = new Map<string, StoredSummary["totals"][number]>();
  for (const c of categorisation) {
    const receipt = byId.get(c.receiptId);
    if (!receipt) continue;
    const key = `${c.category}|${receipt.currency}`;
    const row = totals.get(key) ?? { category: c.category, currency: receipt.currency, totalMinor: 0, receiptCount: 0 };
    row.totalMinor += receipt.totalMinor;
    row.receiptCount += 1;
    totals.set(key, row);
  }
  return {
    overview,
    totals: [...totals.values()].sort(
      (a, b) => EXPENSE_CATEGORIES.indexOf(a.category) - EXPENSE_CATEGORIES.indexOf(b.category) || a.currency.localeCompare(b.currency),
    ),
    receipts: categorisation,
    excludedReceiptIds,
  };
}
