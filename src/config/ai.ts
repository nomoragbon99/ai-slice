// Every changeable AI/upload value lives here. Handlers and libs import from this file;
// nothing below is repeated as a literal anywhere else.

export const aiConfig = {
  extraction: {
    // DeepSeek, OpenAI-compatible API. deepseek-flash supports image input.
    baseURL: "https://api.deepseek.com",
    model: "deepseek-flash",
    timeoutMs: 30_000,
    maxOutputTokens: 1_024,
    temperature: 0,
  },
  summary: {
    model: "gemini-2.5-flash",
    timeoutMs: 30_000,
    maxOutputTokens: 1_024,
    temperature: 0.2,
  },
  concurrency: {
    // Max receipts sent to the extraction model at once.
    extraction: 3,
  },
  upload: {
    maxFileBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
} as const;
