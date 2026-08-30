import { deviceTokenExpiry, hashDeviceToken } from "../../../media-api/_lib/auth.js";
import { generateDeviceToken, generateDeviceTokenId } from "../../../media-api/_lib/ids.js";
import { authRepository, createDb, pairingRepository, type PairingSessionRow } from "../../../media-api/_lib/db.js";
import { loadAppConfig } from "../../../media-api/_lib/config.js";
import { internalError, json, readJson, requireMethod, toNodeHandler } from "../../../media-api/_lib/http.js";
import {
  digestsMatch,
  hashPairingCode,
  hashPairingSecret,
  normalizePairingCode,
  pairingSessionRedeemable,
  PAIRING_PROTOCOL,
  PAIRING_PROTOCOL_VERSION,
} from "../../_lib/pairing.js";

/**
 * POST /api/snapcal/v1/auth/pair/redeem — the Android endpoint. Called
 * BEFORE the device has any credential, so this route is intentionally
 * unauthenticated by bearer token or cookie: possession of a still-live,
 * still-unredeemed pairing session's secret (from a scanned QR) or short
 * code (typed by the user) is the only thing that authorizes it, exactly
 * the way a scanned QR or typed code is the only thing that authorizes
 * `POST /api/auth/pair` today when the browser sets up a device manually
 * with real credentials.
 *
 * On success this issues the SAME shape of device token
 * `POST /api/auth/pair` issues — there is no second, parallel credential
 * system. Redemption and device-token creation happen inside one
 * compare-and-set UPDATE (pairingRepository.redeem), so at most one of two
 * concurrent redemption attempts against the same session can ever succeed.
 *
 * Body is one of:
 *   { sessionId, secret, deviceName }   — QR redemption
 *   { code, deviceName }                — short-code redemption
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const body = await readJson(request);
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim().slice(0, 120) : "";
  if (!deviceName) return json(400, { error: "invalid_request" });

  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";
  const rawCode = typeof body?.code === "string" ? body.code : "";

  const config = loadAppConfig();
  const db = createDb(config.database);
  const pairing = pairingRepository(db);
  const now = new Date();

  try {
    let record: PairingSessionRow | null = null;

    if (sessionId && secret) {
      // QR redemption: protocol/version/origin are validated client-side
      // against the decoded payload before this call is ever made, but a
      // malformed or mismatched secret still fails safely here regardless.
      const candidate = await pairing.bySecretHash(hashPairingSecret(secret));
      if (candidate !== null && candidate.id === sessionId && digestsMatch(candidate.secretHash, hashPairingSecret(secret))) {
        record = candidate;
      }
    } else if (rawCode) {
      const normalized = normalizePairingCode(rawCode);
      if (normalized.length !== 6) return json(400, { error: "invalid_request" });
      const codeHash = hashPairingCode(normalized);

      // Single-owner system: this API has exactly one owner, so scanning
      // that owner's small set of live sessions and comparing hashes
      // constant-time is both correct and cheap, and — unlike an indexed
      // exact-hash lookup — keeps attempt_count a real per-session
      // brute-force counter (see db/migrations/003_snapcal_pairing.sql).
      const owner = await authRepository(db).ownerByEmail(config.auth.ownerEmail);
      if (owner !== null) {
        const active = await pairing.activeForOwner(owner.id, now);
        for (const candidate of active) {
          if (!pairingSessionRedeemable(candidate, now)) continue;
          if (digestsMatch(candidate.codeHash, codeHash)) {
            record = candidate;
            break;
          }
        }
        if (record === null) {
          // No match: charge the attempt against every still-live session
          // for this owner, since the guess could have been aimed at any of
          // them. With normally at most one live session, this is exactly
          // the per-session counter it looks like.
          await Promise.all(active.map((session) => pairing.incrementAttempt(session.id)));
        }
      }
    } else {
      return json(400, { error: "invalid_request" });
    }

    if (record === null || !pairingSessionRedeemable(record, now)) {
      return json(410, { error: "pairing_session_invalid" });
    }

    const token = generateDeviceToken();
    const deviceTokenId = generateDeviceTokenId();
    const auth = authRepository(db);
    await auth.createDeviceToken({
      id: deviceTokenId,
      ownerId: record.ownerId,
      tokenHash: hashDeviceToken(token),
      deviceName,
      expiresAt: deviceTokenExpiry(now),
    });

    const redeemed = await pairing.redeem({ id: record.id, deviceTokenId, now });
    if (!redeemed) {
      // Lost the race to a concurrent redemption (or it expired in the
      // instant between the check above and this UPDATE): the token row we
      // just created is orphaned but harmless — revoke it immediately so it
      // can never be used, then fail closed the same way an already-used
      // session does.
      await auth.revokeDeviceToken(record.ownerId, deviceTokenId);
      return json(410, { error: "pairing_session_invalid" });
    }

    return json(201, { token, expiresAt: deviceTokenExpiry(now), ownerEmail: config.auth.ownerEmail });
  } catch (error) {
    return internalError(error, config);
  }
}

export const PAIRING_REDEEM_PROTOCOL_INFO = { protocol: PAIRING_PROTOCOL, version: PAIRING_PROTOCOL_VERSION };

export default toNodeHandler(handler);
