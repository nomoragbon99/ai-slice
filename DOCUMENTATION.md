# AI Slice: receipts to expense summary

A receipts-to-expense-summary pipeline using two AI providers (Gemini for extraction, DeepSeek for categorisation), built and documented end to end.

## 1. Overview

**What this is:** A receipts-to-expense-summary pipeline. A user uploads one or more receipt images, and the app extracts the merchant, date, line items, tax, and total from each one, then groups them into spending categories with a short summary — without the user typing in any numbers by hand.

**Why two AI providers, not one:** The brief required two AI providers doing two distinct jobs. Here, they're split by role:
- **Gemini (`gemini-3.8-flash`)** reads each receipt image and extracts its data (merchant, date, line items, tax, total). This is vision work — it has to actually read the image.
- **DeepSeek (`deepseek-flash`)** takes the extracted text data from a whole batch and assigns each receipt a spending category (Food, Transport, Utilities, Office, Entertainment, Other), plus a short summary for the batch and a one-sentence reason for each receipt's category. This is text reasoning over already-structured data — no image involved.

**Why this split, specifically:** Extraction runs once per receipt, so it's the higher-volume call. Gemini's free tier (20 requests/day) absorbs that cost. Categorization runs once per batch regardless of how many receipts are in it, so it's the lower-volume call — that's where the paid provider (DeepSeek) sits, keeping the per-batch cost low.

**What the app controls:** Gemini is allowed to add up tax, tip, and service charge into a single tax figure when a receipt lists them separately — that's the one small sum it's asked to do, and it's checked (line items + tax must equal the total within 2%). Beyond that, the app never asks either model to compute a total or a category sum. The app's own code always sums totals per category from validated figures. This doesn't make a wrong total impossible — Gemini can still misread a number off the receipt — but it does make a calculation error impossible, and the items-plus-tax check catches many misreads before they reach a user.

**Stack:** Next.js App Router + TypeScript (strict) + Prisma + PostgreSQL, matching auth-slice and payment-slice. Runs on port 3003, with its own database on port 5435.

## 2. Architecture

**Flow, end to end:**

1. User signs in (reusing auth-slice's session/auth system) and uploads one or more receipt images through POST /api/receipts.
2. That endpoint checks each file's actual bytes (not just its declared type or extension), enforces size/count limits, and saves each file to local storage. In one database transaction, it creates a Batch, one Receipt row per file, and one extract job per receipt — then responds immediately with the batch id.
3. A background worker (started from instrumentation.ts) picks up queued extract jobs using FOR UPDATE SKIP LOCKED, so multiple jobs can be claimed safely even if there were multiple worker processes. Each job has a lease (locked_until) — if a worker crashes mid-job, the lease expires and another worker can pick the job back up.
4. For each extract job, the worker sends the receipt image to Gemini and asks it to return merchant, date, currency, total, tax, and line items as structured JSON.
5. The app validates Gemini's reply itself — the JSON shape, the value formats, and that line items plus tax add up to the total within a small tolerance. Only errors worth retrying (rate limits, server overload, timeouts) get retried, up to a limit; anything else — a bad or invalid reply, a 400, a bad or missing API key — fails immediately.
6. Once every receipt in a batch has finished extracting (successfully or not), one summarise job is queued for the batch.
7. The summarise job sends all the extracted, validated data to DeepSeek, which assigns each receipt a category and writes a short reason, plus a short overview for the whole batch. If this step itself fails (for example, a billing error), the batch still finishes: every readable receipt is shown under "Other" with its exact total, and a note explains that automatic categorisation wasn't available.
8. The user sees a summary page: totals grouped by category, with any receipt that failed extraction clearly marked as unreadable and left out of the totals — never silently dropped.

**Database tables:** batches, receipts, summaries, jobs (holds kind, status, attempts, last_error, attempt_errors, raw_response, and the lease fields described above), plus users and sessions (reused from the sign-in system) and rate_limit_attempts (the upload rate limit).

**Why a job queue instead of calling the AI directly from the upload request:** an AI call can take several seconds and can fail and need retrying. Doing that inline would make the upload request slow and fragile. Queuing the work lets the upload respond instantly, lets failures retry without the user waiting, and lets the worker enforce a concurrency cap — 3 extractions and 1 summary running at once, enforced at the database level so it holds even across multiple worker processes.

**Other checks on upload:** the endpoint requires a signed-in user and applies a per-user rate limit, returning 429 with Retry-After if exceeded.

**Storage:** files are saved to a local storage/ folder, and only the storage key (not the file itself) is stored in the database — designed for an eventual swap to S3 or similar without changing the data model.

## 3. Setup & Running Locally

**Requirements:** Node.js, Docker (for PostgreSQL), a Gemini API key (aistudio.google.com — free tier), and a DeepSeek API key with credit added (platform.deepseek.com).

**Steps:**

1. Clone the repo and install dependencies: npm install.
2. Copy .env.example to .env and fill in the values by hand — DATABASE_URL, APP_URL, DEEPSEEK_API_KEY, GEMINI_API_KEY. The AI coding agent never creates, reads, or prints this file; the app reads it at startup. It's set up manually to keep API keys out of anything the agent touches.
3. Start the database: docker compose up -d. This runs PostgreSQL on port 5435, separate from auth-slice (5433) and payment-slice (5434), so all three can run at the same time without colliding.
4. Run migrations: npx prisma migrate deploy.
5. Seed the test accounts: npm run db:seed. This creates alice, bob and carol test accounts, all with password ai-slice-test-1.
6. Start the app: npm run dev. It runs on http://localhost:3003.
7. Sign in with a seeded test account (e.g. alice@example.com / ai-slice-test-1) and upload a receipt image to test the pipeline.

**Two things to know before testing:**

1. Gemini's free tier caps out at 20 requests per day, per project, per model. Each receipt uploaded uses one request normally — up to 3 if Gemini returns a 429, a 503, or a timeout and the job retries. The cap resets at midnight Pacific time.
2. DeepSeek has no free tier. The account behind DEEPSEEK_API_KEY needs a small positive balance before the categorisation step will work — a call without one fails with a 402 Insufficient Balance error, and the app falls back to putting every receipt under "Other" rather than failing the whole batch.

**Checking what happened:** jobs.last_error, jobs.attempt_errors, and jobs.raw_response (Prisma Studio, port 5558) show exactly what each extraction or categorisation attempt did — including the model's raw reply when it produced one but failed the app's own validation.

## 4. Key Design Decisions

**Two AI providers, split by role.** Gemini handles image extraction (once per receipt); DeepSeek handles categorisation (once per batch). This puts the free-tier model on the higher-volume job and the paid model on the lower-volume one, keeping cost-per-batch low.

**Money is never inferred.** Gemini reports figures it reads directly off the receipt (line items, tax, total). It's allowed to sum tax, tip, and service charge into one tax figure when a receipt lists them separately, but nothing beyond that. All per-category totals are calculated in the app's own code from validated figures — never asked of either AI model. This applies to amounts, not currency — Gemini is allowed to infer the currency from the country or merchant name when it isn't printed on the receipt, defaulting to USD if it can't tell.

**Validate the response, don't just trust it.** Both models are asked to return structured JSON, but the app treats that as a request, not a guarantee. Zod validation runs on every response, checking shape, value formats, and — for extraction — that line items plus tax equal the total within a 2% tolerance. In real testing, this check rejected a non-receipt image outright (is_receipt: false), correctly keeping it out of the totals. It also rejected a genuinely correct extraction once, because the check itself compared line items against a tax-inclusive total without accounting for tax — the model's numbers were right, and fixing the check (plus adding a dedicated tax field) was the actual fix. The saved raw model reply is what made it possible to tell the model was right and the check was wrong, rather than guessing.

**Only retry errors worth retrying.** Rate limits (429), server overload (503), and timeouts get retried, up to a limit. Everything else — bad requests, bad API keys, invalid model output, billing failures — fails immediately. Retrying those would waste time, money, or scarce daily quota on a call that's guaranteed to fail the same way again.

**Failures degrade gracefully, not silently.** A receipt that can't be extracted is marked as unreadable and left out of the totals — the batch still finishes with everything else intact. A batch whose categorisation step fails entirely still finishes, with every readable receipt shown under "Other" and its exact total — with a note explaining that categorisation wasn't available, not a fake category.

**Every attempt's outcome is kept, not just the last one.** When a job retries, each attempt's error is appended to a list rather than overwriting the previous one. This meant a receipt that eventually succeeded still showed exactly what had gone wrong on earlier tries — useful for diagnosing intermittent failures like Gemini's demand spikes.

**Files are referenced, not embedded.** Uploaded receipts are saved to local storage; only the storage key goes into the database. This keeps the door open to swapping in S3 or similar later without touching the data model.

## 5. Security

**Authentication is a trimmed copy of auth-slice's code, not a shared module.** Sign-in and sign-out are carried over rather than reimplemented from scratch, but it is a second copy that has to be kept in sync by hand if auth-slice changes.

**Uploads are validated by content, not by what the client claims.** File type is checked from the actual bytes of each uploaded file, not the declared MIME type or file extension — a file renamed to look like an image doesn't bypass the check.

**Upload limits are enforced server-side.** File size and file count per batch are capped in config, and uploads are rate-limited per user, returning 429 with Retry-After when exceeded. This bounds how much a single user can push into the AI pipeline at once, which matters because each upload triggers real, metered API calls.

**Batches are private to their owner.** A user can only see their own batches — requesting another user's batch id returns 404 from both the API and the page, tested directly.

**Cross-site request protection.** POST routes check the request's Origin header against APP_URL, on top of SameSite=Lax session cookies.

**API keys are never exposed by the coding agent.** DEEPSEEK_API_KEY and GEMINI_API_KEY are entered directly into .env by the person running the project — never created, opened, or printed by the agent; the agent's diagnostic scripts loaded it into memory to make test calls while debugging the extraction schema, but the key never appeared in any output, commit, or log.

**Uploaded files aren't served directly.** Only a storage key is stored in the database; the raw files sit in a local storage/ folder outside of anything served publicly. This also means a compromised database record can't be used to point at an arbitrary file path.

**Model replies are never trusted as-is.** Every response from Gemini or DeepSeek is validated (shape, formats, consistency checks) before it's used anywhere — including before it's shown to a user or summed into a total. A model returning malformed, incomplete, or inconsistent data fails cleanly instead of corrupting a batch's results.

## 6. Testing & Evidence

The scenarios below were run against the running app with real API calls to Gemini and DeepSeek — no synthetic or mocked responses. Separately, the concurrency cap and per-attempt error logging were verified with scripted checks (check:concurrency, check:attempt-errors, check:validation) that exercise the queue logic directly, and the missing-key fallback was verified separately by running the app from a clone with no .env set — none of this involved live API calls.

**Single receipt, end to end.** Uploaded a real restaurant receipt (THE BISTRO, $42.07 including 8% tax). Extraction, validation, and categorisation all succeeded, correctly labeling it Food with a one-sentence reason.

**Multiple categories.** Uploaded a second receipt (vehicle maintenance, $241.50). It was correctly categorised as Transport — a different category from the first, confirming categorisation isn't hardcoded or defaulting to one answer.

**Multi-receipt batch.** Uploaded both receipts together in a single batch. Both were extracted and categorised independently, and the summary page correctly showed two separate category totals (Food $42.07, Transport $241.50) with an accurate combined view — confirming per-category summing works correctly with more than one receipt in flight. (The concurrency cap itself — 3 extractions and 1 summary at once — is verified separately by check:concurrency, since two receipts don't exceed the cap.)

**Invalid content correctly rejected.** Uploaded a non-receipt image (a website hero screenshot). Gemini itself reported is_receipt: false; the app marked the receipt as unreadable, left it out of the totals, and did not fail the rest of the batch. Confirmed via the raw saved response that this was a genuine content judgment, not an API or network error.

**Transient provider failure recovers on retry.** Across the testing in this section, one receipt succeeded on its second attempt after an automatic retry, in three separate batches — direct evidence the retry path works. Separately, a receipt that hit 3 consecutive real Gemini 503 errors within one batch did not recover automatically within that batch's retry budget; it succeeded on a later, manual re-upload after the demand spike passed. (These attempts predate the per-attempt error logging added later, so what specifically failed on that first attempt wasn't recorded — likely a 503, but unconfirmed.)

**Downstream provider failure falls back cleanly.** With no credit on the DeepSeek account, a real 402 Insufficient Balance occurred during categorisation. The batch still completed: every extracted receipt was shown under "Other" with its exact total, and the summary page explained that automatic categorisation wasn't available — rather than the batch failing outright or showing a fabricated category.

**Two real bugs found and fixed during this testing, with evidence:**

1. **Schema rejection (400):** Gemini rejected the original extraction request outright because the JSON schema sent to it included value-level constraints (the exact constraint was not isolated before the daily quota ran out mid-investigation — narrowed to something in the value-level rules, not the field names or types themselves) it doesn't accept. Fixed by simplifying the outbound schema to shape-only, keeping all value validation in the app's own Zod checks after the response arrives.
2. **False-positive validation failure:** The line-item consistency check rejected a correct extraction because it compared item totals against a tax-inclusive total, without knowing about tax. Diagnosed using a saved raw model reply (added specifically to debug this), which showed the model's numbers were right and the check was wrong. Fixed by adding a tax field and checking items + tax against the total.

## 7. Known Limitations & Trade-offs

**Gemini's free tier caps extraction at 20 requests per day (GenerateRequestsPerDayPerProjectPerModel-FreeTier), resetting at midnight Pacific time.** Every receipt uploaded uses one of those requests (up to 3 if it retries). Hitting the cap marks the affected receipts as unreadable rather than failing the whole batch. This is fine for a demo or light personal use, but it doesn't scale — a real multi-user product would need a paid Gemini tier or a different vision provider. Attaching billing to the Google project removes the cap, at roughly $0.005 per receipt. Real receipts shouldn't be uploaded on the free tier for this reason — Google may use free-tier images to improve its products. Receipts rejected once the cap is hit are not automatically retried the next day; they need to be uploaded again.

**File storage is local, not cloud-based.** Uploaded receipts sit in a local storage/ folder. Only the storage key is in the database, by design, so swapping in S3 or similar later doesn't require a data model change — but as it stands, files don't survive a redeploy to a different machine, and there's no CDN or backup.

**The exact Gemini schema rejection was never fully isolated.** The fix (a shape-only outbound schema) works — proven by every successful extraction since — but the specific constraint Gemini rejected (a length limit, a regex pattern, the item cap, or the date format hint) was never pinned down, because the daily quota ran out mid-investigation. If a future schema change reintroduces a similar rule, the same class of failure could reappear without an obvious cause.

**Authentication is a duplicated, not shared, codebase.** Sign-in and sign-out are copied from auth-slice rather than referencing a shared module. Any future fix or improvement to auth-slice's sign-in flow won't automatically apply here — it would need to be ported by hand.

**No email or export feature.** The app shows a categorised summary in the browser, but there's no way to email a report, export to CSV, or view a combined spending total across batches — the dashboard lists your 10 most recent uploads with date, receipt count, and status, each linking to its own summary, but there's no combined view across them.

**Category list is fixed and small.** The six categories (Food, Transport, Utilities, Office, Entertainment, Other) are hardcoded in config. A receipt that doesn't cleanly fit one (a mixed grocery-and-pharmacy run, for example) gets whichever category DeepSeek judges closest, with no way for a user to correct it after the fact.

**No automated test suite in the traditional sense.** Correctness is verified through real, manual end-to-end runs (documented in Section 6) plus a handful of targeted scripts (check:concurrency, check:attempt-errors, check:validation) rather than a full unit/integration test suite. This matched the project's pace, but a production version would want broader automated coverage.

## 8. What I'd Do Differently / Next Steps

**Isolate the Gemini schema constraint properly.** The 400 error was fixed by simplifying the schema wholesale, without ever confirming exactly which rule Gemini rejected. Next time, I'd binary-search the schema systematically (removing one constraint at a time, retesting after each) rather than stopping once a working version was found — this would leave a more precise, reusable understanding of what Gemini's structured-output API actually accepts.

**Move file storage to S3 (or similar) before this goes further than a demo.** The data model already supports it — only the storage key is in the database — so this is a low-risk change whenever it's needed, but local storage isn't viable beyond a single-machine demo.

**Add a combined view across batches.** Right now every batch is analyzed in isolation. A real user would want to see total spending by category across a week or month, not just per upload. This is mostly a query and a new page, since the underlying data (categorized, validated receipts) is already there.

**Reconsider the AI provider split now that it's shown its edges.** The Gemini 20/day free-tier cap and DeepSeek's no-free-tier billing are both real constraints discovered during testing, not anticipated at design time. A production version would need to budget for both — either paid Gemini access, or accepting the 20/day ceiling as a hard limit on how many receipts the app can process daily.

**Share the auth code with auth-slice instead of duplicating it.** Right now sign-in and sign-out are a hand-copied subset. Extracting a shared package would mean a fix to one flows to both, rather than needing to be ported by hand.

**Let users correct a wrong or missing category.** DeepSeek's categorization is one-shot with no way for a user to override it if it's wrong or if a receipt doesn't cleanly fit a category. A simple manual override would close that gap without much complexity.

**Add real automated tests.** The project relied on real end-to-end runs plus a few targeted scripts. That was fast and caught real bugs, but a production version would want unit and integration coverage that runs on every change, not just when someone remembers to test manually.
