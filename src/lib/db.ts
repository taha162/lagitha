import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * Single database entry point. Nothing else in the app constructs a client.
 *
 * Prisma 7 talks to Postgres through a driver adapter, so the pool lives here
 * too; in development we cache both on `globalThis` to survive hot reloads.
 */
const globalForPrisma = globalThis as unknown as {
  lagaithaPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({
    adapter,
    log: env.isProduction ? ["warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.lagaithaPrisma ?? createClient();

if (!env.isProduction) {
  globalForPrisma.lagaithaPrisma = prisma;
}
