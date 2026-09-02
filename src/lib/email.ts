/**
 * Email address handling for the login identifier.
 *
 * Pure and dependency-free, so it can be unit-tested and reused on the client
 * for inline validation — the same reasoning as src/lib/phone.ts.
 *
 * Normalisation matters here for one reason above all: the address is a
 * UNIQUE key. If "Ahmed@Gmail.com" and "ahmed@gmail.com" can both be stored,
 * one person ends up with two accounts and their reports are split between
 * them.
 */

/**
 * Deliberately not RFC 5322. That grammar permits addresses no mail provider
 * accepts, and a permissive regex here means bounced mail and a user stuck at
 * the login screen. This is the practical shape of a deliverable address.
 */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Arabic keyboards produce Arabic-Indic digits; an address needs Latin ones. */
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

/**
 * Returns the canonical storage form, or null when the address is unusable.
 *
 * Lower-cases the whole address. The local part is technically
 * case-sensitive per the RFC, but no mail provider in practice treats it that
 * way, and honouring the RFC here would hand us duplicate accounts.
 */
export function normalizeEmail(input: string): string | null {
  if (!input) return null;

  // Strip bidirectional control marks: an RTL input field can leave them in
  // the value invisibly, and they would silently break the unique key.
  const cleaned = toLatinDigits(input)
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .trim()
    .toLowerCase();

  if (cleaned.length === 0 || cleaned.length > 254) return null;
  if (!EMAIL_PATTERN.test(cleaned)) return null;

  const [local = "", domain = ""] = cleaned.split("@");
  // Limits every mail server enforces; rejecting early gives a better error
  // than a bounce an hour later.
  if (local.length === 0 || local.length > 64) return null;
  if (domain.length === 0 || domain.length > 255) return null;

  return cleaned;
}

export function isValidEmail(input: string): boolean {
  return normalizeEmail(input) !== null;
}

/**
 * Partially hides an address for staff tooling: enough to recognise an account
 * during a support conversation, not enough to hand out or harvest.
 * "abdullah@example.com" → "ab•••••h@example.com"
 */
export function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0) return "•••";

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

  if (local.length <= 2) return `${local[0] ?? "•"}•••${domain}`;
  if (local.length <= 4) return `${local.slice(0, 1)}•••${domain}`;
  return `${local.slice(0, 2)}${"•".repeat(Math.min(5, local.length - 3))}${local.slice(-1)}${domain}`;
}
