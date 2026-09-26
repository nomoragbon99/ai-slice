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
