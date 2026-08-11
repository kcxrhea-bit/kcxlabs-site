import { createDb, mediaRepository } from "../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireDevice, requireMethod, toNodeHandler } from "../../../_lib/http.js";
import { presignDownload, r2Context } from "../../../_lib/r2.js";

/** Narrow desktop-only authorization to copy an original into the local archive. */
async function handler(request: Request): Promise<Response> {
  const method = requireMethod(request, "POST"); if (method) return method;
  const context = await requireDevice(request); if (isResponse(context)) return context;
  const id = (requestUrl(request).pathname.split("/").slice(-2)[0] ?? "");
  try {
    const item = await mediaRepository(createDb(context.config.database)).byId(context.ownerId, id);
    if (!item) return json(404, { error: "not_found" });
    if (item.archiveState !== "archive_downloading" || !item.originalOnline) return json(409, { error: "invalid_state" });
    const authorization = await presignDownload(r2Context(context.config.r2), { key: item.storageObjectKey, disposition: "attachment", filename: item.originalFilename });
    return json(200, { mediaId: item.id, authorization, expiresInSeconds: 15 * 60 });
  } catch (error) { return internalError(error, context.config); }
}

export default toNodeHandler(handler);
