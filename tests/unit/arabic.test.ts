import { describe, expect, it } from "vitest";
import {
  buildSearchText,
  containsPhoneNumber,
  expandSynonyms,
  normalizeArabic,
  textSimilarity,
  tokenize,
} from "@/lib/arabic";

describe("normalizeArabic", () => {
  it("strips diacritics", () => {
    expect(normalizeArabic("مَحْفَظَة")).toBe(normalizeArabic("محفظة"));
  });

  it("folds alef variants together", () => {
    const forms = ["أحمد", "إحمد", "آحمد", "احمد"];
    const normalized = forms.map(normalizeArabic);
    expect(new Set(normalized).size).toBe(1);
  });

  it("folds ta-marbuta to ha, so محفظة matches محفظه", () => {
    expect(normalizeArabic("محفظة")).toBe(normalizeArabic("محفظه"));
  });

  it("folds alef maqsura to ya", () => {
    expect(normalizeArabic("مصطفى")).toBe(normalizeArabic("مصطفي"));
  });

  it("folds the Iraqi gaf so the brand name itself is searchable", () => {
    // لَگيتها is the product name; people will type it both ways.
    expect(normalizeArabic("لگيتها")).toBe(normalizeArabic("لكيتها"));
    expect(normalizeArabic("چنطة")).toBe(normalizeArabic("جنطه"));
  });

  it("converts Arabic-Indic digits to Latin", () => {
    expect(normalizeArabic("آيفون ١٥")).toBe("ايفون 15");
    expect(normalizeArabic("۱۲۳")).toBe("123");
  });

  it("removes tatweel and collapses whitespace", () => {
    expect(normalizeArabic("مـــحفظة   بنية")).toBe("محفظه بنيه");
  });

  it("lowercases Latin text and drops punctuation", () => {
    expect(normalizeArabic("iPhone 15 Pro!")).toBe("iphone 15 pro");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeArabic("")).toBe("");
  });
});

describe("tokenize", () => {
  it("drops stop words and one-letter fragments", () => {
    expect(tokenize("محفظة من الجلد")).toEqual(["محفظه", "جلد"]);
  });

  it("strips the definite article from longer words", () => {
    expect(tokenize("الهاتف")).toContain("هاتف");
  });

  it("strips the article symmetrically, so both spellings meet in the middle", () => {
    // This is what makes the heuristic safe: it is applied to the query and to
    // the stored haystack alike, so a false strip never costs a match.
    expect(tokenize("البيت")).toEqual(tokenize("بيت"));
    expect(tokenize("الحقيبة الزرقاء")).toEqual(tokenize("حقيبة زرقاء"));
  });
});

describe("expandSynonyms", () => {
  it("connects everyday words for the same object", () => {
    const expanded = expandSynonyms(["موبايل"]);
    expect(expanded).toContain("هاتف");
    expect(expanded).toContain("phone");
  });

  it("bridges Arabic and Latin brand spellings", () => {
    expect(expandSynonyms(["ايفون"])).toContain("iphone");
  });

  it("returns an unknown word as itself, normalised", () => {
    expect(expandSynonyms(["مظلة"])).toEqual(["مظله"]);
  });

  it("normalises its input, so raw user text still hits the table", () => {
    expect(expandSynonyms(["آيفون"])).toContain("iphone");
  });
});

describe("textSimilarity", () => {
  it("scores identical descriptions as 1", () => {
    expect(textSimilarity("آيفون أسود", "ايفون اسود")).toBe(1);
  });

  it("scores unrelated descriptions at 0", () => {
    expect(textSimilarity("دراجة حمراء", "نظارة طبية")).toBe(0);
  });

  it("recognises the same item described with different words", () => {
    // One person writes "هاتف", the other writes "موبايل".
    expect(textSimilarity("هاتف أسود", "موبايل اسود")).toBeGreaterThan(0.5);
  });

  it("is order-independent, because Arabic word order is free", () => {
    expect(textSimilarity("محفظة جلد بني", "بني جلد محفظة")).toBe(1);
  });

  it("returns 0 when either side has no usable tokens", () => {
    expect(textSimilarity("", "محفظة")).toBe(0);
    expect(textSimilarity("من في", "محفظة")).toBe(0);
  });
});

describe("buildSearchText", () => {
  it("includes the original words and their synonyms", () => {
    const haystack = buildSearchText(["آيفون ١٣ أسود", null, "Apple", "هواتف"]);
    expect(haystack).toContain("ايفون");
    expect(haystack).toContain("13");
    // A searcher typing "iphone" must find a report written in Arabic.
    expect(haystack).toContain("iphone");
  });

  it("ignores empty and whitespace-only parts", () => {
    expect(buildSearchText([null, undefined, "  ", "محفظة"])).toContain("محفظه");
  });
});

describe("containsPhoneNumber", () => {
  it("spots Iraqi mobile numbers", () => {
    expect(containsPhoneNumber("رقمي 07701234567")).toBe(true);
    expect(containsPhoneNumber("اتصل +9647701234567")).toBe(true);
  });

  it("spots numbers written with Arabic-Indic digits", () => {
    expect(containsPhoneNumber("٠٧٧٠١٢٣٤٥٦٧")).toBe(true);
  });

  it("does not flag ordinary text or short numbers", () => {
    expect(containsPhoneNumber("لگيته قرب الجامعة الساعة 5")).toBe(false);
    expect(containsPhoneNumber("آيفون 15 برو")).toBe(false);
  });
});
