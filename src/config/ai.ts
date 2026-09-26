// Every changeable AI/upload/worker value lives here. Handlers and libs import from this file;
// nothing below is repeated as a literal anywhere else.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

// The fixed category list. The model must pick one of these per receipt; anything else fails validation.
export const EXPENSE_CATEGORIES = ["Food", "Transport", "Utilities", "Office", "Entertainment", "Other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const aiConfig = {
  extraction: {
    // Gemini (vision): runs once per receipt, the high-volume job, so it gets the free-tier model; 3.8 Flash reads JPEG/PNG/WebP inline with JSON-schema output.
    model: "gemini-3.8-flash",
    // Hard limit on one call; on timeout the job is retried, then the receipt is marked unreadable.
    timeoutMs: 45 * SECOND,
    maxOutputTokens: 1_024,
    temperature: 0,
    // Line items may differ from the printed total by up to this percent (rounding, tips, tax
    // lines the model skipped) before the extraction is rejected as inconsistent.
    lineItemTolerancePercent: 2,
  },
  summary: {
    // DeepSeek (text only): runs once per batch, the low-volume job, so the paid model costs one call per upload.
    baseURL: "https://api.deepseek.com",
    model: "deepseek-flash",
    timeoutMs: 30 * SECOND,
    maxOutputTokens: 1_024,
    temperature: 0.2,
    // Longest overview sentence the summary may contain (characters).
    maxOverviewLength: 600,
  },
  jobs: {
    // Max jobs of each kind running at once, across every worker process (enforced in the database).
    // Extraction is on Gemini's free tier, whose per-minute request limit is per account; keep this low.
    concurrency: { extract: 3, summarise: 1 },
    maxAttempts: { extract: 3, summarise: 3 },
    // Retry n waits n x this long before it can be claimed again.
    retryBackoffMs: 5 * SECOND,
    // A running job whose lease passes is treated as abandoned (e.g. the server restarted mid-call).
    // Must be longer than the slowest call it covers, so the longest model timeout plus margin.
    leaseMs: 2 * MINUTE,
    // Longest model reply kept in jobs.raw_response for a failed validation (characters).
    maxRawResponseChars: 20_000,
    // How often the worker looks for claimable jobs.
    pollIntervalMs: 2 * SECOND,
  },
  upload: {
    maxFiles: 5,
    maxFileBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    // Per signed-in user. Each upload triggers paid model calls, so it is limited.
    rateLimit: { windowSeconds: 10 * 60, max: 10 },
  },
  storage: {
    // Local stand-in for object storage (see DECISIONS.md). Relative to the project root; gitignored.
    localDir: "storage",
  },
  status: {
    // How often the batch page re-fetches while work is still running.
    pollIntervalMs: 2 * SECOND,
  },
} as const;
