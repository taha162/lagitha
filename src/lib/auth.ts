import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { User } from "@/generated/prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { otp } from "./providers/otp";
import { consumeRateLimit } from "./rate-limit";
import { normalizePhone } from "./phone";

/**
 * Authentication.
 *
 * Phone + one-time code, because the target audience has phones and not
 * necessarily email, and because a password is one more thing to lose. There
 * is no password to leak and nothing to reset.
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

export type StartLoginResult =
  | { ok: true; phone: string; developmentDriver: boolean }
  | { ok: false; reason: "invalid-phone" | "rate-limited" | "delivery-failed"; retryAfterSeconds?: number };

export async function startLogin(rawPhone: string): Promise<StartLoginResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "invalid-phone" };

  const ip = await requestIp();

  const perPhone = await consumeRateLimit("otpRequest", phone);
  if (!perPhone.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: perPhone.retryAfterSeconds };
  }

  if (ip) {
    const perIp = await consumeRateLimit("otpRequestPerIp", hashIp(ip)!);
    if (!perIp.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: perIp.retryAfterSeconds };
    }
  }

  // A fixed development code keeps the seeded demo accounts usable without an
  // SMS gateway. `env` refuses to expose it when NODE_ENV=production.
  const code = env.otpFixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");

  // Older challenges for this number stop being valid the moment a new one is
  // issued, so a leaked code has a very short life.
  await prisma.otpChallenge.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.otpChallenge.create({
    data: {
      phone,
      codeHash: sha256(`${salt}:${code}`),
      salt,
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    },
  });

  const provider = otp();
  const delivered = await provider.send(phone, code);
  if (!delivered) return { ok: false, reason: "delivery-failed" };

  return { ok: true, phone, developmentDriver: provider.isDevelopmentDriver };
}

export type VerifyLoginResult =
  | { ok: true; user: User; isNewUser: boolean }
  | {
      ok: false;
      reason: "invalid-phone" | "invalid-code" | "expired" | "rate-limited" | "suspended";
      retryAfterSeconds?: number;
    };

export async function verifyLogin(
  rawPhone: string,
  rawCode: string,
): Promise<VerifyLoginResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "invalid-phone" };

  const limit = await consumeRateLimit("otpVerify", phone);
  if (!limit.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const code = rawCode.replace(/\D/g, "");
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null },
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
    data: { consumedAt: new Date() },
  });

  const existing = await prisma.user.findUnique({ where: { phone } });

  if (existing) {
    if (existing.status === "BANNED") return { ok: false, reason: "suspended" };
    if (
      existing.status === "SUSPENDED" &&
      (!existing.suspendedUntil || existing.suspendedUntil.getTime() > Date.now())
    ) {
      return { ok: false, reason: "suspended" };
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        verifiedAt: existing.verifiedAt ?? new Date(),
        // A lapsed suspension clears itself on next sign-in.
        ...(existing.status === "SUSPENDED" ? { status: "ACTIVE" as const, suspendedUntil: null } : {}),
      },
    });
    await createSession(user.id);
    return { ok: true, user, isNewUser: false };
  }

  const user = await prisma.user.create({
    data: {
      phone,
      // Placeholder until the user picks a name on the next screen.
      displayName: "مستخدم جديد",
      verifiedAt: new Date(),
    },
  });
  await createSession(user.id);
  return { ok: true, user, isNewUser: true };
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

