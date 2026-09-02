import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { PASSWORD_MIN_LENGTH, checkPasswordStrength } from "@/lib/password-rules";

describe("hashing", () => {
  it("verifies the password it was given, and nothing else", async () => {
    const digest = await hashPassword("سلة برتقال 1998");

    expect(await verifyPassword("سلة برتقال 1998", digest)).toBe(true);
    expect(await verifyPassword("سلة برتقال 1997", digest)).toBe(false);
    expect(await verifyPassword("", digest)).toBe(false);
  });

  it("never stores the password, and salts every digest separately", async () => {
    const password = "correct-horse-battery";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toContain(password);
    // Two people who choose the same password must not share a digest, or one
    // leaked hash would identify every account using that password.
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, second)).toBe(true);
  });

  it("records its own parameters so they can be raised later", async () => {
    const digest = await hashPassword("a-fine-password-1");
    const [scheme, N, r, p] = digest.split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(needsRehash(digest)).toBe(false);
  });

  it("asks for a rehash when a digest was written with weaker parameters", () => {
    // What a digest from an older, cheaper configuration looks like.
    expect(needsRehash("scrypt$1024$8$1$c2FsdA$aGFzaA")).toBe(true);
  });

  it("treats a malformed digest as a failed sign-in rather than throwing", async () => {
    for (const digest of ["", "not-a-digest", "scrypt$$$$", "bcrypt$2a$10$abc", "scrypt$16384$8$1$$"]) {
      await expect(verifyPassword("anything", digest)).resolves.toBe(false);
    }
  });

  it("refuses parameters that would make scrypt allocate absurd memory", async () => {
    // A tampered row must not turn a sign-in attempt into an OOM kill.
    await expect(verifyPassword("x", "scrypt$1073741824$32$16$c2FsdA$aGFzaA")).resolves.toBe(false);
  });

  it("normalises unicode, so the same typed password verifies either way", async () => {
    // "é" composed vs decomposed — an Arabic or French keyboard can produce
    // either, and the user experiences them as the same key press.
    const composed = "café-password";
    const decomposed = "café-password";

    const digest = await hashPassword(composed);
    expect(await verifyPassword(decomposed, digest)).toBe(true);
  });
});

describe("strength rules", () => {
  it("accepts an ordinary chosen password", () => {
    expect(checkPasswordStrength("mosul-winter-24")).toBeNull();
    expect(checkPasswordStrength("كلمة سر طويلة")).toBeNull();
  });

  it("rejects one shorter than the minimum", () => {
    expect(checkPasswordStrength("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe("too-short");
  });

  it("rejects the passwords that are guessed first", () => {
    expect(checkPasswordStrength("password")).toBe("too-common");
    expect(checkPasswordStrength("12345678")).toBe("too-common");
    // Case is not a defence.
    expect(checkPasswordStrength("PassWord")).toBe("too-common");
  });

  it("rejects a long string that is only one or two characters", () => {
    expect(checkPasswordStrength("aaaaaaaaaaaa")).toBe("no-variety");
    expect(checkPasswordStrength("abababababab")).toBe("no-variety");
  });

  it("rejects a short all-digit password, which is always a date", () => {
    expect(checkPasswordStrength("19980412")).toBe("no-variety");
    // Long enough to be something other than a birthday.
    expect(checkPasswordStrength("481920375610")).toBeNull();
  });

  it("does not demand a symbol", () => {
    // The rule that produces "Password1!" everywhere is the one not applied.
    expect(checkPasswordStrength("qamishli sunrise")).toBeNull();
  });
});
