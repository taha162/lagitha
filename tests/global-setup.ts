import { execFileSync } from "node:child_process";

/**
 * Brings the test database up to the current schema once per run.
 * `migrate deploy` is idempotent, so this is safe to re-run.
 */
export async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://lagaitha:lagaitha@127.0.0.1:5432/lagaitha_test";

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
