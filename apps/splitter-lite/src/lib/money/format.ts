// Money is always stored as integer minor units (cents, pence, yen…) plus an ISO 4217 code.
export type Minor = number;

const exponentCache = new Map<string, number>();

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const cached = exponentCache.get(code);
  if (cached !== undefined) return cached;
  let exponent = 2;
  try {
    exponent =
      new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // Unknown code: fall back to 2 decimals.
  }
  exponentCache.set(code, exponent);
  return exponent;
}

let isoCurrencies: Set<string> | undefined;

/** True only for real ISO 4217 codes (Intl accepts any three letters, e.g. "ZZZ", so check the list). */
export function isValidCurrency(currency: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false;
  isoCurrencies ??= new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : []);
  return isoCurrencies.size === 0 || isoCurrencies.has(currency);
}

/** Converts a major-unit number (e.g. 12.34) to integer minor units. */
export function toMinor(amount: number, currency: string): Minor {
  if (!Number.isFinite(amount)) throw new Error("Amount must be a finite number");
  const factor = 10 ** currencyExponent(currency);
  // toFixed guards against binary drift such as 1.005 * 100 = 100.49999…
  return Math.round(Number((amount * factor).toFixed(6)));
}

export function fromMinor(minor: Minor, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}

/**
 * Normalises how people write amounts into a plain "1234.56" string.
 * - Both "." and "," present (₹1,20,400.50, 1.234,56): the last one is the decimal point.
 * - Only dots: the last dot is the decimal point if a single one ("12.5"); several dots are grouping.
 * - Only commas: a single comma followed by 1–2 digits is a decimal comma ("12,50"); otherwise grouping ("1,500").
 * Extra decimals are trimmed by the caller, so typing never makes an amount jump by 1,000.
 */
function normaliseAmount(input: string, exponent: number): string {
  const raw = input.replace(/[^\d.,]/g, "");
  const dots = (raw.match(/\./g) ?? []).length;
  const commas = (raw.match(/,/g) ?? []).length;
  let decimalAt = -1;
  if (dots && commas) decimalAt = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  else if (dots === 1) decimalAt = raw.indexOf(".");
  else if (commas === 1 && /,\d{0,2}$/.test(raw)) decimalAt = raw.indexOf(",");
  if (decimalAt === -1) return raw.replace(/[.,]/g, "");
  if (exponent === 0) return raw.slice(0, decimalAt).replace(/[.,]/g, ""); // JPY: drop decimals
  return `${raw.slice(0, decimalAt).replace(/[.,]/g, "")}.${raw.slice(decimalAt + 1).replace(/[.,]/g, "")}`;
}

/** Parses free-form user input like "12", "12.5", "$1,204.10", "₹1,20,400.50". Returns null when invalid. */
export function parseMoneyInput(input: string, currency: string): Minor | null {
  const cleaned = normaliseAmount(input, currencyExponent(currency));
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return toMinor(value, currency);
}

/**
 * Keeps only what a money field may contain: digits and one decimal point, no more decimals than the
 * currency allows (none for JPY) and at most 9 whole digits. Typed and pasted input use the same rules.
 */
export function sanitizeMoneyText(input: string, currency: string): string {
  const exponent = currencyExponent(currency);
  const text = normaliseAmount(input, exponent);
  const [whole, frac] = text.split(".");
  const w = whole.replace(/^0+(?=\d)/, "").slice(0, 9);
  if (frac === undefined) return w;
  return `${w || "0"}.${frac.slice(0, exponent)}`;
}

/** "₹" for INR, "$" for USD… and the bare number "3,010.00", for templates that print them separately. */
export function moneyParts(minor: Minor, currency: string, locale = "en-US") {
  const exponent = currencyExponent(currency);
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).formatToParts(fromMinor(minor, currency));
  return {
    symbol: parts.find((p) => p.type === "currency")?.value ?? currency,
    number: parts
      .filter((p) => p.type !== "currency")
      .map((p) => p.value)
      .join("")
      .trim(),
  };
}

export function formatMoney(minor: Minor, currency: string, locale?: string): string {
  const exponent = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(fromMinor(minor, currency));
}

/** Plain decimal string for inputs, e.g. 1234 USD -> "12.34". */
export function minorToInput(minor: Minor, currency: string): string {
  return fromMinor(minor, currency).toFixed(currencyExponent(currency));
}

export const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "CAD",
  "AUD",
  "JPY",
  "SGD",
  "AED",
  "CHF",
  "MXN",
  "BRL",
] as const;
