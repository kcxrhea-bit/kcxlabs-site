import { createDb, cameraRepository } from "../../_lib/db.js";
import { generateCameraRecordingId } from "../../_lib/ids.js";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http.js";
import { cameraObjectOperations, cameraR2Context, presignUpload } from "../../_lib/r2.js";
import { cameraObjectStore, reconcileCameraStorage, rotateForSpace } from "../../_lib/camera-storage.js";
import { isAllowedCamera, checkSchedule } from "../../_lib/camera-schedule.js";

const MAX_CLIP_BYTES = 200 * 1024 * 1024; // generous ceiling for a ~1-5 minute 360p clip
const MAX_DURATION_SECONDS = 24 * 60 * 60; // sanity cap, real clips are minutes

function sanitizeKeySegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
}

/**
 * POST /api/camera/upload-authorize — device bearer token ONLY
 * (`requireDevice`), never a browser session. This is KCxCamBridge's own
 * channel; the Camera Archive website never calls this route.
 *
 * Every field the device claims is independently re-validated here:
 * camera identity, recording timestamps against the 6AM-10PM
 * America/Los_Angeles schedule, and the 5 GB budget (with oldest-first
 * rotation of unprotected recordings if the new clip doesn't otherwise fit;
 * rotated objects are deleted from R2 before their rows retire).
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const context = await requireDevice(request);
  if (isResponse(context)) return context;

  const body = await readJson(request);
  const recordingId = typeof body?.recordingId === "string" ? body.recordingId.trim() : "";
  const camera = body?.camera;
  const cameraName = typeof body?.cameraName === "string" ? body.cameraName.trim().slice(0, 120) : "Living Room";
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : NaN;
  const sha256 = typeof body?.sha256 === "string" ? body.sha256.toLowerCase() : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "video/mp4";
  const width = typeof body?.width === "number" ? body.width : null;
  const height = typeof body?.height === "number" ? body.height : null;
  const codec = typeof body?.codec === "string" ? body.codec.slice(0, 40) : null;
  const recordedStartAt = typeof body?.recordedStartAt === "string" ? body.recordedStartAt : "";
  const recordedEndAt = typeof body?.recordedEndAt === "string" ? body.recordedEndAt : "";
  const durationSeconds = typeof body?.durationSeconds === "number" ? body.durationSeconds : null;

  // Never trust the client's claimed ownership/authorization — only `context.ownerId` from the verified device token is used below.

  if (!recordingId || recordingId.length > 200 || !filename || !/^[0-9a-f]{64}$/.test(sha256)) {
    return json(400, { error: "invalid_request" });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_CLIP_BYTES) {
    return json(400, { error: "invalid_request", reason: "size_out_of_range" });
  }
  if (durationSeconds !== null && (durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS)) {
    return json(400, { error: "invalid_request", reason: "duration_out_of_range" });
  }

  // Hard allow-list: exactly one camera. Rejected outright, never a soft warning.
  if (!isAllowedCamera(camera)) {
    return json(403, { error: "camera_not_allowed" });
  }

  const schedule = checkSchedule(recordedStartAt, recordedEndAt);
  if (!schedule.ok) {
    return json(422, { error: "outside_schedule", reason: schedule.reason });
  }

  // Fail closed: no dedicated camera token means no camera uploads, and nothing else is affected.
  const cameraR2 = cameraR2Context(context.config);
  if (!cameraR2) return json(503, { error: "camera_storage_unconfigured" });
  const store = cameraObjectStore(cameraR2.bucket, cameraObjectOperations(cameraR2));

  try {
    const db = createDb(context.config.database);
    const repo = cameraRepository(db);

    // Bounded housekeeping first: expire abandoned reservations and retry interrupted deletions.
    await reconcileCameraStorage(repo, store);

    // Idempotent retry: the same recordingId already has a reservation or finalized upload.
    const existing = await repo.byRecordingId(recordingId);
    if (existing) {
      if (existing.status === "active") {
        return json(200, { duplicate: true, mediaId: existing.id });
      }
      // Still `reserved` — re-issue a fresh presigned URL for the same row (restarting its TTL) rather than creating a second one.
      const touched = existing.status === "reserved" ? await repo.touchReservation(existing.id) : null;
      if (!touched) {
        // Claimed for deletion (expired or rotated) — the device retries once the delete is confirmed.
        return json(409, { error: "recording_being_removed", retryable: true });
      }
      const authorization = await presignUpload(cameraR2, {
        key: touched.storageObjectKey,
        contentType: mimeType,
        sizeBytes,
        sha256,
      });
      return json(201, { duplicate: false, mediaId: touched.id, authorization });
    }

    const id = generateCameraRecordingId();
    const extension = filename.includes(".") ? sanitizeKeySegment(filename.slice(filename.lastIndexOf("."))) : "";
    const key = `camera/${camera}/${sanitizeKeySegment(recordedStartAt)}-${id}${extension}`;

    // Rotate BEFORE attempting to reserve, so capacity is freed first. The shortfall is computed
    // from the live table inside claimForRotation; objects are deleted from R2 before their rows retire.
    await rotateForSpace(repo, store, { incomingBytes: sizeBytes, budgetBytes: context.config.camera.budgetBytes });

    const reservation = await repo.reserve({
      id,
      recordingId,
      ownerId: context.ownerId,
      camera,
      cameraName,
      storageObjectKey: key,
      mimeType,
      sizeBytes,
      sha256,
      width,
      height,
      codec,
      recordedStartAt,
      recordedEndAt,
      durationSeconds,
      budgetBytes: context.config.camera.budgetBytes,
    });

    if (!reservation) {
      // Either protected recordings block rotation, or a true race lost to a concurrent reservation.
      return json(409, { error: "storage_full", reason: "protected_recordings_block_rotation" });
    }

    const authorization = await presignUpload(cameraR2, { key, contentType: mimeType, sizeBytes, sha256 });
    return json(201, { duplicate: false, mediaId: reservation.id, authorization });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
