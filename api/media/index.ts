import { createDb, mediaRepository } from "../_lib/db";
import { internalError, isResponse, json, requireDevice, requireMethod } from "../_lib/http";

export default async function handler(request: Request): Promise<Response> {
  const method = requireMethod(request, "GET"); if (method) return method;
  const context = await requireDevice(request); if (isResponse(context)) return context;
  try {
    const url = new URL(request.url); const limit = Number(url.searchParams.get("limit") ?? 100); const offset = Number(url.searchParams.get("offset") ?? 0);
    const items = await mediaRepository(createDb(context.config.database)).listForOwner(context.ownerId, Number.isFinite(limit) ? limit : 100, Number.isFinite(offset) ? offset : 0);
    return json(200, { items });
  } catch (error) { return internalError(error, context.config); }
}
