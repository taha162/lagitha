import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, testDb } from "../helpers/db";

/**
 * The first administrator.
 *
 * `ADMIN_EMAILS` is the only way into a console that otherwise requires a
 * console user to let you in, so it is worth pinning down exactly how far it
 * reaches: it promotes an existing account on sign-in and does nothing else.
 * The tests that matter here are the negatives — that it creates no account,
 * skips no password, and demotes nobody when an address leaves the list.
 */

// Runs before the module imports below, which is when env.ts reads the value.
vi.hoisted(() => {
  process.env.ADMIN_EMAILS = "owner@test.local, Second.Owner@Test.Local";
  // Fixes every one-time code so the sign-up path can be walked without a mail
  // server. Refused in production by env.ts.
  process.env.OTP_DEV_FIXED_CODE = "000000";
});

// The sign-in path sets a session cookie and reads request headers; neither
// exists outside a request, and neither is what this file is testing.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

const { completeSignup, loginWithPassword, startSignup } = await import("@/lib/auth");
const { hashPassword } = await import("@/lib/password");

const PASSWORD = "correct-horse-battery-staple";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  cookieJar.clear();
});

async function seedAccount(email: string, role: "MEMBER" | "MODERATOR" | "ADMIN" = "MEMBER") {
  return testDb.user.create({
    data: {
      email,
      displayName: "صاحب الحساب",
      role,
      status: "ACTIVE",
      verifiedAt: new Date(),
      passwordHash,
    },
  });
}

describe("first-administrator bootstrap", () => {
  it("promotes a listed account on sign-in and records why", async () => {
    const before = await seedAccount("owner@test.local");
    expect(before.role).toBe("MEMBER");

    const result = await loginWithPassword("owner@test.local", PASSWORD);
    expect(result.ok).toBe(true);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.role).toBe("ADMIN");

    // A change to who can delete accounts must not be invisible.
    const audit = await testDb.adminAction.findMany({ where: { entityId: before.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: before.id,
      action: "role.bootstrap",
      entityType: "user",
      metadata: { from: "MEMBER", to: "ADMIN", source: "ADMIN_EMAILS" },
    });
  });

  it("matches the address case-insensitively", async () => {
    // Listed as "Second.Owner@Test.Local"; stored lowercased, as addresses are.
    const user = await seedAccount("second.owner@test.local");

    await loginWithPassword("second.owner@test.local", PASSWORD);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.role).toBe("ADMIN");
  });

  it("leaves an unlisted account alone", async () => {
    const user = await seedAccount("someone.else@test.local");

    const result = await loginWithPassword("someone.else@test.local", PASSWORD);
    expect(result.ok).toBe(true);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.role).toBe("MEMBER");
    expect(await testDb.adminAction.count()).toBe(0);
  });

  it("does not skip the password", async () => {
    const user = await seedAccount("owner@test.local");

    const result = await loginWithPassword("owner@test.local", "not-the-password");
    expect(result).toMatchObject({ ok: false, reason: "invalid-credentials" });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.role).toBe("MEMBER");
  });

  it("does not create an account for a listed address that has none", async () => {
    const result = await loginWithPassword("owner@test.local", PASSWORD);
    expect(result).toMatchObject({ ok: false });

    expect(await testDb.user.count()).toBe(0);
  });

  it("does not demote an administrator who is not on the list", async () => {
    // The realistic case: the variable is edited or dropped after setup. An
    // accidental edit must not lock the team out of their own console.
    const user = await seedAccount("veteran@test.local", "ADMIN");

    await loginWithPassword("veteran@test.local", PASSWORD);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.role).toBe("ADMIN");
  });

  it("promotes at the end of sign-up, without a second sign-in", async () => {
    // The other order the owner may do this in: set the variable first, then
    // create the account.
    const started = await startSignup({
      identifier: "owner@test.local",
      displayName: "صاحب الموقع",
      password: PASSWORD,
    });
    expect(started.ok).toBe(true);

    const finished = await completeSignup("owner@test.local", "000000");
    expect(finished.ok).toBe(true);

    const user = await testDb.user.findUniqueOrThrow({
      where: { email: "owner@test.local" },
    });
    expect(user.role).toBe("ADMIN");
  });

  it("promotes once, not on every sign-in", async () => {
    const user = await seedAccount("owner@test.local");

    await loginWithPassword("owner@test.local", PASSWORD);
    await loginWithPassword("owner@test.local", PASSWORD);

    expect(await testDb.adminAction.count({ where: { entityId: user.id } })).toBe(1);
  });
});
