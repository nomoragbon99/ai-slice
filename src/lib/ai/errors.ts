// Which provider failures are worth another attempt. Only three kinds are retried:
//   429  rate/quota limit      (a per-minute limit clears; a spent daily quota doesn't, but a
//                               rejected request doesn't use quota, so trying again is harmless)
//   503  provider overloaded   (Gemini returns this under "high demand"; it clears on its own)
//   timeout                    (our own AbortSignal/SDK timeout; the next call may be faster)
// Everything else fails the job on the first attempt: a 400 (request the provider rejects), a
// 401/403 (bad key), a missing key, invalid model output. Retrying those can't change the result
// and, with Gemini's 20-requests-per-day free tier, would only burn quota.

import { APIConnectionTimeoutError, APIUserAbortError } from "openai";

const RETRYABLE_STATUS = new Set([429, 503]);

// DOMException names thrown when AbortSignal.timeout fires (how @google/genai surfaces our timeout).
const TIMEOUT_NAMES = new Set(["TimeoutError", "AbortError"]);

export function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (TIMEOUT_NAMES.has(error.name)) return true;
  // openai SDK: its own timeout, and APIUserAbortError, which is what it throws when OUR
  // AbortSignal.timeout fires (the only abort signal this app ever passes it).
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) return true;
  // Both SDKs put the HTTP status on the error: openai's APIError.status, @google/genai's ApiError.status.
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && RETRYABLE_STATUS.has(status);
}
