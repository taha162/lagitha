import { NextResponse } from "next/server";

/**
 * Deployment diagnostics.
 *
 * Deliberately imports nothing from `@/lib` — those modules validate
 * configuration at import time and throw, which is exactly the failure this
 * endpoint exists to report. Everything here is read directly from
 * `process.env` inside try/catch so the route can always answer.
 *
 * It reports whether a value is *present and well-formed*, never the value
 * itself: booleans, lengths, and the database host only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Check {
  ok: boolean;
  detail: string;
}

export async function GET() {
  const checks: Record<string, Check> = {};

  // ---- required configuration -------------------------------------------
  const { resolveDatabaseUrl, presentDatabaseUrlKeys, DATABASE_URL_KEYS } = await import(
    "@/lib/database-url"
  );

  const databaseUrl = resolveDatabaseUrl();
  const present = presentDatabaseUrlKeys();
  checks.DATABASE_URL = databaseUrl
    ? { ok: true, detail: `using ${present[0]} (${describeDatabaseUrl(databaseUrl)})` }
    : {
        ok: false,
        detail:
          `none of these is set to a non-empty value: ${DATABASE_URL_KEYS.join(", ")}. ` +
          `${describeDefined(DATABASE_URL_KEYS)}`,
      };

  checks.SESSION_SECRET = describeSecret(process.env.SESSION_SECRET);

  // `??` would let an empty string through; a blank value is a missing value.
  const otpProvider = nonEmpty(process.env.OTP_PROVIDER) ?? "disabled";
  checks.OTP_PROVIDER = describeOtpProvider(otpProvider);

  checks.OTP_DEV_FIXED_CODE = nonEmpty(process.env.OTP_DEV_FIXED_CODE)
    ? { ok: false, detail: "set — must be removed in production" }
    : { ok: true, detail: "not set" };

  // ---- database ----------------------------------------------------------
  if (!databaseUrl) {
    checks.database = { ok: false, detail: "skipped — no DATABASE_URL" };
    checks.schema = { ok: false, detail: "skipped — no DATABASE_URL" };
    checks.referenceData = { ok: false, detail: "skipped — no DATABASE_URL" };
  } else {
    try {
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { PrismaClient } = await import("@/generated/prisma/client");
      const client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });

      try {
        await client.$queryRaw`SELECT 1`;
        checks.database = { ok: true, detail: "reachable" };

        // Has `prisma migrate deploy` ever run against this database?
        try {
          const rows = await client.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'reports'
          `;
          checks.schema =
            Number(rows[0]?.count ?? 0) > 0
              ? { ok: true, detail: "migrations applied" }
              : {
                  ok: false,
                  detail:
                    "NO TABLES — migrations never ran. Expose DATABASE_URL to the Build step and redeploy, or run: npx prisma migrate deploy",
                };
        } catch (error) {
          checks.schema = { ok: false, detail: describeError(error) };
        }

        // Categories and areas must exist or the report wizard is unusable.
        if (checks.schema.ok) {
          try {
            const [categories, areas] = await Promise.all([
              client.category.count(),
              client.area.count(),
            ]);
            checks.referenceData =
              categories > 0 && areas > 0
                ? { ok: true, detail: `${categories} categories, ${areas} areas` }
                : {
                    ok: false,
                    detail: `empty (${categories} categories, ${areas} areas) — run: npm run db:seed`,
                  };
          } catch (error) {
            checks.referenceData = { ok: false, detail: describeError(error) };
          }
        } else {
          checks.referenceData = { ok: false, detail: "skipped — no schema" };
        }
      } finally {
        await client.$disconnect().catch(() => undefined);
      }
    } catch (error) {
      checks.database = { ok: false, detail: describeError(error) };
      checks.schema = { ok: false, detail: "skipped — database unreachable" };
      checks.referenceData = { ok: false, detail: "skipped — database unreachable" };
    }
  }

  const failures = Object.entries(checks)
    .filter(([, check]) => !check.ok)
    .map(([name]) => name);

  return NextResponse.json(
    {
      ok: failures.length === 0,
      failing: failures,
      // Which build answered. On Vercel, every deployment keeps its own
      // permanent URL along with the environment variables it was created
      // with — so adding a variable and then re-reading the *old* deployment
      // URL shows the old answer forever, which looks exactly like the change
      // not having worked. Compare this against the newest deployment.
      deployment: describeDeployment(),
      checks,
      hint:
        failures.length === 0
          ? "All preconditions met."
          : "Fix the entries marked ok:false, redeploy, then re-read this on the NEW deployment URL (or the project's production domain).",
    },
    {
      status: failures.length === 0 ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * SMS delivery: reports whether the chosen driver has everything it needs.
 * `disabled` is flagged because it means nobody can sign in.
 */
function describeOtpProvider(provider: string): Check {
  switch (provider) {
    case "twilio": {
      const missing = [
        !nonEmpty(process.env.TWILIO_ACCOUNT_SID) && "TWILIO_ACCOUNT_SID",
        !nonEmpty(process.env.TWILIO_AUTH_TOKEN) && "TWILIO_AUTH_TOKEN",
        !nonEmpty(process.env.TWILIO_MESSAGING_SERVICE_SID) &&
          !nonEmpty(process.env.TWILIO_FROM) &&
          "TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM",
      ].filter((value): value is string => Boolean(value));

      return missing.length === 0
        ? { ok: true, detail: "twilio — configured" }
        : { ok: false, detail: `twilio selected but missing: ${missing.join(", ")}` };
    }

    case "http":
      return nonEmpty(process.env.SMS_HTTP_URL)
        ? { ok: true, detail: `http gateway — ${describeHost(process.env.SMS_HTTP_URL!)}` }
        : { ok: false, detail: "http selected but SMS_HTTP_URL is not set" };

    case "resend": {
      const missing = [
        !nonEmpty(process.env.RESEND_API_KEY) && "RESEND_API_KEY",
        !nonEmpty(process.env.MAIL_FROM) && "MAIL_FROM",
      ].filter((value): value is string => Boolean(value));

      return missing.length === 0
        ? { ok: true, detail: `resend — sending as ${process.env.MAIL_FROM}` }
        : { ok: false, detail: `resend selected but missing: ${missing.join(", ")}` };
    }

    case "smtp": {
      const host = nonEmpty(process.env.SMTP_HOST);
      const user = nonEmpty(process.env.SMTP_USER);
      const pass = nonEmpty(process.env.SMTP_PASS);

      // Mirrors `mailFrom()` in src/lib/env.ts: an unset MAIL_FROM falls back
      // to the authenticated account, which is the only sender a hosted
      // provider accepts anyway.
      const explicitFrom = nonEmpty(process.env.MAIL_FROM);
      const from = explicitFrom ?? (user ? `لَگيتها <${user}>` : undefined);

      const missing = [
        !host && "SMTP_HOST",
        !from && "MAIL_FROM (or SMTP_USER to derive it from)",
      ].filter((value): value is string => Boolean(value));

      if (missing.length > 0) {
        return { ok: false, detail: `smtp selected but missing: ${missing.join(", ")}` };
      }

      const auth = user && pass ? `authenticating as ${user}` : "NO AUTH SET";
      const derived = explicitFrom ? "" : " (derived from SMTP_USER)";

      // A relay on a private network legitimately needs no credentials, so an
      // unauthenticated transport is not an error — but Gmail, Brevo and every
      // hosted provider will refuse it, and the failure only shows up as a
      // send that silently does not arrive. Say so here instead.
      const senderMismatch =
        user && from && !from.toLowerCase().includes(user.toLowerCase())
          ? " — WARNING: MAIL_FROM does not contain SMTP_USER; Gmail and most providers refuse that"
          : "";

      return {
        ok: true,
        detail:
          `smtp — ${host}:${process.env.SMTP_PORT ?? 587}, ${auth}, ` +
          `sending as ${from}${derived}` +
          senderMismatch,
      };
    }

    case "console":
      return {
        ok: false,
        detail: "'console' prints login codes to the log; refused in production",
      };

    default:
      return {
        ok: false,
        detail:
          "no delivery driver — nobody can sign in. Set OTP_PROVIDER to " +
          "'resend' or 'smtp' (email), or 'twilio' / 'http' (SMS).",
      };
  }
}

/**
 * Identifies the running build. Vercel sets these; anywhere else they are
 * absent and the fields say so rather than being omitted.
 */
function describeDeployment(): Record<string, string> {
  return {
    id: nonEmpty(process.env.VERCEL_DEPLOYMENT_ID) ?? "not on Vercel",
    commit: (nonEmpty(process.env.VERCEL_GIT_COMMIT_SHA) ?? "unknown").slice(0, 7),
    branch: nonEmpty(process.env.VERCEL_GIT_COMMIT_REF) ?? "unknown",
    environment: nonEmpty(process.env.VERCEL_ENV) ?? process.env.NODE_ENV ?? "unknown",
    url: nonEmpty(process.env.VERCEL_URL) ?? "unknown",
  };
}

function describeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable SMS_HTTP_URL";
  }
}

/** Treats a blank value as absent, which is what a dashboard-defined empty is. */
function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Distinguishes "never defined" from "defined but blank" — the two look
 * identical in a dashboard but only one of them looks like a bug.
 */
function describeDefined(keys: readonly string[]): string {
  const defined = keys.filter((key) => process.env[key] !== undefined);
  if (defined.length === 0) return "None of them are defined at all.";
  return `Defined but EMPTY: ${defined.join(", ")} — the variable exists with a blank value.`;
}

function describeSecret(secret: string | undefined): Check {
  if (secret === undefined) {
    return { ok: false, detail: "not defined — generate with: openssl rand -base64 48" };
  }
  if (secret.trim().length === 0) {
    return { ok: false, detail: "defined but EMPTY — paste the value into Vercel and redeploy" };
  }
  if (secret.length < 32) {
    return { ok: false, detail: `too short (${secret.length} chars, need 32+)` };
  }
  if (secret.startsWith("dev-only")) {
    return { ok: false, detail: "still the development placeholder" };
  }
  return { ok: true, detail: `set (${secret.length} chars)` };
}

/** Host and database name only — never the credentials. */
function describeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const sslMode = parsed.searchParams.get("sslmode");
    return [
      parsed.hostname,
      parsed.pathname.replace(/^\//, "") || "(no db name)",
      sslMode ? `sslmode=${sslMode}` : "no sslmode",
    ].join(", ");
  } catch {
    return "unparseable connection string";
  }
}

/** Prisma error code and first line only, so nothing sensitive is echoed back. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = (error as { code?: string }).code;
  const firstLine = error.message.split("\n").find((line) => line.trim().length > 0) ?? "";
  return [code, firstLine.slice(0, 200)].filter(Boolean).join(": ");
}
