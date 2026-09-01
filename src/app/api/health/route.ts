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
  const databaseUrl = process.env.DATABASE_URL;
  checks.DATABASE_URL = databaseUrl
    ? { ok: true, detail: `set (${describeDatabaseUrl(databaseUrl)})` }
    : { ok: false, detail: "MISSING — add it in Vercel → Settings → Environment Variables" };

  const sessionSecret = process.env.SESSION_SECRET;
  checks.SESSION_SECRET = !sessionSecret
    ? { ok: false, detail: "MISSING — generate with: openssl rand -base64 48" }
    : sessionSecret.length < 32
      ? { ok: false, detail: `too short (${sessionSecret.length} chars, need 32+)` }
      : sessionSecret.startsWith("dev-only")
        ? { ok: false, detail: "still the development placeholder" }
        : { ok: true, detail: `set (${sessionSecret.length} chars)` };

  const otpProvider = process.env.OTP_PROVIDER ?? "disabled";
  checks.OTP_PROVIDER =
    otpProvider === "console"
      ? { ok: false, detail: "'console' prints login codes to the log; refused in production" }
      : { ok: true, detail: otpProvider };

  checks.OTP_DEV_FIXED_CODE = process.env.OTP_DEV_FIXED_CODE
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
      checks,
      hint:
        failures.length === 0
          ? "All preconditions met."
          : "Fix the entries marked ok:false, then redeploy.",
    },
    {
      status: failures.length === 0 ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
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
