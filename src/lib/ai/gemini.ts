import { GoogleGenAI } from "@google/genai";
import { aiConfig, EXPENSE_CATEGORIES } from "@/config/ai";
import { modelSummaryJsonSchema, type SummaryInputReceipt } from "@/lib/validation/summary";
import { formatMoney } from "@/lib/money";

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (add it to .env by hand, see .env.example)");
  return (client ??= new GoogleGenAI({ apiKey }));
}

const SYSTEM_INSTRUCTION = `You categorise business expense receipts.
Assign every receipt exactly one category from: ${EXPENSE_CATEGORIES.join(", ")}.
Use "Other" only when none of the others fits.
Give a short reason (one sentence) per receipt, and a 1-3 sentence overview of the spending.
Do not calculate totals; they are computed separately. Return JSON matching the schema.`;

// Only extracted, validated data is sent: never the images, never user or file names.
export async function summariseText(receipts: SummaryInputReceipt[]): Promise<string | null> {
  const payload = receipts.map((r) => ({
    receipt_id: r.id,
    merchant: r.merchant,
    date: r.date,
    total: formatMoney(r.totalMinor, r.currency),
    line_items: r.lineItems.map((i) => `${i.description}: ${formatMoney(i.amountMinor, r.currency)}`),
  }));

  const response = await getClient().models.generateContent({
    model: aiConfig.summary.model,
    contents: JSON.stringify(payload),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: aiConfig.summary.temperature,
      maxOutputTokens: aiConfig.summary.maxOutputTokens,
      responseMimeType: "application/json",
      responseJsonSchema: modelSummaryJsonSchema,
      abortSignal: AbortSignal.timeout(aiConfig.summary.timeoutMs),
      httpOptions: { timeout: aiConfig.summary.timeoutMs },
    },
  });
  return response.text ?? null;
}
