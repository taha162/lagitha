import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, isValidPhone, normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("accepts the shapes people actually type", () => {
    const expected = "+9647701234567";
    for (const input of [
      "07701234567",
      "0770 123 4567",
      "0770-123-4567",
      "+9647701234567",
      "009647701234567",
      "9647701234567",
      "7701234567",
    ]) {
      expect(normalizePhone(input), input).toBe(expected);
    }
  });

  it("accepts Arabic-Indic digits", () => {
    expect(normalizePhone("٠٧٧٠١٢٣٤٥٦٧")).toBe("+9647701234567");
  });

  it("accepts every valid Iraqi mobile prefix", () => {
    for (const prefix of ["70", "71", "72", "73", "74", "75", "76", "77", "78", "79"]) {
      expect(normalizePhone(`0${prefix}01234567`), prefix).not.toBeNull();
    }
  });

  it("rejects landlines, wrong lengths and foreign numbers", () => {
    expect(normalizePhone("0601234567")).toBeNull(); // not a mobile prefix
    expect(normalizePhone("077012345")).toBeNull(); // too short
    expect(normalizePhone("077012345678")).toBeNull(); // too long
    expect(normalizePhone("+14155552671")).toBeNull(); // not Iraqi
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("ليس رقماً")).toBeNull();
  });

  it("is idempotent on already-normalised input", () => {
    const once = normalizePhone("07701234567")!;
    expect(normalizePhone(once)).toBe(once);
  });
});

describe("isValidPhone", () => {
  it("mirrors normalizePhone", () => {
    expect(isValidPhone("07701234567")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
  });
});

describe("formatPhoneForDisplay", () => {
  it("renders the national form its owner recognises", () => {
    expect(formatPhoneForDisplay("+9647701234567")).toBe("0770 123 4567");
  });

  it("returns the input unchanged when it is not the expected length", () => {
    expect(formatPhoneForDisplay("+96477")).toBe("+96477");
  });
});
