import { createDb, mediaRepository } from "../../../_lib/db";
import { internalError, json, requestUrl, requireMethod, toNodeHandler } from "../../../_lib/http";
import { presignDownload, r2Context } from "../../../_lib/r2";
import { contentDispositionFor } from "../../../../../src/media/content";
import { resolveSharePageMode, toPublicMediaItem } from "../../../../../src/media/types";

/** Public share lookup: PUBLIC and direct-link UNLISTED only; PRIVATE is indistinguishable from missing. */
async function handler(request: Request): Promise<Response> {
  const method = requireMethod(request, "GET"); if (method) return method;
  const publicId = requestUrl(request).pathname.split("/").pop() ?? "";
  try {
    const config = (await import("../../../_lib/config")).loadAppConfig();
    const item = await mediaRepository(createDb(config.database)).byPublicId(publicId);
    if (!item || item.visibility === "private") return json(404, { error: "not_found" });
    const r2 = r2Context(config.r2);
    const deliveryUrl = item.originalOnline ? await presignDownload(r2, { key: item.storageObjectKey, disposition: contentDispositionFor(item.mimeType), filename: item.originalFilename }) : null;
    const thumbnailUrl = item.thumbnailKey ? await presignDownload(r2, { key: item.thumbnailKey, disposition: "inline" }) : null;
    return json(200, { media: toPublicMediaItem(item), mode: resolveSharePageMode(toPublicMediaItem(item)), deliveryUrl, thumbnailUrl, expiresInSeconds: 15 * 60 }, { "Cache-Control": "private, max-age=0" });
  } catch (error) { return internalError(error, (await import("../../../_lib/config")).loadAppConfig()); }
}

export default toNodeHandler(handler);
