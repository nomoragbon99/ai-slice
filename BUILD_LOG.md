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
