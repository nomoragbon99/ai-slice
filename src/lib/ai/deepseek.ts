import OpenAI from "openai";
import { aiConfig, EXPENSE_CATEGORIES } from "@/config/ai";
import { formatMoney } from "@/lib/money";
import type { SummaryInputReceipt } from "@/lib/validation/summary";

// DeepSeek does SUMMARY: text-only reasoning over already-extracted receipts (no images).
// It speaks the OpenAI chat-completions API, so the official openai SDK is pointed at it.
// maxRetries: 0 because retries belong to the job queue, not the SDK.

let client: OpenAI | undefined;
function getClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set (add it to .env by hand, see .env.example)");
  return (client ??= new OpenAI({
    apiKey,
    baseURL: aiConfig.summary.baseURL,
    timeout: aiConfig.summary.timeoutMs,
    maxRetries: 0,
  }));
}

// DeepSeek's JSON mode guarantees valid JSON but not a schema, so the shape is spelled out here
// and enforced by Zod afterwards (src/lib/validation/summary.ts).
const SYSTEM_PROMPT = `You categorise business expense receipts and return JSON only, with exactly these keys:
{"receipts": [{"receipt_id": string, "category": one of ${JSON.stringify(EXPENSE_CATEGORIES)}, "reason": string}], "overview": string}
Rules:
- Every input receipt appears exactly once, with its receipt_id copied exactly.
- Use "Other" only when none of the other categories fits.
- "reason" is one short sentence. "overview" is 1-3 sentences about the spending.
- Do not calculate totals; they are computed separately.`;

// Only extracted, validated data is sent: never the images, never user or file names.
export async function summariseText(receipts: SummaryInputReceipt[]): Promise<string | null> {
  const payload = receipts.map((r) => ({
    receipt_id: r.id,
    merchant: r.merchant,
    date: r.date,
    total: formatMoney(r.totalMinor, r.currency),
    line_items: r.lineItems.map((i) => `${i.description}: ${formatMoney(i.amountMinor, r.currency)}`),
  }));

  const completion = await getClient().chat.completions.create(
    {
      model: aiConfig.summary.model,
      temperature: aiConfig.summary.temperature,
      max_tokens: aiConfig.summary.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    },
    // Belt and braces: the abort signal ends the request even if the SDK's own timeout misbehaves.
    { signal: AbortSignal.timeout(aiConfig.summary.timeoutMs) },
  );
  return completion.choices[0]?.message.content ?? null;
}
