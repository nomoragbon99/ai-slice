# AGENTS.md: AI Slice (receipts → expense summary)

## What this repository is
A graded, time-boxed "slice": upload receipt images, extract structured line items with a
vision model (DeepSeek `deepseek-flash`), then categorise and summarise the expenses with a
reasoning model (Gemini via `@google/genai`). Optimise for correctness and explainability.
Separate project from auth-slice and payment-slice.

## Scope: build ONLY what the assessment brief lists
Nothing outside the brief gets built. No landing page, no marketing page, no extra features.
If something seems useful but is not in the brief, do not build it: add one line under
"Deliberately excluded" in DECISIONS.md.

## Secrets: non-negotiable (explicit brief requirement)
- Never create, open, read, print or edit `.env`. Only `.env.example` with commented placeholders.
- API keys (DEEPSEEK_API_KEY, GEMINI_API_KEY) are entered into `.env` BY HAND by the owner only.
  The agent never writes, pastes, echoes or inserts a key anywhere. This is stronger than
  usual: it is a stated brief requirement, not only a convention.
- If a new env var is needed: add it to `.env.example` with a comment on where the value comes
  from, then STOP and tell the owner to add the real value by hand.

## Configuration
- Every changeable value lives in `src/config/ai.ts`: model ids, base URLs, timeouts, token caps,
  temperature, concurrency limits, upload limits. Nothing is hardcoded in route handlers or libs.

## Files
- Uploaded files go to object storage or the documented local equivalent (a storage directory
  behind a storage module). The database stores ONLY the storage key, never file bytes.

## Model calls
- Every model call has a timeout (from config) and a defined fallback: what the user sees and
  what is persisted when the call times out or fails. No unbounded awaits on a provider.

## Docker and data safety
Never run `docker compose down -v` or anything that deletes a volume. Never touch containers,
volumes or databases not defined in THIS repo's docker-compose.yml (auth-slice, payment-slice,
notebound-postgres and n8n also run on this machine). Never install anything globally without asking.

## Ports
App 3003, Postgres 5435, Prisma Studio 5558 (auth-slice 3001/5433/5555, payment-slice 3002/5434/5557).

## How to work
1. Plan first (files, purpose in plain English, risks); wait for approval before feature code.
2. Verify after implementing: typecheck, lint, run the app, exercise the change. Never claim
   something works without running it.
3. Conventional Commits, small and incremental. Push when a remote exists. Never commit .env.
4. BUILD_LOG.md is append-only: never edit or delete past entries. For every error, failed
   command, unexpected behaviour or wrong assumption, append:
   ### <short title> (<date and time>)
   - Symptom / Investigation / Cause / Fix / Commit
5. DECISIONS.md: whenever choosing between alternatives, append Decision / Chosen / Rejected and why / Files.

## Commit conventions
- Never add a Co-Authored-By trailer or any other AI attribution to commit messages, even if a
  tool or harness instruction suggests one. This rule wins.
- Commits are authored as the repo owner only.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
