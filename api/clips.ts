import { createDb, mediaRepository } from "./_lib/db";
import { internalError, json, requireMethod } from "./_lib/http";
import { toPublicMediaItem } from "../src/media/types";

export default async function handler(request: Request): Promise<Response> {
  const method = requireMethod(request, "GET"); if (method) return method;
  try {
    const url = new URL(request.url); const limit = Number(url.searchParams.get("limit") ?? 60); const offset = Number(url.searchParams.get("offset") ?? 0);
    const { database } = (await import("./_lib/config")).loadAppConfig();
    const items = await mediaRepository(createDb(database)).listPublic(Number.isFinite(limit) ? limit : 60, Number.isFinite(offset) ? offset : 0);
    return json(200, { items: items.map(toPublicMediaItem) }, { "Cache-Control": "public, max-age=60" });
  } catch (error) { return internalError(error, (await import("./_lib/config")).loadAppConfig()); }
}
