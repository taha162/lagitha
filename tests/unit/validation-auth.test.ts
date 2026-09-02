import { describe, expect, it } from "vitest";
import {
  completePasswordResetSchema,
  passwordLoginSchema,
  startSignupSchema,
  submitIdentitySchema,
  decideIdentitySchema,
} from "@/lib/validation";
import { normalizeEmail } from "@/lib/email";

/**
 * The sign-up and sign-in schemas. These run server-side on every submission
 * regardless of what the browser checked, so the rules that matter are the ones
 * pinned here.
 */

const validSignup = {
  identifier: "abu.ahmed@example.com",
  displayName: "أبو أحمد",
  password: "mosul-winter-24",
  passwordConfirm: "mosul-winter-24",
};

describe("sign-up", () => {
  it("accepts a complete, well-formed sign-up", () => {
    const result = startSignupSchema.safeParse(validSignup);
    expect(result.success).toBe(true);
    expect(result.data?.identifier).toBe("abu.ahmed@example.com");
  });

  it("accepts an address however it was typed, and leaves canonicalising to the server", () => {
    // The schema only trims and checks shape: it cannot canonicalise, because
    // whether the identifier is an address or a phone number is decided by the
    // configured delivery channel, not by the browser. `normalizeIdentifier`
    // does that in `src/lib/auth.ts`, which is what the unique key relies on.
    const result = startSignupSchema.safeParse({
      ...validSignup,
      identifier: "  Abu.Ahmed@Example.COM ",
    });

    expect(result.success).toBe(true);
    expect(result.data?.identifier).toBe("Abu.Ahmed@Example.COM");
    expect(normalizeEmail(result.data!.identifier)).toBe("abu.ahmed@example.com");
  });

  it("rejects a confirmation that does not match, against the second field", () => {
    const result = startSignupSchema.safeParse({
      ...validSignup,
      passwordConfirm: "mosul-winter-25",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["passwordConfirm"]);
  });

  it("rejects a weak password before it can be hashed", () => {
    const result = startSignupSchema.safeParse({
      ...validSignup,
      password: "12345678",
      passwordConfirm: "12345678",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "password")).toBe(true);
  });

  it("keeps a URL or a phone number out of the public display name", () => {
    for (const displayName of ["زوروا https://spam.example", "اتصل 07701234567"]) {
      expect(startSignupSchema.safeParse({ ...validSignup, displayName }).success).toBe(false);
    }
  });
});

describe("sign-in", () => {
  it("accepts any password the person types", () => {
    // Strength rules must not be applied here: refusing a weak password at the
    // sign-in screen tells an attacker which guesses are not worth making, and
    // locks out anyone whose password predates the current rules.
    const result = passwordLoginSchema.safeParse({
      identifier: "sara@example.com",
      password: "1234",
    });

    expect(result.success).toBe(true);
  });

  it("still requires something to be typed", () => {
    expect(
      passwordLoginSchema.safeParse({ identifier: "sara@example.com", password: "" }).success,
    ).toBe(false);
  });
});

describe("password reset", () => {
  it("requires the code, the new password and a matching confirmation", () => {
    const base = {
      identifier: "sara@example.com",
      code: "482913",
      password: "new-password-here",
      passwordConfirm: "new-password-here",
    };

    expect(completePasswordResetSchema.safeParse(base).success).toBe(true);
    expect(completePasswordResetSchema.safeParse({ ...base, code: "48291" }).success).toBe(false);
    expect(
      completePasswordResetSchema.safeParse({ ...base, passwordConfirm: "different-one" }).success,
    ).toBe(false);
  });
});

describe("identity", () => {
  it("asks for the name on the card and nothing else", () => {
    const result = submitIdentitySchema.safeParse({ cardName: "محمد أحمد علي" });
    expect(result.success).toBe(true);
    // The card number is not a field, so it cannot be submitted even by a
    // client that tries.
    expect(Object.keys(result.data ?? {})).toEqual(["cardName"]);
  });

  it("requires a written reason to reject, because the reason is sent to the person", () => {
    const id = { verificationId: "v1" };

    expect(decideIdentitySchema.safeParse({ ...id, decision: "APPROVED" }).success).toBe(true);
    expect(decideIdentitySchema.safeParse({ ...id, decision: "REJECTED" }).success).toBe(false);
    expect(
      decideIdentitySchema.safeParse({ ...id, decision: "REJECTED", note: "الصورة غير واضحة" })
        .success,
    ).toBe(true);
  });
});
