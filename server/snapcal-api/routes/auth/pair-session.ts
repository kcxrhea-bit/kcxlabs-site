import { authRepository, createDb, pairingRepository } from "../../../media-api/_lib/db.js";
import { loadAppConfig } from "../../../media-api/_lib/config.js";
import { internalError, isResponse, json, requireMethod, requireOwnerOrDevice, toNodeHandler } from "../../../media-api/_lib/http.js";
import {
  buildPairingQrPayload,
  generatePairingCode,
  generatePairingSecret,
  generatePairingSessionId,
  hashPairingCode,
  hashPairingSecret,
  normalizePairingCode,
  pairingSessionExpiry,
} from "../../_lib/pairing.js";

/**
 * POST /api/snapcal/v1/auth/pair/session — creates a short-lived pairing
 * session for "Connect Device". Requires the same auth as any other SnapCal
 * route (`requireOwnerOrDevice`: browser session cookie in practice, since
 * this is what powers the web "Connect Device" button).
 *
 * The QR secret and short code are returned exactly once, in this response.
 * Only their SHA-256 hashes are ever persisted (db/migrations/003_snapcal_pairing.sql).
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const context = await requireOwnerOrDevice(request);
  if (isResponse(context)) return context;

  const config = loadAppConfig();
  try {
    const db = createDb(config.database);
    // A device-token bearer is technically allowed to request a pairing
    // session too (e.g. pairing a second device from an already-paired one),
    // but the owner row must exist either way.
    await authRepository(db).ensureOwner({
      id: context.ownerId,
      email: config.auth.ownerEmail,
      passwordHash: config.auth.ownerPasswordHash,
    });

    const id = generatePairingSessionId();
    const secret = generatePairingSecret();
    const code = generatePairingCode();
    const expiresAt = pairingSessionExpiry(new Date());

    await pairingRepository(db).create({
      id,
      ownerId: context.ownerId,
      secretHash: hashPairingSecret(secret),
      codeHash: hashPairingCode(normalizePairingCode(code)),
      expiresAt,
    });

    return json(201, {
      sessionId: id,
      code,
      expiresAt,
      qrPayload: buildPairingQrPayload({ origin: config.publicSiteOrigin, sessionId: id, secret }),
    });
  } catch (error) {
    return internalError(error, config);
  }
}

export default toNodeHandler(handler);
