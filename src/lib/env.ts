import "server-only";

/**
 * Every environment variable the server reads is declared here, so a missing
 * or malformed value fails loudly at startup instead of surfacing as a strange
 * runtime error three screens deep.
 */

/**
 * `next build` runs with NODE_ENV=production but without the deployment's real
 * secrets. Compiling is not running, so the production guards are relaxed
 * during the build and enforced when the server actually starts.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function required(name: string, fallbackInDev?: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (
    (process.env.NODE_ENV !== "production" || isBuildPhase) &&
    fallbackInDev !== undefined
  ) {
    return fallbackInDev;
  }
  throw new Error(
    `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
  );
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === "production";

export const env = {
  isProduction,
  isTest: process.env.NODE_ENV === "test",

  databaseUrl: required(
    "DATABASE_URL",
    "postgresql://lagaitha:lagaitha@127.0.0.1:5432/lagaitha_dev",
  ),

  sessionSecret: required(
    "SESSION_SECRET",
    "dev-only-change-me-dev-only-change-me-dev-only-1234",
  ),

  otpProvider: optional("OTP_PROVIDER", isProduction ? "disabled" : "console"),
  /** Development shortcut so demo accounts can sign in without an SMS gateway. */
  otpFixedCode: isProduction ? undefined : process.env.OTP_DEV_FIXED_CODE,

  storageDriver: optional("STORAGE_DRIVER", "local"),
  storageLocalDir: optional("STORAGE_LOCAL_DIR", "./storage"),
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
  },

  uploadMaxBytes: integer("UPLOAD_MAX_BYTES", 8 * 1024 * 1024),

  aiProvider: optional("AI_PROVIDER", "none"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  siteUrl: optional("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  siteNoindex: optional("SITE_NOINDEX", "0") === "1",
} as const;

if (isProduction && !isBuildPhase) {
  if (env.sessionSecret.startsWith("dev-only") || env.sessionSecret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be a real secret of at least 32 characters in production. " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  if (env.otpFixedCode) {
    throw new Error("OTP_DEV_FIXED_CODE must not be set in production.");
  }
  if (env.otpProvider === "console") {
    throw new Error(
      "OTP_PROVIDER=console prints login codes to the server log. Configure a real SMS driver before going live.",
    );
  }
}
