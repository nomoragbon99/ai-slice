# BUILD_LOG.md

Append-only. Never edit or delete past entries.

### Project setup (2026-09-26)
- Scaffolded with create-next-app 16.3.5 (App Router, TS strict, Tailwind 4, ESLint, src/).
- Ports 3003/5435/5558 checked before use: no listeners in `netstat`, no Docker container
  publishing them, no other local config claiming them.
- SDK check: `openai` 7.23.0 and `@google/genai` 2.24.0 installed; an image-input chat
  completion (DeepSeek) and a generateContent call (Gemini) typecheck under strict.
  Unauthenticated probes: api.deepseek.com/models → 401, generativelanguage.googleapis.com → 403
  (reachable, key required). DeepSeek pricing docs list `deepseek-flash` with vision supported;
  `deepseek-v4-pro` has no vision. No live model call made (no keys, by design).

### Bash heredoc batch failed to parse (2026-09-26)
- Symptom: `bash: -c: line 177: unexpected EOF while looking for matching `''`
- Investigation: one long command combined several quoted heredocs, a `$(cat AGENTS.md)`
  capture and a single-quoted `node -e` script. Bash parses the whole command before running
  it, so nothing executed; confirmed with `ls` that no files had been written.
- Cause: quoting interaction inside one oversized shell command.
- Fix: wrote each file separately with the editor tool instead.
- Commit: initial commit

### typecheck failed on a fresh tree: LayoutProps not found (2026-09-26)
- Symptom: `src/app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.`
- Investigation: lint and `next build` both passed; rerunning `tsc --noEmit` after the build passed.
- Cause: Next 16 generates the global `LayoutProps` type into .next/types during build/dev,
  so plain `tsc` fails before either has run.
- Fix: typecheck script is now `next typegen && tsc --noEmit`; verified from a deleted .next.
- Commit: fix: generate Next route types before typecheck

### DECISIONS.md entry missing from model-choice commit (2026-09-26)
- Symptom: `Python was not found` while appending the entry; the commit went ahead with only src/config/ai.ts.
- Investigation: the script used `python`; this machine has no Python, only the Microsoft Store alias.
  The chained commit did not depend on the script's exit status.
- Cause: assumed Python was available, and the commands weren't chained on the script succeeding.
- Fix: added the entry with the editor tool in a follow-up commit. Use Node or the editor for file edits here.
- Commit: docs: log Gemini model decision

### Typecheck: models missing on PrismaClient after migrate (2026-09-26)
- Symptom: `Property 'session' does not exist on type 'PrismaClient'` (and batch/receipt/job/summary).
- Investigation: the migration was applied; src/generated/prisma was from the empty initial schema.
- Cause: I created the migration with `--create-only` and then applied it; the client was not regenerated.
- Fix: `npx prisma generate`. `npm run db:migrate` already runs generate, so this only affects hand-run migrations.
- Commit: feat: receipt upload and background extraction/summary pipeline

### Unknown currency "ZZZ" accepted as real (2026-09-26)
- Symptom: scripts/check-validation.ts: `toMinorUnits("1", "ZZZ")` returned 100, expected null.
- Investigation: `new Intl.NumberFormat("en", {style:"currency", currency:"ZZZ"})` does not throw;
  any well-formed 3-letter code formats as a 2-decimal currency.
- Cause: I assumed Intl validates currency codes against ISO 4217. It only checks the shape.
- Fix: check against `Intl.supportedValuesOf("currency")` first. A model-invented currency is now rejected.
- Commit: feat: receipt upload and background extraction/summary pipeline

### Retry timing looked too fast (false alarm) + backoff moved to DB clock (2026-09-26)
- Symptom: a batch whose extractions needed 5 s + 10 s of backoff appeared "done after 9s".
- Investigation: compared the Node clock with Postgres `now()` (0.3 s apart); job rows showed
  created 01:18:46, finished 01:19:03 = 17 s, which is correct.
- Cause: my polling loop counted iterations (each ~2 s: curl + sleep), not seconds.
- Fix: none needed for the timing. It did show that run_after was computed on the app clock
  while leases use the DB clock; run_after is now set with the database's now() in fencedFinish,
  so all queue timing uses one clock.
- Commit: feat: receipt upload and background extraction/summary pipeline

### Worker kept old code after hot reload (2026-09-26)
- Symptom: none observed; spotted while reasoning about the test: the one-worker guard flag
  lives on globalThis, which survives dev hot reload, so the running loop keeps the old handler code.
- Fix: restarted the dev server before testing worker changes. Dev-only; production starts fresh.
- Commit: n/a (documented)

### End-to-end verification without API keys (2026-09-26)
- Server run with DATABASE_URL/APP_URL passed on the command line (no .env exists; keys by hand only).
- Upload: signed out → 401; HTML renamed .png → 400 (bytes checked); no files → 400; 2 PNGs → 202.
- Extraction without DEEPSEEK_API_KEY: 3 attempts each, last_error recorded, receipts "failed",
  fallback summary "nothing to summarise", batch done. Images present in storage/, DB holds keys only.
- Summary without GEMINI_API_KEY (receipts inserted as extracted): 3 attempts, fallback with both
  receipts under Other, total 2050 USD computed in code, unreadable receipt excluded.
- Abandoned final-attempt job (expired lease): marked failed, receipt failed, fallback summary written.
- Concurrency: scripts/check-concurrency.ts, two simultaneous claimers → 3 + 0 of 5 queued (cap 3).
- Another user's batch → 404 from both the API and the page.
- NOT verified: a real DeepSeek or Gemini call (needs the owner's keys in .env).

### Test server could load the owner's .env (risk avoided) (2026-09-26)
- Symptom: none; a .env now exists (not read), and `next dev` loads .env automatically, so a
  "missing key" test could have made real, billed calls with the owner's keys.
- Investigation: @next/env has special handling for empty-string variables (replaceProcessEnv deletes
  them), so overriding with KEY="" was not provably safe.
- Fix: ran the tests from a git clone in the scratchpad. .env is gitignored, so the clone had none;
  the dev log showed no "Environments: .env" line. Clone deleted afterwards.
- Commit: refactor: swap provider roles (Gemini extracts, DeepSeek summarises)

### Turbopack rejected a node_modules junction (2026-09-26)
- Symptom: `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`.
- Investigation: to save an install, the clone's node_modules was a junction to the project's. The
  test script ran against no server (all curls empty); its inserted rows were processed later.
- Cause: Turbopack refuses symlinks/junctions that leave the project root.
- Fix: removed the junction with `rmdir` (the target was left intact, 407 packages) and ran `npm ci` in the clone.
- Commit: n/a (test setup only)

### Failure-path re-verification after the role swap (2026-09-26)
- check:validation 6/6 (bad/unknown currency, non-receipt, bad dates, inconsistent line items,
  summary id/category rules, code-computed totals, byte-sniffed image type).
- check:concurrency: two simultaneous claimers → 3 + 0 of 5 (cap 3), no double claim.
- Upload: signed out 401; HTML renamed .png 400; no files 400; 2 PNGs 202.
- Extraction without GEMINI_API_KEY: 3 attempts each, receipts failed, "nothing to summarise"
  fallback, batch done; storage keys only in DB.
- Summary without DEEPSEEK_API_KEY: 3 attempts, fallback all "Other", 2050 USD computed in code,
  1 unreadable receipt excluded.
- Worker crash on final attempt: lease expiry → job failed, receipt failed, fallback summary.
- Another user's batch: 404.
- NOT verified: real Gemini or DeepSeek calls.

### First real upload: Gemini 400 INVALID_ARGUMENT on every extraction attempt (2026-09-26)
- Symptom: "receipt 1.png" (PNG, 19,200 bytes), uploaded twice, 3 attempts each, all with
  `ApiError: {"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}`.
  Receipts marked failed, "nothing to summarise" fallback shown (fallback worked as designed).
- Investigation (one-off requests with the owner's key, key never printed; scripts in gitignored tmp/):
  - image, NO schema → OK (Gemini read "THE BISTRO" from the real receipt): key, model, image fine.
  - text only + full app schema → 400. Same error without any image: the image is not the cause.
  - app schema without `$schema` → 400; also with the long date regex replaced by format:date → 400.
  - minimal schema {merchant: string} → OK; with `anyOf [string, null]` → OK.
  - `pattern`, `minLength/maxLength`, `maxItems` probes: blocked by quota (below), not yet isolated.
  - Several probes also got 503 UNAVAILABLE "high demand" (transient, Google side).
  - Ruled out: bad key (would be API_KEY_INVALID/403), quota (429), network (no HTTP response).
- Cause: Gemini rejects the JSON Schema Zod generates for extraction. Not the `$schema` key and not
  (only) the date regex; one of pattern / min-maxLength / maxItems / format remains.
- Fix: pending owner decision.
- Commit: pending

### Gemini free tier is 20 requests PER DAY for gemini-3.8-flash (2026-09-26)
- Symptom: 429 RESOURCE_EXHAUSTED during the diagnosis.
- Investigation: full error: quotaId `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
  quotaValue "20", model gemini-3.8-flash. Its "retry in 41s" is misleading; the quota is daily.
  Today's 20: 6 from the two uploads (3 retries x 2) and the rest from these probes.
- Cause: my earlier DECISIONS entry said a handful of receipts is "far below any published free
  quota". That was wrong: I never saw the per-model number (Google publishes it only in AI Studio).
  20/day with 3 attempts per receipt means as few as ~6 receipts/day if calls fail.
- Also found: the worker retries a 400, which can never succeed, using up quota for nothing.
- Fix: pending owner decision.
- Commit: pending

### Resolution: Gemini 400 and quota entries above (2026-09-26)
- Fix (commit 5b67f70): Gemini now gets a shape-only schema (type/properties/required/anyOf/items);
  Zod still enforces every value rule. Only 429, 503 and timeouts are retried; anything else fails
  on attempt 1 with "(not retried)". Free-tier 20/day accepted by the owner and documented
  (DECISIONS.md, DOCUMENTATION.md "What this doesn't handle").
- Quota reset confirmed from Google's docs: "Requests per day (RPD) quotas reset at midnight Pacific
  time". Next reset: 2026-09-26 07:00 UTC (08:00 in the owner's UTC+1 zone).
- Verified without keys (key-less clone, as before): check:validation 8/8 (adds retry classification
  using the real SDK error classes, and a guard against value keywords in the Gemini schema);
  check:concurrency ok; fake/none/unauth uploads rejected; missing Gemini key → 1 attempt, not 3;
  missing DeepSeek key → 1 attempt, fallback 2050 USD; crashed final attempt → fallback.
- NOT verified: Gemini accepting the new schema. It can't be tested until the quota resets. Arrays
  and booleans in the schema are first exercised by that real upload.
- Commit: 5b67f70 + docs commit

### Real upload after quota reset: extraction rejected by our line-item check (2026-09-26)
- Symptom: "receipt 1.png", job ran 17:14:49-17:15:00 UTC, 1 attempt:
  `invalid extraction: line items sum to 3895 but total is 4207 (minor units) (not retried)`.
- Investigation: no 400 and no 429, so Gemini accepted the shape-only schema and replied with JSON
  that passed shape/format validation. The gap (3.12, ~7.4%) exceeds lineItemTolerancePercent (2).
  The model's reply was not stored on failure, so which figure is off could not be checked.
- Cause: not yet known (likely tax/service charge in the total but not listed as a line item: unconfirmed).
- Fix: jobs.raw_response now stores the model's raw reply whenever it fails validation (extraction and
  summary), truncated to aiConfig.jobs.maxRawResponseChars. Validation rule unchanged (owner's decision).
- Commit: feat: store the model's raw reply when validation fails

### Line-item mismatch diagnosed from raw_response: tax (2026-09-26)
- Symptom: same receipt re-uploaded, 17:32:51-17:33:03 UTC, same `line items sum to 3895 but total is 4207`.
- Investigation: jobs.raw_response: items 14.99 + 9.99 + 5.98 + 7.99 = 38.95; total 42.07;
  38.95 x 0.08 = 3.116 → 3.12 and 38.95 + 3.12 = 42.07. Extraction was accurate; the check was wrong.
- Cause: validation compared items alone against a tax-inclusive total.
- Fix: `tax` field + items + tax = total check (DECISIONS.md). check:validation 9/9, including
  Gemini's actual Bistro reply passing with tax 3.12 and failing without it.
- NOT verified: that Gemini fills `tax` correctly: next real upload.
- Commit: feat: extract tax separately and include it in the total check

### Batch a4cb3416: receipt 2 exhausted retries on Gemini 503; earlier attempt errors lost (2026-09-26)
- Symptom: receipt 2.png extract job, 21:09:39-21:10:09 UTC, 3 attempts, last_error
  `ApiError: {"error":{"code":503,"message":"This model is currently experiencing high demand. ...","status":"UNAVAILABLE"}}`.
  receipt 1.png in the same batch succeeded on attempt 2, with last_error NULL.
- Investigation: last_error is overwritten on every attempt and cleared on success, so the errors
  of receipt 2's attempts 1-2 and receipt 1's attempt 1 were not recorded anywhere.
- Cause: only the latest error was stored (design gap, not a bug in the retry logic).
- Fix: jobs.attempt_errors (JSONB list of { attempt, at, error }), appended in SQL on every failed
  attempt and when a lease expires mid-attempt; never cleared. Backoff and attempt counts unchanged
  (owner's decision). scripts/check-attempt-errors.ts: fail-then-succeed keeps attempt 1's error;
  dead-worker attempt recorded in order; a worker that lost its claim appends nothing.
- Commit: feat: keep every attempt's error in jobs.attempt_errors

### History rewritten to remove the agent's product name; every commit hash changed (2026-09-27)
- Symptom: none (owner request). The product name of the AI coding agent appeared in 2 commit
  messages, in the agent config file (present in 33 of 35 commits) and in 4 historical wordings in
  DOCUMENTATION.md (16 commits). It had already been removed from current files in the last commit.
- Investigation: searched every commit message, every file of every commit and every path name.
  git filter-repo needs Python (not installed; installing it would be a global install), so used
  git's built-in filter-branch, as in auth-slice. Backup first: `../ai-slice-pre-rewrite.bundle`
  (complete history, verified; outside the repo so the old history is not kept inside it).
- Fix: `git filter-branch --prune-empty` with an index filter (edits stored blobs directly, so no
  line-ending conversion can touch other files) that drops the agent config file from every commit
  and rewrites only the matching DOCUMENTATION.md phrases to the current wording, plus a message
  filter for the one affected body line. The last commit became empty and was dropped: 35 → 34.
- Verified before pushing: final tree identical to the old HEAD (both `a8bca5a`); per commit pair,
  no file other than those two changed and no DOCUMENTATION.md line changed unless it held the
  name; authors, emails and both dates identical for all 34 pairs; only one message changed.
  Force-pushed with `--force-with-lease` pinned to the old tip. After the push: local reflog
  expired and objects pruned (old tip no longer present); all refs locally and a fresh clone from
  GitHub show 0 matches in messages, files, path names and every stored blob; 34 commits, one author.
- Cause of stale hashes: rewriting changes every hash. Entries above are left as written
  (append-only), so `Commit:` lines citing `5b67f70` now mean `b0d2ace`. Use the table below.
  GitHub may keep serving the old commits by exact hash until it garbage-collects them.
- Commit: (this commit, first after the rewrite; not in the table)

| # | Old hash | New hash | Subject |
|---|----------|----------|---------|
| 1 | `9b3f6b1` | `723d0d1` | chore: scaffold ai-slice (Next.js, Prisma, Postgres 18, project rules) |
| 2 | `1b65653` | `67782fe` | fix: generate Next route types before typecheck |
| 3 | `94d273f` | `c01bcaa` | chore: choose gemini-3.8-flash for summarisation |
| 4 | `c1db3d9` | `57ab1f9` | docs: log Gemini model decision |
| 5 | `0bf6748` | `382eaed` | feat: receipt upload and background extraction/summary pipeline |
| 6 | `5b98955` | `65f6ec8` | docs: record pipeline decisions and verification log |
| 7 | `9ca49b7` | `edefd8d` | refactor: swap provider roles (Gemini extracts, DeepSeek summarises) |
| 8 | `45723fc` | `389d2fa` | docs: record provider role swap and re-verification |
| 9 | `3aa8ac5` | `4927f99` | docs: update provider roles in AGENTS.md and .env.example |
| 10 | `d2c0ca2` | `413599a` | docs: log Gemini 400 schema rejection and 20/day free-tier quota |
| 11 | `5b67f70` | `b0d2ace` | fix: send Gemini a shape-only schema; stop retrying unrecoverable errors |
| 12 | `b133e70` | `b07673c` | docs: document Gemini 20/day free-tier limit, schema and retry decisions |
| 13 | `8f34246` | `c814565` | feat: store the model's raw reply when validation fails |
| 14 | `449b9d4` | `55d791a` | feat: extract tax separately and include it in the total check |
| 15 | `c6408a9` | `5dac7d6` | feat: keep every attempt's error in jobs.attempt_errors |
| 16 | `770fa62` | `8875034` | docs: add Overview section to DOCUMENTATION.md |
| 17 | `a9c32fd` | `74514c8` | docs: correct Overview claims about what the models compute |
| 18 | `0078933` | `c86cf1f` | docs: add Architecture section to DOCUMENTATION.md |
| 19 | `321e0d3` | `915600f` | docs: add Setup & Running Locally section to DOCUMENTATION.md |
| 20 | `0a3450e` | `e638113` | docs: fix Setup section (seed step, .env wording, retry quota use) |
| 21 | `c50191e` | `a17d110` | docs: add Key Design Decisions section to DOCUMENTATION.md |
| 22 | `c461417` | `11baad2` | docs: correct Section 4 validation evidence and currency inference |
| 23 | `874de69` | `c802a1f` | docs: add Security section to DOCUMENTATION.md |
| 24 | `e71dfbf` | `6001f98` | docs: correct Section 5 auth and key-handling claims; add ownership and origin checks |
| 25 | `ddd3e51` | `16a3a18` | docs: trim redundant clause from Section 5 API keys paragraph |
| 26 | `9b04daf` | `b14d959` | docs: align Section 5 API keys heading with its paragraph |
| 27 | `ee0630e` | `2c69699` | docs: add Testing & Evidence section to DOCUMENTATION.md |
| 28 | `8a78108` | `5786dc6` | docs: correct Section 6 overclaims (scope, concurrency, retry, schema cause) |
| 29 | `7345feb` | `4a6a00c` | docs: clarify how the missing-key fallback was verified |
| 30 | `cc0bdcb` | `c93d0cc` | docs: remove duplicate missing-key mention in Section 6 |
| 31 | `0e8ef86` | `6611cd3` | docs: add Known Limitations & Trade-offs section to DOCUMENTATION.md |
| 32 | `9dd927f` | `71e9d90` | docs: merge old limits section into Section 7; correct batch history claim |
| 33 | `a649bba` | `99f19b5` | docs: complete Section 7 quota paragraph; repoint DECISIONS reference |
| 34 | `00e00c2` | `0858e85` | docs: remove duplicate free-tier image note from Section 7 |
| 35 | `a730370` | *(dropped: empty after rewrite)* | *(deleted the agent config file and scrubbed doc wording)* |
