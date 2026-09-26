import { z } from "zod";
import { aiConfig } from "@/config/ai";
import { toMinorUnits } from "@/lib/money";

// What Gemini is asked to return. Amounts come back as decimal STRINGS in major units ("12.50"):
// asking a model for integer minor units invites mistakes on currencies with 0 or 3 decimals, so
// the conversion is done here, deterministically, from the currency's own number of decimals.
const decimalString = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "must be a plain decimal like 12.50");

export const rawExtractionSchema = z.object({
  is_receipt: z.boolean(),
  merchant: z.string().trim().min(1).max(200).nullable(),
  // ISO date or null when the receipt has none / it is unreadable.
  date: z.iso.date().nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code"),
  total: decimalString,
  // Tax + tip + service charge combined; null when the receipt shows none.
  tax: decimalString.nullable(),
  line_items: z
    .array(z.object({ description: z.string().trim().min(1).max(200), amount: decimalString }))
    .max(100),
});

// JSON Schema sent to Gemini as responseJsonSchema: SHAPE ONLY (field names, types, required, nullable).
// Gemini answered 400 INVALID_ARGUMENT to the full schema z.toJSONSchema generates (patterns, length
// limits, maxItems, format; see BUILD_LOG.md), so every value rule lives in rawExtractionSchema above,
// which checks the response. This schema only steers the model; Zod is the enforcement.
// Structural keywords only: type, properties, required, anyOf (for null), items. A real call
// confirmed the first four; arrays/booleans follow the same standard subset but are first
// exercised by the next real upload. Value formats are described in the system instruction instead.
// Kept next to rawExtractionSchema so a field added there is added here in the same edit.
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
export const rawExtractionJsonSchema = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    merchant: nullableString,
    date: nullableString,
    currency: { type: "string" },
    total: { type: "string" },
    tax: nullableString,
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          amount: { type: "string" },
        },
        required: ["description", "amount"],
      },
    },
  },
  required: ["is_receipt", "merchant", "date", "currency", "total", "tax", "line_items"],
} as const;

export type ExtractedReceipt = {
  merchant: string | null;
  date: string | null;
  currency: string;
  totalMinor: number;
  // Tax + tip + service charge in minor units; null when the receipt shows none.
  taxMinor: number | null;
  lineItems: { description: string; amountMinor: number }[];
};

export type ExtractionResult = { ok: true; value: ExtractedReceipt } | { ok: false; error: string };

// Model text -> validated receipt, or a reason it was rejected (stored as the job's last_error).
export function parseExtraction(text: string | null | undefined): ExtractionResult {
  if (!text) return { ok: false, error: "empty response" };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }

  const parsed = rawExtractionSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  }
  const raw = parsed.data;
  if (!raw.is_receipt) return { ok: false, error: "image is not a receipt" };

  const totalMinor = toMinorUnits(raw.total, raw.currency);
  if (totalMinor === null) return { ok: false, error: `unsupported currency or amount: ${raw.currency} ${raw.total}` };

  let taxMinor: number | null = null;
  if (raw.tax !== null) {
    taxMinor = toMinorUnits(raw.tax, raw.currency);
    if (taxMinor === null) return { ok: false, error: `bad tax amount: ${raw.tax}` };
  }

  const lineItems: ExtractedReceipt["lineItems"] = [];
  for (const item of raw.line_items) {
    const amountMinor = toMinorUnits(item.amount, raw.currency);
    if (amountMinor === null) return { ok: false, error: `bad line item amount: ${item.amount}` };
    lineItems.push({ description: item.description, amountMinor });
  }

  // Consistency check: line items + tax should add up to the total. Receipts with no itemisation pass.
  if (lineItems.length > 0) {
    const itemsSum = lineItems.reduce((acc, i) => acc + i.amountMinor, 0);
    const sum = itemsSum + (taxMinor ?? 0);
    const allowed = Math.ceil((totalMinor * aiConfig.extraction.lineItemTolerancePercent) / 100);
    if (Math.abs(sum - totalMinor) > allowed) {
      return {
        ok: false,
        error: `line items (${itemsSum}) + tax (${taxMinor ?? 0}) = ${sum} but total is ${totalMinor} (minor units)`,
      };
    }
  }

  return {
    ok: true,
    value: { merchant: raw.merchant, date: raw.date, currency: raw.currency, totalMinor, taxMinor, lineItems },
  };
}
