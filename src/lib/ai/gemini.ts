import { GoogleGenAI } from "@google/genai";
import { aiConfig } from "@/config/ai";
import { rawExtractionJsonSchema } from "@/lib/validation/extraction";

// Gemini does EXTRACTION: one receipt image in, structured JSON out.
// The SDK is not asked to retry: retries belong to the job queue (with backoff, attempt counting
// and a final fallback), not hidden inside the SDK where they would silently stretch the timeout.

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (add it to .env by hand, see .env.example)");
  return (client ??= new GoogleGenAI({ apiKey }));
}

const SYSTEM_INSTRUCTION = `You read photos of purchase receipts and return JSON matching the schema.
Rules:
- Amounts are plain decimal strings in the receipt's currency, e.g. "12.50". No symbols, no thousands separators.
- "total" is the final amount paid, including tax, tip and service charge.
- "tax" is tax + tip + service charge added together, as one amount. Add them up yourself if the
  receipt lists them separately. Use null if the receipt shows none of them.
- "line_items" are the purchased items only. Do not list tax, tip or service charge as line items.
- "currency" is an ISO 4217 code. If it is not printed, infer it from the country/merchant; if you cannot, use "USD".
- Use null for a merchant or date you cannot read. Use [] if there are no readable line items.
- If the image is not a receipt, set is_receipt to false, total to "0", tax to null and line_items to [].`;

// Returns the model's raw text; parsing and validation happen in src/lib/validation/extraction.ts.
export async function extractReceiptText(image: Buffer, mimeType: string): Promise<string | null> {
  const response = await getClient().models.generateContent({
    model: aiConfig.extraction.model,
    contents: [
      {
        role: "user",
        parts: [
          { text: "Extract this receipt." },
          { inlineData: { mimeType, data: image.toString("base64") } },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: aiConfig.extraction.temperature,
      maxOutputTokens: aiConfig.extraction.maxOutputTokens,
      // Structured output: Gemini is constrained to the same schema Zod validates afterwards.
      responseMimeType: "application/json",
      responseJsonSchema: rawExtractionJsonSchema,
      abortSignal: AbortSignal.timeout(aiConfig.extraction.timeoutMs),
      httpOptions: { timeout: aiConfig.extraction.timeoutMs },
    },
  });
  return response.text ?? null;
}
