/**
 * Owner authentication and device tokens.
 *
 * Owner-only, no third-party provider, no cost. Built on `node:crypto` alone.
 *
 * Rules this module exists to enforce:
 *   * The password is never stored — only a scrypt hash with a per-password salt.
 *   * A device token is returned to the desktop exactly ONCE. Only its SHA-256
 *     is persisted, so a database disclosure cannot be replayed as a credential.
 *   * Every comparison of secret material is constant-time.
 *   * Nothing here logs, echoes, or returns a secret value.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Promise wrapper around `scrypt`.
 *
 * Written by hand rather than with `promisify`, whose types drop the
 * options-taking overload — and the options are load-bearing here, since N,
 * r, p and maxmem all have to be supplied explicitly.
 */
function scryptAsync(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

// Cost parameters. N=2^15 is a reasonable interactive cost for a login that
// happens rarely; it is stored alongside the hash so it can be raised later
// without invalidating existing hashes.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/**
 * Hash a password as `scrypt$N$r$p$salt$hash`, both parts hex.
 *
 * The parameters travel with the hash so verification never has to guess them.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt at N=32768 needs more than node's default maxmem.
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for any malformed hash rather than throwing, so a corrupted
 * configuration value fails closed as a rejected login.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  try {
    const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ─── Device tokens ───────────────────────────────────────────────────────────

/**
 * Storage form of a device token.
 *
 * SHA-256 rather than scrypt is correct here: the token is already 256 bits of
 * uniform randomness, so it is not brute-forceable and a slow KDF would only
 * add latency to every authenticated request.
 */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function tokenHashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Extract a bearer token from an Authorization header, or null. */
export function bearerToken(headerValue: string | null | undefined): string | null {
  if (typeof headerValue !== "string") return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (match === null) return null;
  const token = match[1].trim();
  return token === "" ? null : token;
}

export type DeviceTokenRecord = {
  id: string;
  ownerId: string;
  deviceName: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export const tokenRejectionReasons = ["missing", "unknown", "revoked", "expired"] as const;
export type TokenRejectionReason = (typeof tokenRejectionReasons)[number];

export type TokenVerification =
  | { valid: true; record: DeviceTokenRecord }
  | { valid: false; reason: TokenRejectionReason };

/**
 * Apply revocation and expiry to a looked-up token record.
 *
 * Separated from the database lookup so the rules are pure and testable. Both
 * checks are mandatory: a revoked token stays rejected regardless of expiry,
 * and vice versa.
 */
export function verifyDeviceTokenRecord(
  record: DeviceTokenRecord | null,
  now: Date,
): TokenVerification {
  if (record === null) return { valid: false, reason: "unknown" };
  if (record.revokedAt !== null) return { valid: false, reason: "revoked" };

  if (record.expiresAt !== null) {
    const expiresMs = Date.parse(record.expiresAt);
    // An unparseable expiry is treated as expired, never as "no expiry".
    if (Number.isNaN(expiresMs) || now.getTime() >= expiresMs) {
      return { valid: false, reason: "expired" };
    }
  }
  return { valid: true, record };
}

/** Default device token lifetime: 180 days, renewable by re-pairing. */
export const DEFAULT_DEVICE_TOKEN_TTL_DAYS = 180;

export function deviceTokenExpiry(now: Date, days = DEFAULT_DEVICE_TOKEN_TTL_DAYS): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

// ─── Session cookie signing (browser admin) ──────────────────────────────────

/**
 * Sign a session payload as `value.signature`, HMAC-SHA256 over the value.
 *
 * Used only for the browser admin session cookie, which is set HttpOnly,
 * Secure, and SameSite=Lax by the handler that issues it.
 */
export function signSession(value: string, secret: string): string {
  const signature = createHash("sha256").update(`${secret}:${value}`, "utf8").digest("hex");
  return `${value}.${signature}`;
}

export function verifySignedSession(signed: string, secret: string): string | null {
  const separator = signed.lastIndexOf(".");
  if (separator <= 0) return null;

  const value = signed.slice(0, separator);
  const provided = signed.slice(separator + 1);
  const expected = createHash("sha256").update(`${secret}:${value}`, "utf8").digest("hex");

  return tokenHashesMatch(provided, expected) ? value : null;
}
