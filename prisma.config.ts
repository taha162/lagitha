import path from "node:path";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of `schema.prisma`.
 * Migration / introspection commands read it from here; the runtime client
 * gets it through the pg driver adapter in `src/lib/db.ts`.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
