import { createDb, cameraRepository } from "../../_lib/db.js";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http.js";
import { cameraR2Context, headObject } from "../../_lib/r2.js";

/**
 * POST /api/camera/finalize — device bearer token only. Verifies the
 * uploaded object in the camera bucket actually matches what was reserved
 * (size + hash) before marking the row `active`; a mismatch leaves it
 * `reserved` rather than silently accepting a corrupt/partial upload.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const context = await requireDevice(request);
  if (isResponse(context)) return context;

  const body = await readJson(request);
  const mediaId = typeof body?.mediaId === "string" ? body.mediaId : "";
  if (!mediaId) return json(400, { error: "invalid_request" });

  const cameraR2 = cameraR2Context(context.config);
  if (!cameraR2) return json(503, { error: "camera_storage_unconfigured" });

  try {
    const repo = cameraRepository(createDb(context.config.database));
    const item = await repo.byId(mediaId);
    if (!item || item.ownerId !== context.ownerId) return json(404, { error: "not_found" });
    if (item.status === "active") return json(200, { item, idempotent: true });
    // Expired or rotated while the upload was in flight: never resurrect a row that is being deleted.
    if (item.status !== "reserved") return json(409, { error: "recording_being_removed", retryable: true });

    const head = await headObject(cameraR2, item.storageObjectKey);
    if (!head.exists) return json(409, { error: "object_missing" });
    if (head.sizeBytes !== null && head.sizeBytes !== item.reservedBytes) return json(409, { error: "size_mismatch" });
    if (head.sha256 !== null && head.sha256 !== item.sha256) return json(409, { error: "hash_mismatch" });

    const actualSizeBytes = head.sizeBytes ?? item.reservedBytes;
    const result = await repo.markActive({ id: mediaId, actualSizeBytes });
    if (!result) return json(409, { error: "finalize_failed" });
    return json(200, { item: result.item, idempotent: result.idempotent });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
