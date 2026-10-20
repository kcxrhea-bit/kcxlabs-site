import { createDb, cameraRepository, type CameraRecording } from "../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerSession, toNodeHandler } from "../../../_lib/http.js";
import { isAllowedCamera, laDayBoundsUtc } from "../../../_lib/camera-schedule.js";

/** Sanitized shape sent to the browser — never the raw storage key, hash, or owner id. */
export type ArchiveListItem = {
  id: string;
  camera: string;
  cameraName: string;
  recordedStartAt: string;
  recordedEndAt: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  sizeBytes: number;
  protected: boolean;
};

function sanitize(item: CameraRecording): ArchiveListItem {
  return {
    id: item.id,
    camera: item.camera,
    cameraName: item.cameraName,
    recordedStartAt: item.recordedStartAt,
    recordedEndAt: item.recordedEndAt,
    durationSeconds: item.durationSeconds,
    width: item.width,
    height: item.height,
    codec: item.codec,
    sizeBytes: item.sizeBytes,
    protected: item.protected,
  };
}

/**
 * GET /api/camera/archive/list — OWNER SESSION ONLY, never a device bearer
 * token. `?camera=living-room&date=YYYY-MM-DD` (both optional; `date` is an
 * America/Los_Angeles calendar day).
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;
  const context = await requireOwnerSession(request);
  if (isResponse(context)) return context;

  const url = requestUrl(request);
  const cameraParam = url.searchParams.get("camera");
  if (cameraParam !== null && !isAllowedCamera(cameraParam)) return json(400, { error: "invalid_request", reason: "unknown_camera" });

  const dateParam = url.searchParams.get("date");
  let from: string | null = null;
  let to: string | null = null;
  if (dateParam !== null) {
    const bounds = laDayBoundsUtc(dateParam);
    if (!bounds) return json(400, { error: "invalid_request", reason: "invalid_date" });
    from = bounds.fromIso;
    to = bounds.toIso;
  }

  try {
    const repo = cameraRepository(createDb(context.config.database));
    const items = await repo.listForOwner({ ownerId: context.ownerId, camera: cameraParam, from, to });
    return json(200, { items: items.map(sanitize) }, { "Cache-Control": "private, max-age=0" });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
