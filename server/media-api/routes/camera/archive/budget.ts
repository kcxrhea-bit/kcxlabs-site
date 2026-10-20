import { createDb, cameraRepository } from "../../../_lib/db.js";
import { internalError, isResponse, json, requireMethod, requireOwnerSession, toNodeHandler } from "../../../_lib/http.js";
import { MAX_DELETE_ATTEMPTS } from "../../../_lib/camera-storage.js";

/**
 * GET /api/camera/archive/budget — OWNER SESSION ONLY. Reports the 5 GB
 * camera budget's live accounting. This NEVER reads the general `media`
 * table — only `camera_recordings` — so it cannot be confused with
 * account-wide R2 usage, which this response does not include at all.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;
  const context = await requireOwnerSession(request);
  if (isResponse(context)) return context;

  try {
    const repo = cameraRepository(createDb(context.config.database));
    const [usage, health] = await Promise.all([repo.usage(), repo.cleanupHealth({ maxAttempts: MAX_DELETE_ATTEMPTS })]);
    let lastCleanupRun: unknown = null;
    try {
      lastCleanupRun = health.lastCleanupRun === null ? null : JSON.parse(health.lastCleanupRun);
    } catch {
      lastCleanupRun = null;
    }
    const budgetBytes = context.config.camera.budgetBytes;
    const totalBytes = usage.protectedBytes + usage.unprotectedBytes;
    return json(
      200,
      {
        budgetBytes,
        totalBytes,
        protectedBytes: usage.protectedBytes,
        unprotectedBytes: usage.unprotectedBytes,
        reservedBytes: usage.reservedBytes,
        // Still in the bucket until R2 confirms the delete, so still unavailable.
        pendingDeleteBytes: usage.pendingDeleteBytes,
        availableBytes: Math.max(0, budgetBytes - totalBytes - usage.reservedBytes - usage.pendingDeleteBytes),
        storageFull: usage.protectedBytes >= budgetBytes,
        // Cleanup health (counts only): stuck rows exhausted their retries and need manual review.
        pendingDeleteCount: health.pendingDeleteCount,
        stuckDeleteCount: health.stuckDeleteCount,
        stuckLateUploadCheckCount: health.stuckLateUploadCheckCount,
        lastCleanupRun,
      },
      { "Cache-Control": "private, max-age=0" },
    );
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
