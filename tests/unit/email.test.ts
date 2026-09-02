import { describe, expect, it } from "vitest";
import { isValidEmail, maskEmail, normalizeEmail } from "@/lib/email";

/**
 * The address is a UNIQUE key on `users`. A normalisation gap here does not
 * throw — it quietly gives one person two accounts with their reports split
 * between them.
 */
describe("normalizeEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(normalizeEmail("ahmed@example.com")).toBe("ahmed@example.com");
    expect(normalizeEmail("abu.ahmed+lost@gmail.com")).toBe("abu.ahmed+lost@gmail.com");
    expect(normalizeEmail("user_name-1@sub.domain.iq")).toBe("user_name-1@sub.domain.iq");
  });

  it("lower-cases, so one person cannot end up with two accounts", () => {
    expect(normalizeEmail("Ahmed@Gmail.COM")).toBe("ahmed@gmail.com");
    expect(normalizeEmail("AHMED@GMAIL.COM")).toBe(normalizeEmail("ahmed@gmail.com"));
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  ahmed@example.com  ")).toBe("ahmed@example.com");
  });

  it("strips bidi control marks an RTL field can leave behind", () => {
    // These are invisible; without stripping they silently break the unique key.
    expect(normalizeEmail("‏ahmed@example.com‎")).toBe("ahmed@example.com");
    expect(normalizeEmail("‫ahmed@example.com‬")).toBe("ahmed@example.com");
  });

  it("converts Arabic-Indic digits typed on an Arabic keyboard", () => {
    expect(normalizeEmail("ahmed١٢٣@example.com")).toBe("ahmed123@example.com");
    expect(normalizeEmail("ahmed۴۵۶@example.com")).toBe("ahmed456@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail("Ahmed@Example.COM")!;
    expect(normalizeEmail(once)).toBe(once);
  });

  it("rejects malformed addresses", () => {
    for (const bad of [
      "",
      "   ",
      "ahmed",
      "ahmed@",
      "@example.com",
      "ahmed@example",
      "ahmed@@example.com",
      "ahmed @example.com",
      "ahmed@exa mple.com",
      "ahmed@.com",
      "ahmed@example..com",
      "ahmed@-example.com",
    ]) {
      expect(normalizeEmail(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects addresses beyond the limits mail servers enforce", () => {
    expect(normalizeEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@${"b".repeat(250)}.com`)).toBeNull();
  });

  it("does not accept a phone number as an email", () => {
    expect(normalizeEmail("07701234567")).toBeNull();
    expect(normalizeEmail("+9647701234567")).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("mirrors normalizeEmail", () => {
    expect(isValidEmail("ahmed@example.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
  });
});

describe("maskEmail", () => {
  it("keeps the domain and enough of the name to recognise an account", () => {
    const masked = maskEmail("abdullah@example.com");
    expect(masked).toContain("@example.com");
    expect(masked).toContain("•");
    expect(masked).not.toContain("abdullah");
  });

  it("does not expose a short local part", () => {
    expect(maskEmail("ab@example.com")).not.toContain("ab@");
    expect(maskEmail("a@example.com")).toContain("@example.com");
  });

  it("never returns the address unchanged", () => {
    for (const email of ["a@b.com", "ab@b.com", "abcd@b.com", "abcdefghij@b.com"]) {
      expect(maskEmail(email), email).not.toBe(email);
    }
  });

  it("degrades safely on malformed input rather than leaking it", () => {
    expect(maskEmail("not-an-email")).toBe("•••");
  });
});
