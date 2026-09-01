/**
 * Points every module that reads DATABASE_URL at the test database, before any
 * of them are imported. Vitest runs setup files ahead of the test module graph,
 * which is what makes this work.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://lagaitha:lagaitha@127.0.0.1:5432/lagaitha_test";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-test-secret";
process.env.OTP_PROVIDER ??= "console";
process.env.STORAGE_DRIVER ??= "local";
process.env.STORAGE_LOCAL_DIR ??= "./storage-test";
process.env.AI_PROVIDER ??= "none";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";

export {};
