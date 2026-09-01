/**
 * Iraqi phone numbers. Pure and dependency-free so it can be unit-tested and
 * reused on the client for inline validation.
 *
 * Canonical storage form is E.164: +9647XXXXXXXXX.
 * Accepted input covers what people actually type:
 *   07701234567, 0770 123 4567, ٠٧٧٠١٢٣٤٥٦٧, +9647701234567, 009647701234567
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Valid Iraqi mobile prefixes after the leading 7 (Zain, Asiacell, Korek). */
const MOBILE_PREFIXES = ["70", "71", "72", "73", "74", "75", "76", "77", "78", "79"];

function toLatinDigits(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/** Returns E.164 (+9647XXXXXXXXX) or null when the number is not a valid Iraqi mobile. */
export function normalizePhone(input: string): string | null {
  if (!input) return null;

  let digits = toLatinDigits(input).replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("964")) digits = digits.slice(3);
  // Both "07..." and a bare "7..." are common.
  if (digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  if (!digits.startsWith("7")) return null;
  if (!MOBILE_PREFIXES.includes(digits.slice(0, 2))) return null;

  return `+964${digits}`;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** Display form for the owner of the number: 0770 123 4567. */
export function formatPhoneForDisplay(e164: string): string {
  const national = e164.replace(/^\+964/, "0");
  if (national.length !== 11) return e164;
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}
