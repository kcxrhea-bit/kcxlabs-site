/**
 * Identifier generation.
 *
 * `publicId` is the only identifier that appears in a share URL, and for an
 * UNLISTED item it IS the access control. It must therefore be unguessable, not
 * merely unique.
 */

import { randomBytes, randomUUID } from "node:crypto";

/**
 * Base62 without lookalike characters removed — the full alphabet is kept so
 * entropy per character stays at log2(62) ≈ 5.95 bits.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * High-entropy public share id.
 *
 * 16 characters of base62 ≈ 95 bits. At that size, guessing a specific unlisted
 * clip is infeasible, and so is enumerating the space to discover any clip.
 *
 * Uses rejection sampling rather than `% 62`, which would bias the low
 * characters of the alphabet and shave real entropy off every id.
 */
export function generatePublicId(length = 16): string {
  // 256 is not a multiple of 62; values at or above this are discarded.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let output = "";

  while (output.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      output += ALPHABET[byte % ALPHABET.length];
      if (output.length === length) break;
    }
  }
  return output;
}

/** Internal primary key. Never appears in a URL, so a UUID is fine. */
export function generateMediaId(): string {
  return `med_${randomUUID()}`;
}

export function generateDeviceTokenId(): string {
  return `dev_${randomUUID()}`;
}

/**
 * Raw device token: 32 random bytes, base64url. Returned to the desktop exactly
 * once at pairing; only its SHA-256 is stored server-side.
 */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}
