import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing.
 *
 * scrypt from Node's own crypto module rather than bcrypt or argon2: both of
 * those are native addons, and this application already pays that cost once for
 * sharp. A second one is a second thing that can fail to compile on a host we
 * do not control, for a function the standard library already implements to the
 * same standard (scrypt is RFC 7914, and is what OWASP recommends when argon2id
 * is not available).
 *
 * The digest is self-describing — `scrypt$N$r$p$salt$hash` — so the parameters
 * can be raised later without invalidating anyone's password: an old digest
 * still verifies against the parameters it was written with, and
 * `needsRehash` tells the caller to write a new one.
 */

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * ~100 ms on a small cloud instance and ~64 MB of memory. High enough to make
 * offline cracking expensive, low enough that a sign-in on a busy single node
 * does not become the slowest thing in the request.
 */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** scrypt needs headroom above 128·N·r bytes or it refuses to run. */
function maxmem(n: number, r: number): number {
  return Math.max(32 * 1024 * 1024, 256 * n * r);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: maxmem(PARAMS.N, PARAMS.r),
  });

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time comparison, and never throws: a malformed digest in the
 * database is a failed sign-in, not a 500 that tells an attacker something.
 */
export async function verifyPassword(password: string, digest: string): Promise<boolean> {
  const parsed = parseDigest(digest);
  if (!parsed) return false;

  try {
    const derived = await scryptAsync(password.normalize("NFKC"), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: maxmem(parsed.N, parsed.r),
    });
    return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/** True when a stored digest was written with weaker parameters than today's. */
export function needsRehash(digest: string): boolean {
  const parsed = parseDigest(digest);
  if (!parsed) return true;
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p;
}

interface ParsedDigest {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseDigest(digest: string): ParsedDigest | null {
  const parts = digest.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!isPowerOfTwo(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // Refuse absurd parameters from a tampered row rather than letting scrypt
  // allocate gigabytes.
  if (N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;

  const salt = Buffer.from(parts[4]!, "base64url");
  const hash = Buffer.from(parts[5]!, "base64url");
  if (salt.length === 0 || hash.length === 0) return null;

  return { N, r, p, salt, hash };
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 1 && (value & (value - 1)) === 0;
}

// The strength rules are pure and shared with the browser; see password-rules.
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPasswordStrength,
  type PasswordProblem,
} from "./password-rules";
