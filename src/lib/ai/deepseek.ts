import OpenAI from "openai";
import { aiConfig } from "@/config/ai";

// DeepSeek speaks the OpenAI chat-completions API, so the official openai SDK is pointed at it.
// maxRetries: 0 because retries belong to the job queue (with backoff, attempt counting and a
// final fallback), not hidden inside the SDK where they would silently stretch the timeout.

let client: OpenAI | undefined;
function getClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set (add it to .env by hand, see .env.example)");
  return (client ??= new OpenAI({
    apiKey,
    baseURL: aiConfig.extraction.baseURL,
    timeout: aiConfig.extraction.timeoutMs,
    maxRetries: 0,
  }));
}

const SYSTEM_PROMPT = `You read photos of purchase receipts and return JSON only, with exactly these keys:
{"is_receipt": boolean, "merchant": string|null, "date": "YYYY-MM-DD"|null, "currency": "ISO 4217 code", "total": "decimal string", "line_items": [{"description": string, "amount": "decimal string"}]}
Rules:
- Amounts are plain decimal strings in the receipt's currency, e.g. "12.50". No symbols, no thousands separators.
- "total" is the final amount paid, including tax and tip.
- If the currency is not printed, infer it from the country/merchant; if you cannot, use "USD".
- Use null for a merchant or date you cannot read. Use [] if there are no readable line items.
- If the image is not a receipt, return {"is_receipt": false, "merchant": null, "date": null, "currency": "USD", "total": "0", "line_items": []}.`;

// Returns the model's raw text; parsing and validation happen in src/lib/validation/extraction.ts.
export async function extractReceiptText(image: Buffer, mimeType: string): Promise<string | null> {
  const completion = await getClient().chat.completions.create(
    {
      model: aiConfig.extraction.model,
      temperature: aiConfig.extraction.temperature,
      max_tokens: aiConfig.extraction.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract this receipt." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}` } },
          ],
        },
      ],
    },
    // Belt and braces: the abort signal ends the request even if the SDK's own timeout misbehaves.
    { signal: AbortSignal.timeout(aiConfig.extraction.timeoutMs) },
  );
  return completion.choices[0]?.message.content ?? null;
}
