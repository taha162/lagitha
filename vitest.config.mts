import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests are pure. Integration tests run against a real PostgreSQL
 * database (TEST_DATABASE_URL) — mocking Prisma would test the mock, and the
 * things most worth testing here (privacy boundaries, authorization,
 * rate-limit races) only exist at the database edge.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database; running files in parallel would
    // have them truncating each other's rows.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      // `server-only` throws by design when imported outside a server
      // component graph. Under Node it is a no-op guard.
      "server-only": path.resolve(root, "./tests/stubs/server-only.ts"),
    },
  },
});
