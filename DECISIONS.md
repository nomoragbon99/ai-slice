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

## Deliberately excluded
