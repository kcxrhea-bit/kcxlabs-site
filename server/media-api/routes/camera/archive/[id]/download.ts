import { createDb, cameraRepository } from "../../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerSession, toNodeHandler } from "../../../../_lib/http.js";
import { cameraR2Context, presignDownload } from "../../../../_lib/r2.js";

/** GET /api/camera/archive/:id/download — OWNER SESSION ONLY. Short-lived presigned attachment URL. */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;
  const context = await requireOwnerSession(request);
  if (isResponse(context)) return context;

  const id = requestUrl(request).pathname.split("/").slice(-2)[0] ?? "";
  if (!id) return json(400, { error: "invalid_request" });

  const cameraR2 = cameraR2Context(context.config);
  if (!cameraR2) return json(503, { error: "camera_storage_unconfigured" });

  try {
    const repo = cameraRepository(createDb(context.config.database));
    const item = await repo.byId(id);
    if (!item || item.ownerId !== context.ownerId || item.status !== "active") return json(404, { error: "not_found" });

    const filename = `${item.cameraName.replace(/[^A-Za-z0-9._-]/g, "_")}-${item.recordedStartAt.replace(/[^0-9]/g, "")}.mp4`;
    const url = await presignDownload(cameraR2, {
      key: item.storageObjectKey,
      disposition: "attachment",
      filename,
    });
    return json(200, { url, expiresInSeconds: 15 * 60 }, { "Cache-Control": "private, max-age=0" });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
