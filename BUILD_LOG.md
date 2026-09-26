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
