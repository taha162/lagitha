/**
 * What counts as an acceptable password.
 *
 * Split from `password.ts` — which needs `node:crypto` — so the sign-up form
 * can apply the same rule as it is typed, and `validation.ts` can import it
 * without dragging server-only code into a client bundle. One definition,
 * checked in both places, with the server's answer being the one that counts.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The shortlist of passwords an attacker tries first. A length rule alone would
 * happily accept every one of these.
 */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "passw0rd",
  "qwerty123",
  "iloveyou",
  "abc12345",
  "11111111",
  "00000000",
  "lagaitha",
  "lagaitha1",
  "mosul123",
  "iraq1234",
]);

export type PasswordProblem = "too-short" | "too-long" | "too-common" | "no-variety";

/**
 * Deliberately not a character-class checklist. Forcing a symbol produces
 * `Password1!` — long enough to look strong, first in every cracking
 * dictionary. Length, more than one kind of character, and a common-list check
 * catch the passwords that actually get broken.
 */
export function checkPasswordStrength(password: string): PasswordProblem | null {
  const value = password.normalize("NFKC");

  if (value.length < PASSWORD_MIN_LENGTH) return "too-short";
  if (value.length > PASSWORD_MAX_LENGTH) return "too-long";
  if (COMMON_PASSWORDS.has(value.toLowerCase())) return "too-common";

  // "aaaaaaaa" is eight characters and no password at all.
  if (new Set(value).size < 4) return "no-variety";
  // An all-digit password shorter than a phone number is a birthday.
  if (/^\d+$/.test(value) && value.length < 12) return "no-variety";

  return null;
}
