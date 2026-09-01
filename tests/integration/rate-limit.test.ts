import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  peekRateLimit,
  pruneExpiredRateLimits,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { resetDatabase, testDb } from "../helpers/db";

beforeAll(resetDatabase);
beforeEach(resetDatabase);

describe("consumeRateLimit", () => {
  it("allows requests up to the limit, then refuses", async () => {
    const limit = RATE_LIMITS.otpRequest.limit;

    for (let index = 0; index < limit; index += 1) {
      const result = await consumeRateLimit("otpRequest", "+9647700000001");
      expect(result.allowed, `attempt ${index + 1}`).toBe(true);
    }

    const blocked = await consumeRateLimit("otpRequest", "+9647700000001");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // The UI needs this to say "try again in N seconds" rather than "no".
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each identifier separately", async () => {
    const limit = RATE_LIMITS.otpRequest.limit;
    for (let index = 0; index < limit; index += 1) {
      await consumeRateLimit("otpRequest", "+9647700000001");
    }

    const other = await consumeRateLimit("otpRequest", "+9647700000002");
    expect(other.allowed).toBe(true);
  });

  it("counts each bucket separately", async () => {
    const limit = RATE_LIMITS.otpRequest.limit;
    for (let index = 0; index < limit; index += 1) {
      await consumeRateLimit("otpRequest", "shared-id");
    }

    expect((await consumeRateLimit("reportCreate", "shared-id")).allowed).toBe(true);
  });

  it("counts correctly under concurrent requests", async () => {
    // The whole reason the counter is a single atomic upsert: two requests
    // arriving together must not both read a stale count.
    const attempts = 12;
    const results = await Promise.all(
      Array.from({ length: attempts }, () => consumeRateLimit("otpRequest", "+9647700000009")),
    );

    const allowed = results.filter((result) => result.allowed).length;
    expect(allowed).toBe(RATE_LIMITS.otpRequest.limit);

    const row = await testDb.rateLimit.findUniqueOrThrow({
      where: { bucket: "otpRequest:+9647700000009" },
    });
    expect(row.count).toBe(attempts);
  });

  it("starts a fresh window once the old one expires", async () => {
    const limit = RATE_LIMITS.otpRequest.limit;
    for (let index = 0; index < limit; index += 1) {
      await consumeRateLimit("otpRequest", "+9647700000003");
    }
    expect((await consumeRateLimit("otpRequest", "+9647700000003")).allowed).toBe(false);

    // Wind the window back past its end.
    await testDb.rateLimit.update({
      where: { bucket: "otpRequest:+9647700000003" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const afterReset = await consumeRateLimit("otpRequest", "+9647700000003");
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(limit - 1);
  });
});

describe("peekRateLimit", () => {
  it("reads without consuming", async () => {
    await consumeRateLimit("otpRequest", "+9647700000004");

    const before = await peekRateLimit("otpRequest", "+9647700000004");
    const after = await peekRateLimit("otpRequest", "+9647700000004");

    expect(before.remaining).toBe(after.remaining);
    expect(before.remaining).toBe(RATE_LIMITS.otpRequest.limit - 1);
  });

  it("reports a full allowance for an untouched bucket", async () => {
    const result = await peekRateLimit("reportCreate", "nobody");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMITS.reportCreate.limit);
  });
});

describe("pruneExpiredRateLimits", () => {
  it("removes only expired rows", async () => {
    await consumeRateLimit("otpRequest", "keep-me");
    await consumeRateLimit("otpRequest", "drop-me");
    await testDb.rateLimit.update({
      where: { bucket: "otpRequest:drop-me" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await pruneExpiredRateLimits()).toBe(1);
    expect(await testDb.rateLimit.count()).toBe(1);
  });
});
