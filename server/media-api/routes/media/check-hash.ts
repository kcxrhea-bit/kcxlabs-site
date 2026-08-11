import { createDb, mediaRepository } from "../../_lib/db.js";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http.js";

async function handler(request: Request): Promise<Response> {
  const method = requireMethod(request, "POST"); if (method) return method;
  const context = await requireDevice(request); if (isResponse(context)) return context;
  const body = await readJson(request);
  const sha256 = typeof body?.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) return json(400, { error: "invalid_request" });
  try {
    const item = await mediaRepository(createDb(context.config.database)).byHash(context.ownerId, sha256);
    return json(200, { duplicate: item !== null, media: item === null ? null : { id: item.id, publicId: item.publicId } });
  } catch (error) { return internalError(error, context.config); }
}

export default toNodeHandler(handler);
