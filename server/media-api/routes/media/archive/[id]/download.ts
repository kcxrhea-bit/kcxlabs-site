import { createDb, mediaRepository } from "../../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerOrDeviceForMedia, toNodeHandler } from "../../../../_lib/http.js";
import { presignDownload, r2Context } from "../../../../_lib/r2.js";

/**
 * GET /api/media/archive/<id>/download — owner-only, short-lived download
 * authorization. Same scoping and non-leakage guarantees as play.ts, but
 * forces `Content-Disposition: attachment` with the original filename so
 * the browser saves rather than plays it.
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
      disposition: "attachment",
      filename: item.originalFilename,
    });

    return json(200, { url, expiresInSeconds: 15 * 60 }, { "Cache-Control": "private, max-age=0" });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
