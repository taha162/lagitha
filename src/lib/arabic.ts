/**
 * Arabic text handling for search and matching.
 *
 * Two people describing the same object will not spell it the same way:
 * diacritics, hamza forms, ta-marbuta, Iraqi letters (گ چ پ ڤ), Arabic-Indic
 * digits, and Latin/Arabic brand names all vary. Everything that goes into
 * `Report.searchText` and everything a user types is pushed through
 * `normalizeArabic` first, so the two meet in the middle.
 *
 * This file is deliberately dependency-free and pure — it is the most
 * heavily unit-tested module in the project.
 */

const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const NON_WORD = /[^\p{L}\p{N}\s]/gu;

const ARABIC_INDIC_ZERO = 0x0660; // ٠
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰

const LETTER_FOLDING: Record<string, string> = {
  // alef family
  "أ": "ا", // أ
  "إ": "ا", // إ
  "آ": "ا", // آ
  "ٱ": "ا", // ٱ
  // ya / alef maqsura
  "ى": "ي", // ى
  "ئ": "ي", // ئ
  // waw
  "ؤ": "و", // ؤ
  // ta marbuta
  "ة": "ه", // ة
  // hamza on its own carries no search value once folded
  "ء": "",
  // Iraqi / Persian letters people type on local keyboards
  "گ": "ك", // گ → ك  (لگيتها ↔ لكيتها)
  "ك": "ك",
  "ک": "ك", // ک
  "چ": "ج", // چ → ج
  "ڤ": "ف", // ڤ → ف
  "پ": "ب", // پ → ب
  "ی": "ي", // ی
};

/** Folds an Arabic string to a comparable form. Safe on Latin input too. */
export function normalizeArabic(input: string): string {
  if (!input) return "";

  let out = input.normalize("NFKC").replace(DIACRITICS, "").replace(TATWEEL, "");

  let folded = "";
  for (const char of out) {
    const code = char.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      folded += String(code - ARABIC_INDIC_ZERO);
      continue;
    }
    if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      folded += String(code - EXTENDED_ARABIC_INDIC_ZERO);
      continue;
    }
    folded += LETTER_FOLDING[char] ?? char;
  }

  out = folded
    .toLowerCase()
    .replace(NON_WORD, " ")
    .replace(/\s+/g, " ")
    .trim();

  return out;
}

/**
 * Words that carry no discriminating value in a two-or-three word Arabic
 * report title. Removed before token comparison so "محفظة جلد" and
 * "محفظة من الجلد" score as the same thing.
 */
const STOP_WORDS = new Set([
  "من",
  "في",
  "على",
  "عن",
  "الى",
  "او",
  "و",
  "مع",
  "قرب",
  "جنب",
  "عند",
  "هذا",
  "هذه",
  "شي",
  "شيء",
  "لون",
  "نوع",
  "حق",
  "مال",
  "ال",
  "the",
  "a",
  "an",
  "of",
  "my",
]);

export function tokenize(input: string): string[] {
  const normalized = normalizeArabic(input);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map(stripDefiniteArticle)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * "الهاتف" → "هاتف", so a search for "هاتف" finds "الهاتف" and vice versa.
 *
 * This is a heuristic, not morphology: a word like "ألوان" (whose alef-lam is
 * part of the stem) is stripped too. That is acceptable because the same
 * function runs over both the query and the stored haystack, so the two sides
 * always agree — the cost is a rare collision, not a missed match. Real
 * stemming would need a morphological analyser and is not worth it here.
 */
function stripDefiniteArticle(token: string): string {
  if (token.length > 4 && token.startsWith("ال")) {
    return token.slice(2);
  }
  return token;
}

/**
 * Everyday synonyms for the things people actually lose in Mosul. Search
 * expands the query through this table, so someone typing "موبايل" finds a
 * report written as "هاتف" or "iphone".
 *
 * This is intentionally a short, curated list rather than a general
 * thesaurus: precision matters more than coverage, and it is easy for a
 * non-engineer to extend.
 */
const SYNONYM_GROUPS: string[][] = [
  ["هاتف", "موبايل", "تلفون", "جوال", "محمول", "phone", "mobile"],
  // Brand groups deliberately carry the generic word too. Someone searching
  // "موبايل" must find a report titled "آيفون ١٣" — the brand implies the
  // category, and only the searcher knows which word they will reach for.
  ["ايفون", "ابل", "iphone", "apple", "هاتف", "phone"],
  ["سامسونج", "samsung", "جالكسي", "galaxy", "هاتف", "phone"],
  ["محفظة", "جزدان", "wallet", "بيت نقود"],
  ["مفتاح", "مفاتيح", "key", "keys", "سويج"],
  ["حقيبة", "جنطة", "شنطة", "باگ", "bag", "backpack", "حقيبه ظهر"],
  ["نظارة", "نظارات", "عوينات", "glasses"],
  ["ساعة", "ساعه", "watch"],
  ["لابتوب", "laptop", "حاسبة", "كمبيوتر", "notebook"],
  ["سماعة", "سماعات", "ايربودز", "airpods", "headphones", "earbuds"],
  ["ايباد", "ipad", "تابلت", "tablet"],
  ["هوية", "بطاقة", "وثيقة", "جواز", "id", "passport", "باج"],
  ["قطة", "بزون", "cat"],
  ["كلب", "chalabi", "dog"],
  ["دراجة", "بايسكل", "سيكل", "bike", "bicycle"],
  ["سيارة", "car", "عجلة"],
  ["ذهب", "ذهبي", "gold", "خاتم", "ring"],
  ["شاحن", "charger", "كيبل", "cable"],
];

const SYNONYM_INDEX: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map((word) => normalizeArabic(word)).filter(Boolean);
    for (const word of normalized) {
      const existing = index.get(word) ?? [];
      index.set(word, Array.from(new Set([...existing, ...normalized])));
    }
  }
  return index;
})();

/**
 * Returns the given tokens plus any known synonyms, de-duplicated.
 * Input is normalised defensively so a caller passing raw user text still
 * gets a hit against the table (which is keyed on normalised forms).
 */
export function expandSynonyms(tokens: readonly string[]): string[] {
  const out = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeArabic(token);
    if (!normalized) continue;
    out.add(normalized);
    for (const synonym of SYNONYM_INDEX.get(normalized) ?? []) {
      out.add(synonym);
    }
  }
  return Array.from(out);
}

/**
 * Token-overlap similarity in [0,1] (Dice coefficient over token sets, with
 * synonym folding). Chosen over edit distance because Arabic word order is
 * free and reports are short: shared vocabulary is the honest signal.
 */
export function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(expandSynonyms(tokenize(a)));
  const tokensB = new Set(expandSynonyms(tokenize(b)));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return (2 * shared) / (tokensA.size + tokensB.size);
}

/**
 * Builds the denormalised haystack stored on `Report.searchText`.
 * Order does not matter — it is only ever used with a substring match.
 */
export function buildSearchText(parts: readonly (string | null | undefined)[]): string {
  const normalized = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => normalizeArabic(part));

  const tokens = normalized.flatMap((part) => part.split(" "));
  const expanded = expandSynonyms(tokens.filter((token) => token.length >= 2));

  return Array.from(new Set([...tokens, ...expanded])).join(" ").trim();
}

/** Rough Iraqi phone-number detector, used to warn (never block) in messages. */
export function containsPhoneNumber(text: string): boolean {
  const digitsOnly = normalizeArabic(text).replace(/[^0-9]/g, "");
  if (digitsOnly.length < 10) return false;
  return /(07|9647|\+9647)\d{8,}/.test(digitsOnly) || /\d{11,}/.test(digitsOnly);
}
