import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of `schema.prisma`.
 * Migration / introspection commands read it from here; the runtime client
 * gets it through the pg driver adapter in `src/lib/db.ts`.
 *
 * Read straight from `process.env` rather than Prisma's `env()` helper: that
 * helper throws `PrismaConfigEnvError` the moment the config is loaded, and the
 * config is loaded by every Prisma command — including `prisma generate`, which
 * needs no database at all. Generating the client must not require a
 * connection URL. Commands that genuinely need one (`migrate deploy`) still get
 * it from the same environment variable.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
