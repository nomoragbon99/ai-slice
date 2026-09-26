# AI Slice: receipts to expense summary

Full write-up to be completed. Sections below are filled in as the build settles.

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

**Money is never inferred.** Gemini reports figures it reads directly off the receipt (line items, tax, total). It's allowed to sum tax, tip, and service charge into one tax figure when a receipt lists them separately, but nothing beyond that. All per-category totals are calculated in the app's own code from validated figures — never asked of either AI model.

**Validate the response, don't just trust it.** Both models are asked to return structured JSON, but the app treats that as a request, not a guarantee. Zod validation runs on every response, checking shape, value formats, and — for extraction — that line items plus tax equal the total within a 2% tolerance. This caught a real, valid extraction being wrongly formatted at first, and separately caught a receipt where the model's math didn't add up as expected — both described in the evidence below.

**Only retry errors worth retrying.** Rate limits (429), server overload (503), and timeouts get retried, up to a limit. Everything else — bad requests, bad API keys, invalid model output, billing failures — fails immediately. Retrying those would waste time, money, or scarce daily quota on a call that's guaranteed to fail the same way again.

**Failures degrade gracefully, not silently.** A receipt that can't be extracted is marked as unreadable and left out of the totals — the batch still finishes with everything else intact. A batch whose categorisation step fails entirely still finishes, with every readable receipt shown under "Other" and its exact total — with a note explaining that categorisation wasn't available, not a fake category.

**Every attempt's outcome is kept, not just the last one.** When a job retries, each attempt's error is appended to a list rather than overwriting the previous one. This meant a receipt that eventually succeeded still showed exactly what had gone wrong on earlier tries — useful for diagnosing intermittent failures like Gemini's demand spikes.

**Files are referenced, not embedded.** Uploaded receipts are saved to local storage; only the storage key goes into the database. This keeps the door open to swapping in S3 or similar later without touching the data model.

## What this doesn't handle

### Gemini free tier: at most 20 receipt extractions per day
Receipt images are read by `gemini-3.8-flash` on Google's free tier, which allows **20 requests per
day, per project, for this model**. Google enforces this (quota id
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`) and resets it at **midnight Pacific time**
(07:00 UTC while Pacific daylight time is in effect, 08:00 UTC otherwise).

- One receipt normally costs one request. A receipt whose call hits a rate limit (429), an overload
  (503) or a timeout can be retried, using up to 3 requests.
- Once the day's 20 are used, extraction calls are rejected with 429. Those receipts show as
  "couldn't be read" and are left out of the totals; the batch still completes with a summary
  of whatever was read. Nothing is retried the next day automatically; the receipts must be uploaded again.
- This is a deliberate trade-off (free extraction) and a permanent property of this design, not a
  bug. Removing it means attaching billing to the Google project (about $0.005 per receipt) or
  moving extraction to a paid provider. See DECISIONS.md.
- Free-tier requests may be used by Google to improve its products, so real (non-test) receipts
  should not be sent under this configuration.
