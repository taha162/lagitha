import "server-only";
import { DATABASE_URL_KEYS, resolveDatabaseUrl } from "./database-url";

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

/** Brand name on outgoing mail, so the sender is not a bare address. */
const MAIL_DISPLAY_NAME = "لَگيتها";

/**
 * The sender address for SMTP.
 *
 * Falls back to the authenticated account when MAIL_FROM is not set, because
 * for every hosted provider that is the only sender they will accept anyway:
 * Gmail, Brevo and the rest reject a From: that is not the account that
 * authenticated. Deriving it removes a second variable to get wrong — and
 * getting it wrong produced mail that silently never arrived.
 *
 * MAIL_FROM still wins when set, which is what a self-hosted relay or a
 * verified domain needs.
 */
function mailFrom(): string | undefined {
  const explicit = process.env.MAIL_FROM;
  if (explicit && explicit.trim().length > 0) return explicit;

  const user = process.env.SMTP_USER;
  if (user && user.trim().length > 0) return `${MAIL_DISPLAY_NAME} <${user.trim()}>`;

  return undefined;
}

/**
 * Reads a variable holding a JSON object, e.g. SMS gateway headers.
 * Malformed JSON is a configuration mistake worth failing on, not ignoring.
 */
function parseJsonRecord(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  } catch (error) {
    throw new Error(
      `${name} must be a JSON object, e.g. {"Authorization":"Bearer xxx"}. ${
        error instanceof Error ? error.message : ""
      }`,
    );
  }
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Accepts any of the connection-string names a Vercel Postgres/Neon
 * integration may have provisioned, not just `DATABASE_URL`.
 */
function requiredDatabaseUrl(): string {
  const resolved = resolveDatabaseUrl();
  if (resolved) return resolved;

  if (process.env.NODE_ENV !== "production" || isBuildPhase) {
    return "postgresql://lagaitha:lagaitha@127.0.0.1:5432/lagaitha_dev";
  }

  throw new Error(
    `No database connection string found. Set one of: ${DATABASE_URL_KEYS.join(", ")}.`,
  );
}

export const env = {
  isProduction,
  isTest: process.env.NODE_ENV === "test",

  databaseUrl: requiredDatabaseUrl(),

  sessionSecret: required(
    "SESSION_SECRET",
    "dev-only-change-me-dev-only-change-me-dev-only-1234",
  ),

  /** resend | smtp | twilio | http | console | disabled — see providers/otp.ts */
  otpProvider: optional("OTP_PROVIDER", isProduction ? "disabled" : "console"),
  /**
   * Which identifier the sign-in screen asks for when the driver does not
   * imply one (console / disabled). A real driver always wins.
   */
  authChannel: optional("AUTH_CHANNEL", "email"),

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.MAIL_FROM,
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: integer("SMTP_PORT", 587),
    // Port 465 is implicit TLS; 587 upgrades with STARTTLS after connecting.
    secure: optional("SMTP_SECURE", integer("SMTP_PORT", 587) === 465 ? "true" : "false") === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: mailFrom(),
  },
  /** Development shortcut so demo accounts can sign in without an SMS gateway. */
  otpFixedCode: isProduction ? undefined : process.env.OTP_DEV_FIXED_CODE,

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  },

  /** Generic HTTP gateway, for local Iraqi SMS aggregators. */
  smsHttp: {
    url: process.env.SMS_HTTP_URL,
    method: optional("SMS_HTTP_METHOD", "POST"),
    bodyTemplate: process.env.SMS_HTTP_BODY,
    headers: parseJsonRecord("SMS_HTTP_HEADERS"),
  },

  /** local | blob | s3 — see providers/storage.ts */
  storageDriver: optional("STORAGE_DRIVER", "local"),
  storageLocalDir: optional("STORAGE_LOCAL_DIR", "./storage"),
  /** Set for you when a Blob store is created in the Vercel dashboard. */
  blobToken: process.env.BLOB_READ_WRITE_TOKEN,
  /**
   * True on a host that bundles the application onto a read-only filesystem.
   * Vercel sets `VERCEL`; the check exists so the storage layer can refuse the
   * local driver with an explanation instead of failing mid-upload.
   */
  isServerless: Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
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
