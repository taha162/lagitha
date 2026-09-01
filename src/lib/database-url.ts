/**
 * Resolving the Postgres connection string.
 *
 * Vercel's database integrations do not all provision the same variable name:
 * a Neon/Vercel Postgres integration typically creates `POSTGRES_PRISMA_URL`
 * and `POSTGRES_URL` rather than `DATABASE_URL`. Accept whichever one the
 * deployment actually has instead of insisting on a single name.
 *
 * Order matters: pooled connection strings come first because that is what a
 * serverless deployment wants; the non-pooled ones are the fallback.
 *
 * Plain TypeScript with no imports so that `prisma.config.ts` (which runs
 * outside the Next.js module graph) can use exactly the same logic.
 */
export const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

/**
 * First non-empty candidate, or undefined.
 * An empty string counts as absent — a variable defined with a blank value in a
 * dashboard is a missing variable, not a valid connection string.
 */
export function resolveDatabaseUrl(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const key of DATABASE_URL_KEYS) {
    const value = source[key];
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Which of the accepted names this environment actually provides. */
export function presentDatabaseUrlKeys(
  source: Record<string, string | undefined> = process.env,
): string[] {
  return DATABASE_URL_KEYS.filter((key) => {
    const value = source[key];
    return Boolean(value && value.trim().length > 0);
  });
}
