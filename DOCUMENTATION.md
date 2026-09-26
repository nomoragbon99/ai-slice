# AI Slice: receipts to expense summary

Full write-up to be completed. Sections below are filled in as the build settles.

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
