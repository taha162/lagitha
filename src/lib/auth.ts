import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { OtpPurpose, User } from "@/generated/prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { otp } from "./providers/otp";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { consumeRateLimit } from "./rate-limit";
import { normalizePhone } from "./phone";
import { normalizeEmail } from "./email";
import type { OtpChannel } from "./providers/otp";

/**
 * Authentication.
 *
 * An account is created once, deliberately: address, name and a password, with
 * a one-time code in the middle to prove the address exists. After that,
 * signing in is the password — a person reporting a lost wallet from a borrowed
 * phone should not have to wait for an email to arrive.
 *
 * The one-time code did not go away, it moved: it proves the address at sign-up,
 * it resets a forgotten password, and it still signs in the accounts that
 * predate passwords (`passwordHash` is null for those). One delivery mechanism,
 * three purposes, and the purpose is part of the lookup — a code issued to
 * confirm an address must not be redeemable to reset a password.
 *
 * Sessions are opaque random tokens stored as SHA-256 hashes: the raw token
 * exists only in the user's cookie, and any session can be revoked server-side
 * (which a stateless JWT could not do).
 */

const SESSION_COOKIE = "lagaitha_session";
const SESSION_TTL_DAYS = 60;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** IPs are only ever stored hashed — we need them for abuse limits, not identity. */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env.sessionSecret}:${ip}`).digest("hex").slice(0, 32);
}

async function requestIp(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return headerList.get("x-real-ip");
}

// --------------------------------------------------------------- OTP ------

/**
 * The login identifier: an email address or an E.164 phone number, depending
 * on which delivery driver is configured. Normalising here — rather than at
 * each call site — is what keeps the UNIQUE key on `users` meaningful.
 */
export interface NormalizedIdentifier {
  value: string;
  channel: OtpChannel;
}

export function normalizeIdentifier(raw: string): NormalizedIdentifier | null {
  const channel = otp().channel;

  if (channel === "email") {
    const email = normalizeEmail(raw);
    return email ? { value: email, channel: "email" } : null;
  }

  const phone = normalizePhone(raw);
  return phone ? { value: phone, channel: "sms" } : null;
}

/** What the sign-in screen should ask for. */
export function authChannel(): OtpChannel {
  return otp().channel;
}

/** Where a normalised identifier lives on `users`. */
function identifierWhere(identifier: NormalizedIdentifier) {
  return identifier.channel === "email"
    ? { email: identifier.value }
    : { phone: identifier.value };
}

export type SendCodeResult =
  | { ok: true; identifier: string; channel: OtpChannel; developmentDriver: boolean }
  | { ok: false; reason: "rate-limited" | "delivery-failed"; retryAfterSeconds?: number };

/**
 * Issues and delivers a code for one purpose.
 *
 * Older unconsumed challenges for the same identifier and purpose are burned
 * first, so a leaked code has a very short life, and a resend cannot leave two
 * valid codes in flight.
 */
async function sendCode(
  identifier: NormalizedIdentifier,
  purpose: OtpPurpose,
  payload?: Record<string, unknown>,
): Promise<SendCodeResult> {
  const perIdentifier = await consumeRateLimit("otpRequest", identifier.value);
  if (!perIdentifier.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: perIdentifier.retryAfterSeconds };
  }

  const ip = await requestIp();
  if (ip) {
    const perIp = await consumeRateLimit("otpRequestPerIp", hashIp(ip)!);
    if (!perIp.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: perIp.retryAfterSeconds };
    }
  }

  // A fixed development code keeps the seeded demo accounts usable without a
  // mail server. `env` refuses to expose it when NODE_ENV=production.
  const code = env.otpFixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");

  await prisma.otpChallenge.updateMany({
    where: { identifier: identifier.value, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.otpChallenge.create({
    data: {
      identifier: identifier.value,
      channel: identifier.channel === "email" ? "EMAIL" : "SMS",
      purpose,
      codeHash: sha256(`${salt}:${code}`),
      salt,
      payload: (payload ?? undefined) as never,
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    },
  });

  const provider = otp();
  const delivered = await provider.send(identifier.value, code);
  if (!delivered) return { ok: false, reason: "delivery-failed" };

  return {
    ok: true,
    identifier: identifier.value,
    channel: identifier.channel,
    developmentDriver: provider.isDevelopmentDriver,
  };
}

type ConsumeCodeResult =
  | { ok: true; payload: Record<string, unknown> | null }
  | { ok: false; reason: "invalid-code" | "expired" | "rate-limited"; retryAfterSeconds?: number };

/** Checks a submitted code and, on success, marks it spent. */
async function consumeCode(
  identifier: NormalizedIdentifier,
  rawCode: string,
  purpose: OtpPurpose,
): Promise<ConsumeCodeResult> {
  const limit = await consumeRateLimit("otpVerify", identifier.value);
  if (!limit.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const code = rawCode.replace(/\D/g, "");
  const challenge = await prisma.otpChallenge.findFirst({
    where: { identifier: identifier.value, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) return { ok: false, reason: "expired" };
  if (challenge.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "expired" };

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(sha256(`${challenge.salt}:${code}`), "hex");
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid-code" };
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    // The payload is cleared with the same write: a spent signup challenge has
    // no reason to keep holding a password hash.
    data: { consumedAt: new Date(), payload: undefined },
  });

  return {
    ok: true,
    payload: (challenge.payload as Record<string, unknown> | null) ?? null,
  };
}

/** Shared gate: a banned or currently-suspended account cannot open a session. */
function accountBlocked(user: Pick<User, "status" | "suspendedUntil">): boolean {
  if (user.status === "BANNED") return true;
  return (
    user.status === "SUSPENDED" &&
    (!user.suspendedUntil || user.suspendedUntil.getTime() > Date.now())
  );
}

/** Records the sign-in and lets a lapsed suspension clear itself. */
async function markSignedIn(user: User): Promise<User> {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastSeenAt: new Date(),
      verifiedAt: user.verifiedAt ?? new Date(),
      ...(user.status === "SUSPENDED"
        ? { status: "ACTIVE" as const, suspendedUntil: null }
        : {}),
    },
  });

  return applyAdminBootstrap(updated);
}

/**
 * The first administrator.
 *
 * Every other role change goes through the console, which needs an
 * administrator to already exist — so on a fresh production database, where the
 * seed refuses to create demo accounts, nobody can ever get in. This is the one
 * door out of that circle: the owner writes their own address into ADMIN_EMAILS
 * where they host the site, and their next sign-in promotes the account.
 *
 * Three things keep it from being a back door. It only ever touches an account
 * that already exists and has just proved it owns the address — no account is
 * created here, and no password is bypassed. It is writable only by whoever
 * controls the deployment's environment, who could reach the database directly
 * anyway. And it is written to the audit log, so a promotion is visible in the
 * console rather than being a silent change of who can delete what.
 *
 * Removing an address does not demote anyone: that would make an accidental
 * edit to an environment variable lock the whole team out. Demote from the
 * console, which is the deliberate act.
 */
async function applyAdminBootstrap(user: User): Promise<User> {
  if (user.role === "ADMIN") return user;
  if (!user.email) return user;
  if (!env.adminEmails.includes(user.email.toLowerCase())) return user;

  const promoted = await prisma.user.update({
    where: { id: user.id },
    data: { role: "ADMIN" },
  });

  await prisma.adminAction.create({
    data: {
      actorId: user.id,
      action: "role.bootstrap",
      entityType: "user",
      entityId: user.id,
      metadata: { from: user.role, to: "ADMIN", source: "ADMIN_EMAILS" },
    },
  });

  return promoted;
}

// ------------------------------------------------------------- sign-up -----

export interface SignupDraft {
  identifier: string;
  displayName: string;
  password: string;
}

export type StartSignupResult =
  | { ok: true; identifier: string; channel: OtpChannel; developmentDriver: boolean }
  | {
      ok: false;
      reason: "invalid-identifier" | "taken" | "rate-limited" | "delivery-failed";
      retryAfterSeconds?: number;
    };

/**
 * Step one of creating an account. The name and the (already hashed) password
 * ride along on the challenge rather than on a half-built `users` row: until
 * the address answers, it has not earned the unique key, and nobody can park on
 * someone else's address by starting a sign-up they never finish.
 */
export async function startSignup(draft: SignupDraft): Promise<StartSignupResult> {
  const identifier = normalizeIdentifier(draft.identifier);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const existing = await prisma.user.findUnique({ where: identifierWhere(identifier) });
  if (existing) return { ok: false, reason: "taken" };

  const passwordHash = await hashPassword(draft.password);
  const result = await sendCode(identifier, "SIGNUP", {
    displayName: draft.displayName,
    passwordHash,
  });

  return result.ok
    ? result
    : { ok: false, reason: result.reason, retryAfterSeconds: result.retryAfterSeconds };
}

export type CompleteSignupResult =
  | { ok: true; user: User }
  | {
      ok: false;
      reason: "invalid-identifier" | "invalid-code" | "expired" | "rate-limited" | "taken";
      retryAfterSeconds?: number;
    };

/** Step two: the address answered, so the account becomes real. */
export async function completeSignup(
  raw: string,
  rawCode: string,
): Promise<CompleteSignupResult> {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const consumed = await consumeCode(identifier, rawCode, "SIGNUP");
  if (!consumed.ok) {
    return { ok: false, reason: consumed.reason, retryAfterSeconds: consumed.retryAfterSeconds };
  }

  const displayName = typeof consumed.payload?.displayName === "string"
    ? consumed.payload.displayName
    : null;
  const passwordHash = typeof consumed.payload?.passwordHash === "string"
    ? consumed.payload.passwordHash
    : null;

  // A challenge without its payload cannot produce an account. Sending the
  // person back to the first screen is the only honest outcome.
  if (!displayName || !passwordHash) return { ok: false, reason: "expired" };

  // Someone else may have registered the address in the ten minutes the code
  // was valid for.
  const taken = await prisma.user.findUnique({ where: identifierWhere(identifier) });
  if (taken) return { ok: false, reason: "taken" };

  const created = await prisma.user.create({
    data: {
      ...identifierWhere(identifier),
      displayName,
      passwordHash,
      verifiedAt: new Date(),
    },
  });

  // Also here, not only on sign-in: the owner of a fresh deployment may well
  // set ADMIN_EMAILS before creating their account, and being told to sign out
  // and back in to finish a sign-up would be a strange first impression.
  const user = await applyAdminBootstrap(created);

  await createSession(user.id);
  return { ok: true, user };
}

// ------------------------------------------------------ password sign-in ---

export type PasswordLoginResult =
  | { ok: true; user: User }
  | {
      ok: false;
      reason: "invalid-identifier" | "invalid-credentials" | "no-password" | "suspended" | "rate-limited";
      retryAfterSeconds?: number;
    };

export async function loginWithPassword(
  raw: string,
  password: string,
): Promise<PasswordLoginResult> {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const limit = await consumeRateLimit("passwordLogin", identifier.value);
  if (!limit.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const ip = await requestIp();
  if (ip) {
    const perIp = await consumeRateLimit("passwordLoginPerIp", hashIp(ip)!);
    if (!perIp.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: perIp.retryAfterSeconds };
    }
  }

  const user = await prisma.user.findUnique({ where: identifierWhere(identifier) });

  // An unknown address and a wrong password give the same answer: anything else
  // turns this form into a way to find out who has an account here.
  if (!user) return { ok: false, reason: "invalid-credentials" };

  // Accounts that predate passwords, and accounts created by staff. They sign
  // in with a code and can set a password from the "forgot" screen.
  if (!user.passwordHash) return { ok: false, reason: "no-password" };

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, reason: "invalid-credentials" };
  }

  if (accountBlocked(user)) return { ok: false, reason: "suspended" };

  // Upgrade the digest transparently when the cost parameters have moved on.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  const signedIn = await markSignedIn(user);
  await createSession(signedIn.id);
  return { ok: true, user: signedIn };
}

// ------------------------------------------------------- code sign-in ------

export type StartLoginResult =
  | { ok: true; identifier: string; channel: OtpChannel; developmentDriver: boolean }
  | {
      ok: false;
      reason: "invalid-identifier" | "rate-limited" | "delivery-failed";
      retryAfterSeconds?: number;
    };

/** The code path, kept for accounts with no password set. */
export async function startLogin(raw: string): Promise<StartLoginResult> {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const result = await sendCode(identifier, "LOGIN");
  return result.ok
    ? result
    : { ok: false, reason: result.reason, retryAfterSeconds: result.retryAfterSeconds };
}

export type VerifyLoginResult =
  | { ok: true; user: User }
  | {
      ok: false;
      reason:
        | "invalid-identifier"
        | "invalid-code"
        | "expired"
        | "rate-limited"
        | "suspended"
        | "no-account";
      retryAfterSeconds?: number;
    };

export async function verifyLogin(raw: string, rawCode: string): Promise<VerifyLoginResult> {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const consumed = await consumeCode(identifier, rawCode, "LOGIN");
  if (!consumed.ok) {
    return { ok: false, reason: consumed.reason, retryAfterSeconds: consumed.retryAfterSeconds };
  }

  const existing = await prisma.user.findUnique({ where: identifierWhere(identifier) });
  // Signing in no longer creates accounts. An account is made once, on the
  // sign-up screen, where a name and a password are actually collected.
  if (!existing) return { ok: false, reason: "no-account" };
  if (accountBlocked(existing)) return { ok: false, reason: "suspended" };

  const user = await markSignedIn(existing);
  await createSession(user.id);
  return { ok: true, user };
}

// ---------------------------------------------------- password reset -------

export type StartPasswordResetResult =
  | { ok: true; identifier: string; developmentDriver: boolean; delivered: boolean }
  | {
      ok: false;
      reason: "invalid-identifier" | "rate-limited" | "delivery-failed";
      retryAfterSeconds?: number;
    };

/**
 * Sends a reset code — but only to an address that has an account.
 *
 * For an unknown address it reports success without sending anything: the
 * screen must not answer the question "does this person have an account here?".
 */
export async function startPasswordReset(raw: string): Promise<StartPasswordResetResult> {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const user = await prisma.user.findUnique({ where: identifierWhere(identifier) });
  if (!user || user.status === "BANNED") {
    return { ok: true, identifier: identifier.value, developmentDriver: false, delivered: false };
  }

  const result = await sendCode(identifier, "PASSWORD_RESET");
  if (!result.ok) {
    return { ok: false, reason: result.reason, retryAfterSeconds: result.retryAfterSeconds };
  }

  return {
    ok: true,
    identifier: result.identifier,
    developmentDriver: result.developmentDriver,
    delivered: true,
  };
}

export type CompletePasswordResetResult =
  | { ok: true; user: User }
  | {
      ok: false;
      reason:
        | "invalid-identifier"
        | "invalid-code"
        | "expired"
        | "rate-limited"
        | "suspended"
        | "no-account";
      retryAfterSeconds?: number;
    };

/**
 * Sets a new password and signs the person in.
 *
 * Every other session is destroyed first: whoever knew the old password — which
 * is the usual reason for resetting one — loses their access at the same
 * moment.
 */
export async function completePasswordReset(
  raw: string,
  rawCode: string,
  password: string,
): Promise<CompletePasswordResetResult> {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) return { ok: false, reason: "invalid-identifier" };

  const consumed = await consumeCode(identifier, rawCode, "PASSWORD_RESET");
  if (!consumed.ok) {
    return { ok: false, reason: consumed.reason, retryAfterSeconds: consumed.retryAfterSeconds };
  }

  const existing = await prisma.user.findUnique({ where: identifierWhere(identifier) });
  if (!existing) return { ok: false, reason: "no-account" };
  if (accountBlocked(existing)) return { ok: false, reason: "suspended" };

  const passwordHash = await hashPassword(password);
  await prisma.session.deleteMany({ where: { userId: existing.id } });

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash,
      lastSeenAt: new Date(),
      verifiedAt: existing.verifiedAt ?? new Date(),
      ...(existing.status === "SUSPENDED"
        ? { status: "ACTIVE" as const, suspendedUntil: null }
        : {}),
    },
  });

  await createSession(user.id);
  return { ok: true, user };
}

/** Changing a password from inside the account, where the old one is known. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid-credentials" }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, reason: "invalid-credentials" };

  // An account with no password yet (a code-only account) can set one without
  // proving the old one — there is none to prove.
  if (user.passwordHash && !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, reason: "invalid-credentials" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  return { ok: true };
}

// ----------------------------------------------------------- sessions -----

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const headerList = await headers();

  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      userAgent: headerList.get("user-agent")?.slice(0, 255) ?? null,
      ipHash: hashIp(await requestIp()),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Current user, or null. Memoised per request so a page that checks auth in
 * the layout, the nav and three components still issues one query.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.status === "BANNED") return null;

  return session.user;
});

