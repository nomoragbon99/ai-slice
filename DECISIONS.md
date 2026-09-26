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

## Deliberately excluded
