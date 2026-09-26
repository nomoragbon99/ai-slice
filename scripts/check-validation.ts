// Checks the pure logic the pipeline trusts: money conversion, extraction validation, summary
// validation and code-computed totals. No database, no network, no keys.
// Run with: npm run check:validation
import assert from "node:assert/strict";
import { toMinorUnits } from "../src/lib/money";
import { parseExtraction, rawExtractionJsonSchema } from "../src/lib/validation/extraction";
import { buildSummary, parseModelSummary } from "../src/lib/validation/summary";
import { detectImageType } from "../src/lib/validation/upload";
import { isRetryableProviderError } from "../src/lib/ai/errors";
import { ApiError } from "@google/genai";
import { APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

check("minor units follow each currency's decimals", () => {
  assert.equal(toMinorUnits("12.5", "USD"), 1250);
  assert.equal(toMinorUnits("1500", "JPY"), 1500);
  assert.equal(toMinorUnits("1.5", "JPY"), null); // JPY has no decimals
  assert.equal(toMinorUnits("0.1", "USD"), 10); // string maths: no float error
  assert.equal(toMinorUnits("1", "ZZZ"), null); // unknown currency
});

const good = {
  is_receipt: true,
  merchant: "Cafe",
  date: "2026-09-01",
  currency: "usd",
  total: "10.00",
  tax: null,
  line_items: [
    { description: "Coffee", amount: "4.00" },
    { description: "Cake", amount: "6.00" },
  ],
};

check("valid extraction converts to minor units and uppercases currency", () => {
  const r = parseExtraction(JSON.stringify(good));
  assert.ok(r.ok);
  assert.equal(r.value.totalMinor, 1000);
  assert.equal(r.value.currency, "USD");
});

check("line items + tax must equal the total (the real Bistro receipt)", () => {
  // Gemini's actual reply for "receipt 1.png" (jobs.raw_response), which failed the old items-only check.
  const bistro = {
    is_receipt: true,
    merchant: "THE BISTRO",
    date: "2026-03-18",
    currency: "USD",
    total: "42.07",
    line_items: [
      { description: "BURGER DELUXE", amount: "14.99" },
      { description: "CAESAR SALAD", amount: "9.99" },
      { description: "2 x SOFT DRINK @ $2.99", amount: "5.98" },
      { description: "CHEESECAKE", amount: "7.99" },
    ],
  };
  const withTax = parseExtraction(JSON.stringify({ ...bistro, tax: "3.12" }));
  assert.ok(withTax.ok);
  assert.equal(withTax.value.taxMinor, 312);
  const noTax = parseExtraction(JSON.stringify({ ...bistro, tax: null }));
  assert.ok(!noTax.ok && noTax.error.includes("line items (3895) + tax (0) = 3895 but total is 4207"));
  assert.equal(parseExtraction(JSON.stringify({ ...bistro, tax: "9.00" })).ok, false); // tax too big
  assert.equal(parseExtraction(JSON.stringify({ ...bistro, tax: "$3.12" })).ok, false); // not a plain decimal
  assert.equal(parseExtraction(JSON.stringify(bistro)).ok, false); // tax key missing entirely
});

check("extraction rejects non-JSON, non-receipts, bad dates and inconsistent line items", () => {
  assert.equal(parseExtraction("not json").ok, false);
  assert.equal(parseExtraction(JSON.stringify({ ...good, is_receipt: false })).ok, false);
  assert.equal(parseExtraction(JSON.stringify({ ...good, date: "01/09/2026" })).ok, false);
  assert.equal(parseExtraction(JSON.stringify({ ...good, total: "$10" })).ok, false);
  const r = parseExtraction(JSON.stringify({ ...good, total: "50.00" }));
  assert.ok(!r.ok && r.error.includes("but total is"));
});

check("summary must categorise every receipt exactly once, from the fixed list", () => {
  const ok = { receipts: [{ receipt_id: "a", category: "Food", reason: "Cafe" }], overview: "One meal." };
  assert.ok(parseModelSummary(JSON.stringify(ok), ["a"]).ok);
  assert.equal(parseModelSummary(JSON.stringify(ok), ["a", "b"]).ok, false); // missing b
  assert.equal(parseModelSummary(JSON.stringify({ ...ok, receipts: [...ok.receipts, ...ok.receipts] }), ["a"]).ok, false); // duplicate
  assert.equal(parseModelSummary(JSON.stringify({ ...ok, receipts: [{ ...ok.receipts[0], category: "Travel" }] }), ["a"]).ok, false); // not in list
  assert.equal(parseModelSummary(JSON.stringify({ ...ok, receipts: [{ ...ok.receipts[0], receipt_id: "x" }] }), ["a"]).ok, false); // unknown id
});

check("totals are computed in code, per category AND currency", () => {
  const receipts = [
    { id: "a", merchant: null, date: null, currency: "USD", totalMinor: 1000, lineItems: [] },
    { id: "b", merchant: null, date: null, currency: "USD", totalMinor: 250, lineItems: [] },
    { id: "c", merchant: null, date: null, currency: "EUR", totalMinor: 700, lineItems: [] },
  ];
  const s = buildSummary(
    receipts,
    [
      { receiptId: "a", category: "Food", reason: "" },
      { receiptId: "b", category: "Food", reason: "" },
      { receiptId: "c", category: "Food", reason: "" },
    ],
    "x",
    ["z"],
  );
  assert.deepEqual(
    s.totals.map((t) => [t.category, t.currency, t.totalMinor, t.receiptCount]),
    [
      ["Food", "EUR", 700, 1],
      ["Food", "USD", 1250, 2],
    ],
  );
  assert.deepEqual(s.excludedReceiptIds, ["z"]);
});

check("image type comes from the bytes, not the name", () => {
  assert.equal(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectImageType(new TextEncoder().encode("<html>not an image")), null);
});

check("only 429, 503 and timeouts are retried", () => {
  const gemini = (status: number) => new ApiError({ message: "x", status });
  const openai = (status: number) => APIError.generate(status, undefined, "x", new Headers());
  assert.equal(isRetryableProviderError(gemini(400)), false); // the schema rejection we hit
  assert.equal(isRetryableProviderError(gemini(403)), false); // bad key
  assert.equal(isRetryableProviderError(gemini(429)), true);
  assert.equal(isRetryableProviderError(gemini(503)), true);
  assert.equal(isRetryableProviderError(openai(401)), false);
  assert.equal(isRetryableProviderError(openai(429)), true);
  assert.equal(isRetryableProviderError(openai(503)), true);
  assert.equal(isRetryableProviderError(openai(500)), false);
  assert.equal(isRetryableProviderError(new APIConnectionTimeoutError()), true);
  assert.equal(isRetryableProviderError(new APIUserAbortError()), true);
  assert.equal(isRetryableProviderError(new DOMException("signal timed out", "TimeoutError")), true);
  assert.equal(isRetryableProviderError(new Error("GEMINI_API_KEY is not set")), false); // missing key
});

check("the schema sent to Gemini uses structural keywords only (no pattern/length/format)", () => {
  const allowed = new Set(["type", "properties", "required", "anyOf", "items"]);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "properties") {
          Object.values(value as object).forEach(walk);
          continue;
        }
        assert.ok(allowed.has(key), `keyword "${key}" is not structural; Gemini rejected value keywords with 400`);
        walk(value);
      }
    }
  };
  walk(rawExtractionJsonSchema);
});

console.log(`\n${passed} checks passed`);
