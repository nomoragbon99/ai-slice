// Evidence for DOCUMENTATION.md: feeds Gemini's real reply for the Bistro receipt through the real
// validator twice, once with the tax removed (deliberately broken) and once with it, and prints the
// result of each. No database, no network, no keys.
// Run with: npm run demo:broken-validation
import { parseExtraction } from "../src/lib/validation/extraction";

// Gemini's actual extraction of "receipt 1.png" (jobs.raw_response), plus the tax field added later.
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

console.log("1) Deliberately broken: tax removed");
console.log(parseExtraction(JSON.stringify({ ...bistro, tax: null })));

console.log("\n2) Same reply with tax 3.12");
const fixed = parseExtraction(JSON.stringify({ ...bistro, tax: "3.12" }));
console.log(fixed.ok ? { ok: true, totalMinor: fixed.value.totalMinor, taxMinor: fixed.value.taxMinor } : fixed);
