# AI Slice: receipts to expense summary

Full write-up to be completed. Sections below are filled in as the build settles.

## 1. Overview

**What this is:** A receipts-to-expense-summary pipeline. A user uploads one or more receipt images, and the app extracts the merchant, date, line items, tax, and total from each one, then groups them into spending categories with a short summary — without the user typing in any numbers by hand.

**Why two AI providers, not one:** The brief required two AI providers doing two distinct jobs. Here, they're split by role:
- **Gemini (`gemini-3.8-flash`)** reads each receipt image and extracts its data (merchant, date, line items, tax, total). This is vision work — it has to actually read the image.
- **DeepSeek (`deepseek-flash`)** takes the extracted text data from a whole batch and assigns each receipt a spending category (Food, Transport, Utilities, Office, Entertainment, Other), plus a one-line summary. This is text reasoning over already-structured data — no image involved.

**Why this split, specifically:** Extraction runs once per receipt, so it's the higher-volume call. Gemini's free tier (20 requests/day) absorbs that cost. Categorization runs once per batch regardless of how many receipts are in it, so it's the lower-volume call — that's where the paid provider (DeepSeek) sits, keeping the per-batch cost low.

**What the app never does:** It never asks either AI model to add up money. Gemini reports the numbers it reads off the receipt (line items, tax, total); the app's own code sums totals per category. This makes a wrong total structurally impossible to produce from AI error — the AI can misread a number, but it can never miscalculate one, because it's never asked to calculate.

**Stack:** Next.js App Router + TypeScript (strict) + Prisma + PostgreSQL, matching auth-slice and payment-slice. Runs on port 3003, with its own database on port 5435.

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
