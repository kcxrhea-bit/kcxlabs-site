import { createDb, mediaRepository } from "../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerOrDeviceForMedia, toNodeHandler } from "../../../_lib/http.js";
import { toArchiveMediaItem } from "../../../../../src/media/types.js";

const CAMERAS = new Set(["kitchen", "living-room"]);

/**
 * GET /api/media/archive/list — owner-only Camera Archive listing.
 *
 * Query params:
 *   camera   optional, "kitchen" | "living-room" (anything else is ignored,
 *            not rejected, so a stray query param never 400s the page)
 *   date     optional, "YYYY-MM-DD" local date to narrow to one day
 *   limit/offset  pagination, same caps as the other owner listings
 *
 * Returns only `ArchiveMediaItem` — no storage keys, no filesystem paths, no
 * owner id, no sha256 — regardless of visibility. `visibility` is reported
 * back to the owner (so the UI can show it), but this route itself never
 * changes it and never exposes an item to anyone but the authenticated owner.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;
  const context = await requireOwnerOrDeviceForMedia(request);
  if (isResponse(context)) return context;

  const url = requestUrl(request);
  const cameraParam = url.searchParams.get("camera");
  const camera = cameraParam !== null && CAMERAS.has(cameraParam) ? cameraParam : null;
  const date = url.searchParams.get("date");
  const limitParam = Number(url.searchParams.get("limit") ?? 200);
  const offsetParam = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(limitParam) ? limitParam : 200;
  const offset = Number.isFinite(offsetParam) ? offsetParam : 0;

  try {
    const repo = mediaRepository(createDb(context.config.database));
    const items = await repo.listForOwnerByCamera(context.ownerId, camera, limit, offset);

    const filtered =
      date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? items.filter((item) => {
            const stamp = item.recordedAt ?? item.uploadedAt;
            if (stamp === null) return false;
            return new Date(stamp).toISOString().slice(0, 10) === date;
          })
        : items;

    return json(
      200,
      { items: filtered.map(toArchiveMediaItem) },
      { "Cache-Control": "private, max-age=0" },
    );
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
