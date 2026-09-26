// Money is integer minor units + currency everywhere. These are the only two places it changes shape.

// The runtime's list of real ISO 4217 codes. Needed because Intl.NumberFormat happily formats any
// well-formed 3-letter code ("ZZZ") as if it were a 2-decimal currency.
const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

// How many decimals a currency uses (JPY 0, USD 2, KWD 3), from the runtime's ISO 4217 data.
// Returns null for a code that is not a real currency.
function currencyDigits(currency: string): number | null {
  if (!KNOWN_CURRENCIES.has(currency)) return null;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

// "12.5" USD -> 1250. String arithmetic, never floats, so no 0.1 + 0.2 surprises.
// Null if the currency is unknown or the amount has more decimals than the currency allows.
export function toMinorUnits(decimal: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  if (digits === null) return null;
  const [whole, fraction = ""] = decimal.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMoney(minor: number, currency: string): string {
  const digits = currencyDigits(currency) ?? 2;
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 10 ** digits);
}
