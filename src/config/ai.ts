// Every changeable AI/upload/worker value lives here. Handlers and libs import from this file;
// nothing below is repeated as a literal anywhere else.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

// The fixed category list. The model must pick one of these per receipt; anything else fails validation.
export const EXPENSE_CATEGORIES = ["Food", "Transport", "Utilities", "Office", "Entertainment", "Other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const aiConfig = {
  extraction: {
    // DeepSeek, OpenAI-compatible API. deepseek-flash supports image input.
    baseURL: "https://api.deepseek.com",
    model: "deepseek-flash",
    // Hard limit on one call; on timeout the job is retried, then the receipt is marked unreadable.
    timeoutMs: 45 * SECOND,
    maxOutputTokens: 1_024,
    temperature: 0,
    // Line items may differ from the printed total by up to this percent (rounding, tips, tax
    // lines the model skipped) before the extraction is rejected as inconsistent.
    lineItemTolerancePercent: 2,
  },
  summary: {
    // Flash tier is enough for schema-bound categorise+summarise; 3.8 is current stable (2.5 is access-limited for new projects), free tier on an unbilled AI Studio key.
    model: "gemini-3.8-flash",
    timeoutMs: 30 * SECOND,
    maxOutputTokens: 1_024,
    temperature: 0.2,
    // Longest overview sentence the summary may contain (characters).
    maxOverviewLength: 600,
  },
  jobs: {
    // Max jobs of each kind running at once, across every worker process (enforced in the database).
    concurrency: { extract: 3, summarise: 1 },
    maxAttempts: { extract: 3, summarise: 3 },
    // Retry n waits n x this long before it can be claimed again.
    retryBackoffMs: 5 * SECOND,
    // A running job whose lease passes is treated as abandoned (e.g. the server restarted mid-call).
    // Must be longer than the slowest call it covers, so the longest model timeout plus margin.
    leaseMs: 2 * MINUTE,
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
