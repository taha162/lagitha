import "server-only";
import { prisma } from "./db";

/**
 * Fixed-window rate limiting, stored in Postgres.
 *
 * A single-region MVP does not need Redis, and putting the counters in the
 * database keeps them correct across the app's processes and survives a
 * restart. The interface is narrow enough to swap later.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Used for the Arabic "try again in N". */
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/**
 * The rules that actually protect the product. Deliberately few: everything
 * here is either an abuse vector or a cost centre (§28).
 */
export const RATE_LIMITS = {
  /** OTP requests per phone number. */
  otpRequest: { limit: 5, windowSeconds: 60 * 60 },
  /** OTP requests per IP, to stop enumeration across many numbers. */
  otpRequestPerIp: { limit: 20, windowSeconds: 60 * 60 },
  /** Code submissions per phone number. */
  otpVerify: { limit: 10, windowSeconds: 15 * 60 },
  /** Password attempts per account — what makes a weak password survivable. */
  passwordLogin: { limit: 10, windowSeconds: 15 * 60 },
  /** Password attempts per IP, to stop spraying one password across accounts. */
  passwordLoginPerIp: { limit: 50, windowSeconds: 15 * 60 },
  /** National ID submissions per user per day. */
  identitySubmit: { limit: 5, windowSeconds: 24 * 60 * 60 },
  /** Reports created per user per day. */
  reportCreate: { limit: 10, windowSeconds: 24 * 60 * 60 },
  /** Image uploads per user per hour. */
  imageUpload: { limit: 40, windowSeconds: 60 * 60 },
  /** Messages per user per hour. */
  messageSend: { limit: 120, windowSeconds: 60 * 60 },
  /** Ownership claims per user per day — the main fraud lever. */
  verificationClaim: { limit: 8, windowSeconds: 24 * 60 * 60 },
  /** Abuse flags per user per day. */
  flagCreate: { limit: 20, windowSeconds: 24 * 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Consumes one unit from a bucket.
 *
 * Uses a single atomic upsert so two concurrent requests cannot both read a
 * stale count. Window rollover is handled by comparing `expiresAt`.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const bucket = `${name}:${identifier}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + rule.windowSeconds * 1000);

  const rows = await prisma.$queryRaw<
    { count: number; expiresAt: Date }[]
  >`
    INSERT INTO "rate_limits" ("id", "bucket", "count", "windowStart", "expiresAt")
    VALUES (gen_random_uuid()::text, ${bucket}, 1, ${now}, ${expiresAt})
    ON CONFLICT ("bucket") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limits"."expiresAt" <= ${now} THEN 1
        ELSE "rate_limits"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "rate_limits"."expiresAt" <= ${now} THEN ${now}
        ELSE "rate_limits"."windowStart"
      END,
      "expiresAt" = CASE
        WHEN "rate_limits"."expiresAt" <= ${now} THEN ${expiresAt}
        ELSE "rate_limits"."expiresAt"
      END
    RETURNING "count", "expiresAt"
  `;

  const row = rows[0];
  if (!row) {
    // Should not happen; fail open rather than locking users out of the product.
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: row.count <= rule.limit,
    remaining: Math.max(0, rule.limit - row.count),
    retryAfterSeconds,
  };
}

/** Reads a bucket without consuming from it. */
export async function peekRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const record = await prisma.rateLimit.findUnique({ where: { bucket: `${name}:${identifier}` } });
  const now = Date.now();

  if (!record || record.expiresAt.getTime() <= now) {
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }

  return {
    allowed: record.count < rule.limit,
    remaining: Math.max(0, rule.limit - record.count),
    retryAfterSeconds: Math.max(0, Math.ceil((record.expiresAt.getTime() - now) / 1000)),
  };
}

/** Housekeeping for a cron job; harmless to call at any time. */
export async function pruneExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
