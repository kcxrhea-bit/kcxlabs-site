/**
 * QR / short-code device pairing.
 *
 * A pairing session bridges a logged-in browser (which creates it) and an
 * unpaired Android device (which redeems it) into the SAME device token
 * `POST /api/auth/pair` already issues — see db/migrations/003_snapcal_pairing.sql
 * for the schema and the reasoning behind it.
 *
 * Rules this module exists to enforce:
 *   * The QR secret and the short code are returned to the browser exactly
 *     ONCE, at creation. Only their SHA-256 hashes are persisted.
 *   * Every comparison of secret material is constant-time.
 *   * Nothing here logs, echoes, or returns a secret value.
 */

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export const PAIRING_PROTOCOL = "kcxsnapcal-pair";
export const PAIRING_PROTOCOL_VERSION = 1;
export const PAIRING_SESSION_TTL_MS = 5 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export function generatePairingSessionId(): string {
  return `pcs_${randomUUID()}`;
}

/** High-entropy QR secret. Never persisted raw — only its SHA-256. */
export function generatePairingSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Human-friendly fallback code, "482 731" shaped: six digits, space-separated. */
export function generatePairingCode(): string {
  const digits = Array.from({ length: 6 }, () => randomInt(0, 10)).join("");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** Strips everything but digits, so "482 731", "482731", and "482-731" all normalize the same. */
export function normalizePairingCode(input: string): string {
  return input.replace(/\D/g, "");
}

export function hashPairingSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function hashPairingCode(normalizedCode: string): string {
  return createHash("sha256").update(normalizedCode, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function pairingSessionExpiry(now: Date): string {
  return new Date(now.getTime() + PAIRING_SESSION_TTL_MS).toISOString();
}

export type PairingSessionRecord = {
  id: string;
  ownerId: string;
  secretHash: string;
  codeHash: string;
  attemptCount: number;
  deviceTokenId: string | null;
  expiresAt: string;
  redeemedAt: string | null;
};

export type PairingSessionStatus = "waiting" | "connected" | "expired";

/** Pure status projection, separated from the DB lookup so it stays testable without Postgres. */
export function pairingSessionStatus(record: PairingSessionRecord | null, now: Date): PairingSessionStatus {
  if (record === null) return "expired";
  if (record.redeemedAt !== null) return "connected";
  if (Date.parse(record.expiresAt) <= now.getTime()) return "expired";
  return "waiting";
}

/** A session past its attempt budget is treated identically to an expired one. */
export function pairingSessionRedeemable(record: PairingSessionRecord, now: Date): boolean {
  return (
    record.redeemedAt === null &&
    Date.parse(record.expiresAt) > now.getTime() &&
    record.attemptCount < MAX_CODE_ATTEMPTS
  );
}

/** The exact shape encoded into the QR image. */
export type PairingQrPayload = {
  p: string;
  v: number;
  origin: string;
  sid: string;
  s: string;
};

export function buildPairingQrPayload(input: { origin: string; sessionId: string; secret: string }): PairingQrPayload {
  return {
    p: PAIRING_PROTOCOL,
    v: PAIRING_PROTOCOL_VERSION,
    origin: input.origin,
    sid: input.sessionId,
    s: input.secret,
  };
}
