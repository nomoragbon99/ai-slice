# DECISIONS.md

### Provider split: DeepSeek for vision extraction, Gemini for reasoning/summary (2026-09-26)
- Decision: which model provider(s) handle the two AI steps.
- Chosen: DeepSeek `deepseek-flash` (via the official `openai` npm SDK, baseURL
  https://api.deepseek.com, OpenAI-compatible) reads receipt images and returns structured
  line items. Gemini (via `@google/genai`) takes the extracted data and does categorisation
  and the expense summary.
- Why: these are two genuinely different jobs, not one task with two prompts. Extraction is
  perception (image → structured fields); summarisation is reasoning over already-structured
  data. Splitting gives each step its own model, timeout, token cap and fallback, and a
  failure in one step is isolated and reportable.
- Rejected: one provider for both (couples a perception failure to the reasoning step and
  loses independent tuning); `deepseek-v4-pro` for extraction (docs list vision as not supported).
- Files: src/config/ai.ts, .env.example

### Ports 3003 / 5435 / 5558 (2026-09-26)
- Chosen: next free set after auth-slice (3001/5433/5555) and payment-slice (3002/5434/5557),
  verified unclaimed on this machine.
- Rejected: defaults 3000/5432/5555 (5432 is notebound-postgres, 5555 is auth-slice's Studio).
- Files: package.json, docker-compose.yml

### Gemini model for categorisation/summary: gemini-3.8-flash (2026-09-26)
- Decision: which Gemini model turns DeepSeek's extracted receipt JSON into a categorised,
  structured expense summary (moderate reasoning: grouping, category judgement, totals narrative).
- Chosen: `gemini-3.8-flash` (current stable Flash; $0.75 in / $3.75 out per 1M tokens, free tier available).
- Cost at our volume: ~2k input + ~1k output tokens per call ≈ $0.005/call; a test session of
  a few receipts costs well under $0.05. Cost does not decide between the candidates.
- Rejected:
  - `gemini-2.5-flash` (the original placeholder): Google's models page says 2.5 models have
    limited access and new projects should use 3.5 Flash-Lite or 3.8 Flash.
  - `gemini-3.5-flash-lite` ($0.30 / $2.50): cheapest and fastest, and a reasonable fallback,
    but it is aimed at high-volume simple tasks. Picking categories for ambiguous line items is
    the one place a weaker model visibly fails, and at a few calls per session the saving is negligible.
  - `gemini-3.1-pro-preview` ($2 / $12, no free tier, preview): pro-tier reasoning is not needed
    for a schema-bound task over at most a few hundred tokens of input, and it would add latency,
    cost and preview-instability risk.
- Unverified: latency was not measured (no key yet). JSON-schema output and the thinking-level
  setting on 3.8 Flash get confirmed on the first real call and logged in BUILD_LOG.md.
- Source: ai.google.dev/gemini-api/docs/pricing and /models, read 2026-09-26 (prices valid to 2026-12-31).
- Files: src/config/ai.ts

### gemini-3.8-flash stays: confirmed $0 on the free tier (2026-09-26)
- Checked: Google's pricing page lists gemini-3.8-flash free-tier input and output (thinking
  tokens included) as "Free of charge". No model is labelled a free-only "test" model, so there
  is no more reliably free option to switch to.
- Conditions for $0: the GEMINI_API_KEY must come from an AI Studio project with NO billing
  account attached. Free-tier prompts are used by Google to improve its products (acceptable for
  test receipts; not for real ones). Exact per-model request limits are only shown per account at
  aistudio.google.com/rate-limit and are not guaranteed; a handful of receipts per session is far
  below any published free quota. A 429 from Gemini is handled like any other failure (retry, then fallback).
- Note: DeepSeek has no free tier; extraction is paid per call on platform.deepseek.com.
- Files: src/config/ai.ts

### Sign-in reused from auth-slice (via payment-slice's trimmed copy) (2026-09-26)
- Chosen: users + sessions tables, argon2id password hashing, sign-in/sign-out routes, proxy gate,
  seeded test users. Same code as payment-slice, cookie renamed to ai_slice_session so the three
  apps on localhost don't share a session cookie.
- Rejected: building sign-up/verification/reset here (outside this slice's brief).
- Files: src/lib/auth/*, src/app/api/auth/*, src/app/(auth)/sign-in/*, src/proxy.ts, scripts/seed.ts

### Background work: jobs table + in-process worker, cap enforced in the database (2026-09-26)
- Chosen: a `jobs` table and a polling worker started from src/instrumentation.ts. Claiming uses a
  per-kind advisory lock + FOR UPDATE SKIP LOCKED, counts running jobs and claims only up to the
  cap, so the cap holds across processes (scripts/check-concurrency.ts proves it with two
  competing claimers). Leases make a crashed worker's job reclaimable; each claim uses up an
  attempt; finishing is fenced on the attempt number so a stale worker can't overwrite a newer one.
  All queue timing (leases, retry backoff) uses the database clock.
- Rejected: `after()` / fire-and-forget promises from the upload handler (work lost on restart,
  no retry state, cap only per process); an in-memory semaphore (same); Redis/BullMQ (new
  infrastructure for a few receipts per session).
- Files: src/lib/jobs/*, src/instrumentation.ts, prisma/schema.prisma

### The model categorises; code computes every total (2026-09-26)
- Refines the plan ("reject if model totals differ"): Gemini is not asked for totals at all. It
  returns a category + reason per receipt and an overview; totals per (category, currency) are
  summed in code from the validated extracted amounts. A wrong sum is impossible rather than detected.
- Amounts are never added across currencies.
- Files: src/lib/validation/summary.ts, src/lib/ai/gemini.ts

### Extraction returns decimal strings; code converts to minor units (2026-09-26)
- Chosen: DeepSeek returns "12.50"; src/lib/money.ts converts with the currency's own decimals
  (JPY 0, USD 2, KWD 3) using string arithmetic. Unknown currency codes are rejected.
- Rejected: asking the model for integer minor units (error-prone for non-2-decimal currencies).
- Validation also rejects non-receipts and line items that don't add up to the total (within
  `lineItemTolerancePercent`).
- Files: src/lib/validation/extraction.ts, src/lib/money.ts

### Fallbacks: a batch always finishes (2026-09-26)
- Extraction exhausts its attempts → receipt marked "failed", shown as unreadable, left out of totals.
- Summary exhausts its attempts → summary built in code: every readable receipt under "Other",
  exact totals, source = 'fallback', shown as a partial result.
- No readable receipts → fallback summary without any model call.
- Worker dies on a final attempt → lease expiry triggers the same fallbacks.
- Hence no 'failed' batch status.
- Files: src/lib/jobs/handlers.ts

### Storage: local directory behind a storage module (2026-09-26)
- Chosen: images are written to ./storage (gitignored) through src/lib/storage.ts; the database
  holds only the storage key. Keys are server-generated UUIDs, and paths are checked to stay under the root.
- Files are written before the rows; if the DB insert fails, the files are orphaned (harmless,
  unreferenced), never a row pointing at a missing file.
- Rejected for now: S3/R2 (needs credentials and a bucket for a local assessment). Swapping means
  rewriting only src/lib/storage.ts.
- Files: src/lib/storage.ts, src/app/api/receipts/route.ts

### Provider roles swapped: Gemini extracts, DeepSeek summarises (2026-09-26)
- Supersedes the first entry's role assignment (the two-role split itself is unchanged).
- Chosen: `gemini-3.8-flash` reads each receipt image (vision, JSON-schema-constrained output);
  `deepseek-flash` categorises each batch from the extracted JSON (text only, no images).
- Why: extraction runs once per RECEIPT, summarisation once per BATCH, so extraction is the
  higher-volume job. It is also the larger input (an image per call vs a few hundred tokens of JSON).
  Putting the free-tier model on it and the paid model on the once-per-batch call cuts the paid
  calls per batch from N (one per receipt) to 1.
- Verified (docs + types, no live call): Gemini 3.8 Flash accepts image/jpeg, png and webp inline
  (≤ 20 MB per request) and supports JSON-schema output together with image input.
  `models.generateContent` with `{ inlineData: { mimeType, data } }` and `responseJsonSchema`
  typechecks under strict. Google's docs now lead with the newer Interactions API; generateContent
  is kept because it is the SDK's established call and has the same shape as before.
- The extraction schema sent to Gemini is generated from the Zod schema (`io: "input"`), so the
  constraint and the validator can't drift. DeepSeek's JSON mode guarantees JSON but not a schema,
  so the summary shape is spelled out in its prompt and enforced by Zod, as before.
- Trade-offs: Gemini's free tier has per-account per-minute limits, and extraction is now where
  bursts happen (up to 5 receipts per upload, 3 concurrent). A free-tier 429 is retried with
  backoff like any other failure. Free-tier images are used by Google to improve its products.
- Unverified until a real call: whether Gemini accepts every JSON Schema feature Zod emits (the
  long date `pattern`, `anyOf` for nullables). If it rejects the schema, the call fails
  visibly (last_error) rather than silently, and the fix is simplifying the date rule.
- Files: src/config/ai.ts, src/lib/ai/gemini.ts, src/lib/ai/deepseek.ts,
  src/lib/validation/extraction.ts, src/lib/validation/summary.ts, src/lib/jobs/handlers.ts

## Deliberately excluded
- Deleting batches or receipt images: not in the brief.
- Editing an extraction by hand: not in the brief.
