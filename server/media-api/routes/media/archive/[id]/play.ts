import { createDb, mediaRepository } from "../../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerOrDeviceForMedia, toNodeHandler } from "../../../../_lib/http.js";
import { presignDownload, r2Context } from "../../../../_lib/r2.js";

/**
 * GET /api/media/archive/<id>/play — owner-only, short-lived playback
 * authorization for the Camera Archive viewer.
 *
 * Returns a presigned R2 GET URL (15-minute TTL, same as every other
 * presigned delivery URL in this API) with inline disposition, never the raw
 * `storageObjectKey`. Range-request seeking works because the browser's
 * <video> element sends the Range header directly to the presigned URL — R2
 * (S3-compatible) honors Range on a GET regardless of how the URL was
 * authorized, since Range is not part of the signature.
 *
 * Scoped strictly to the requesting owner: `repo.byId(ownerId, id)` already
 * filters by `owner_id` in SQL, so a private item can never be resolved for
 * any id/owner combination other than its own.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;
  const context = await requireOwnerOrDeviceForMedia(request);
  if (isResponse(context)) return context;

  const segments = requestUrl(request).pathname.split("/").filter(Boolean);
  const id = segments[segments.length - 2] ?? "";
  if (!id) return json(400, { error: "invalid_request" });

  try {
    const repo = mediaRepository(createDb(context.config.database));
    const item = await repo.byId(context.ownerId, id);
    if (!item) return json(404, { error: "not_found" });
    if (!item.originalOnline) return json(409, { error: "object_offline" });

    const url = await presignDownload(r2Context(context.config.r2), {
      key: item.storageObjectKey,
      disposition: "inline",
    });

    return json(200, { url, expiresInSeconds: 15 * 60 }, { "Cache-Control": "private, max-age=0" });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
