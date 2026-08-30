import { createDb, pairingRepository } from "../../../media-api/_lib/db.js";
import { loadAppConfig } from "../../../media-api/_lib/config.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerOrDevice, toNodeHandler } from "../../../media-api/_lib/http.js";
import { pairingSessionStatus } from "../../_lib/pairing.js";

/**
 * GET /api/snapcal/v1/auth/pair/session/<id> — polled by the browser so the
 * "Connect Device" panel can move Waiting → Connected without the Android
 * redemption endpoint needing to know anything about the browser session.
 * Reports status only — never the secret hash, code hash, or the resulting
 * device token.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;

  const context = await requireOwnerOrDevice(request);
  if (isResponse(context)) return context;

  const segments = requestUrl(request).pathname.split("/").filter(Boolean);
  const id = segments[segments.length - 1] ?? "";
  if (!id) return json(400, { error: "invalid_request" });

  const config = loadAppConfig();
  try {
    const record = await pairingRepository(createDb(config.database)).byId(id);
    if (record === null || record.ownerId !== context.ownerId) {
      return json(404, { error: "not_found" });
    }

    const status = pairingSessionStatus(record, new Date());
    return json(200, { status, expiresAt: record.expiresAt });
  } catch (error) {
    return internalError(error, config);
  }
}

export default toNodeHandler(handler);
