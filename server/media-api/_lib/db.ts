/**
 * Neon (Postgres) access layer.
 *
 * All SQL lives here, grouped into narrow repositories. Handlers call these
 * functions; they never write SQL themselves. That keeps query shapes reviewable
 * in one place and means the visibility and archive-safety filters cannot be
 * forgotten by an individual endpoint.
 *
 * Every query uses the tagged-template form, which sends values as bound
 * parameters. Nothing is interpolated into SQL text. The one place a template
 * is built dynamically (the media list filter) composes only fixed fragments
 * and still binds every value.
 *
 * NOT YET VERIFIED against a live database at the time of writing.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { DatabaseConfig } from "./config.js";
import type { DeletionCandidate } from "./camera-storage.js";
import type {
  ArchiveState,
  MediaItem,
  MediaKind,
  MediaRecordStatus,
  MediaVisibility,
} from "../../../src/media/types.js";

export type Db = NeonQueryFunction<false, false>;

export function createDb(config: DatabaseConfig): Db {
  return neon(config.connectionString);
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

type MediaRow = Record<string, unknown>;

const asString = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
/** Postgres BIGINT arrives as a string; Number() would silently lose precision above 2^53. */
const asNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const asDate = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value);

export function mapMediaRow(row: MediaRow): MediaItem {
  return {
    id: asString(row.id),
    publicId: asString(row.public_id),
    ownerId: asString(row.owner_id),
    originalFilename: asString(row.original_filename),
    extension: asString(row.extension),
    mimeType: asString(row.mime_type),
    kind: asString(row.kind) as MediaKind,
    sizeBytes: asNumber(row.size_bytes),
    sha256: asString(row.sha256),
    storageProvider: asString(row.storage_provider),
    storageObjectKey: asString(row.storage_object_key),
    originalOnline: row.original_online === true,
    thumbnailKey: asNullableString(row.thumbnail_key),
    thumbnailSizeBytes: asNumber(row.thumbnail_size_bytes),
    restoreRequestedAt: asDate(row.restore_requested_at),
    restoreFailedReason: asNullableString(row.restore_failed_reason),
    title: asString(row.title),
    description: asNullableString(row.description),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    game: asNullableString(row.game),
    eventType: asNullableString(row.event_type),
    durationSeconds: asNullableNumber(row.duration_seconds),
    width: asNullableNumber(row.width),
    height: asNullableNumber(row.height),
    codec: asNullableString(row.codec),
    status: asString(row.status) as MediaRecordStatus,
    visibility: asString(row.visibility) as MediaVisibility,
    retentionDays: asNumber(row.retention_days),
    keepOnline: row.keep_online === true,
    archiveState: asString(row.archive_state) as ArchiveState,
    archiveEligibleAt: asDate(row.archive_eligible_at),
    archivedAt: asDate(row.archived_at),
    localArchiveVerified: row.local_archive_verified === true,
    localArchivePath: asNullableString(row.local_archive_path),
    recordedAt: asDate(row.recorded_at),
    uploadedAt: asDate(row.uploaded_at),
    createdAt: asString(asDate(row.created_at)),
    updatedAt: asString(asDate(row.updated_at)),
  };
}

// ─── Media repository ────────────────────────────────────────────────────────

export type CreatePendingMediaInput = {
  id: string;
  publicId: string;
  ownerId: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  kind: MediaKind;
  sizeBytes: number;
  sha256: string;
  storageObjectKey: string;
  title: string;
  visibility: MediaVisibility;
  retentionDays: number;
  keepOnline: boolean;
  game: string | null;
  eventType: string | null;
  recordedAt: string | null;
  uploadId: string | null;
};

export function mediaRepository(db: Db) {
  return {
    /** Lookup by internal id, scoped to an owner. */
    async byId(ownerId: string, id: string): Promise<MediaItem | null> {
      const rows = await db`
        SELECT * FROM media WHERE id = ${id} AND owner_id = ${ownerId} AND status <> 'deleted'
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /**
     * Lookup by share id, for the public share page.
     *
     * Returns PRIVATE items too — the caller must apply the visibility rule,
     * because an authenticated owner is allowed to view their own private item
     * on the same route. Callers must never return this straight to an
     * anonymous request without checking.
     */
    async byPublicId(publicId: string): Promise<MediaItem | null> {
      const rows = await db`
        SELECT * FROM media WHERE public_id = ${publicId} AND status = 'active'
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /** Content-addressed duplicate check. */
    async byHash(ownerId: string, sha256: string): Promise<MediaItem | null> {
      const rows = await db`
        SELECT * FROM media
        WHERE owner_id = ${ownerId} AND sha256 = ${sha256.toLowerCase()} AND status <> 'deleted'
        LIMIT 1
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /**
     * Insert a pending record at upload-authorization time.
     *
     * `original_online` stays false until finalize confirms the object exists
     * at the expected size — bytes arriving in the bucket are never sufficient.
     */
    async createPending(input: CreatePendingMediaInput): Promise<MediaItem> {
      const rows = await db`
        INSERT INTO media (
          id, public_id, owner_id, original_filename, extension, mime_type, kind,
          size_bytes, sha256, storage_object_key, original_online, title,
          visibility, retention_days, keep_online, game, event_type, recorded_at,
          upload_id, status, archive_state
        ) VALUES (
          ${input.id}, ${input.publicId}, ${input.ownerId}, ${input.originalFilename},
          ${input.extension}, ${input.mimeType}, ${input.kind}::media_kind,
          ${input.sizeBytes}, ${input.sha256.toLowerCase()}, ${input.storageObjectKey},
          FALSE, ${input.title}, ${input.visibility}::media_visibility,
          ${input.retentionDays}, ${input.keepOnline}, ${input.game}, ${input.eventType},
          ${input.recordedAt}, ${input.uploadId}, 'pending', 'active'
        )
        RETURNING *
      `;
      return mapMediaRow(rows[0]);
    },

    /**
     * Mark an upload complete. IDEMPOTENT: finalizing an already-active record
     * returns it unchanged rather than creating a second row or double-counting
     * usage, so a retried or duplicated finalize call is harmless.
     */
    async finalize(input: {
      id: string;
      ownerId: string;
      sizeBytes: number;
      archiveEligibleAt: string | null;
      thumbnailKey: string | null;
      thumbnailSizeBytes: number;
      durationSeconds: number | null;
      width: number | null;
      height: number | null;
      codec: string | null;
    }): Promise<MediaItem | null> {
      const rows = await db`
        UPDATE media SET
          status = 'active',
          original_online = TRUE,
          uploaded_at = COALESCE(uploaded_at, now()),
          finalized_at = COALESCE(finalized_at, now()),
          size_bytes = ${input.sizeBytes},
          archive_eligible_at = ${input.archiveEligibleAt},
          thumbnail_key = COALESCE(${input.thumbnailKey}, thumbnail_key),
          thumbnail_size_bytes = GREATEST(thumbnail_size_bytes, ${input.thumbnailSizeBytes}),
          duration_seconds = COALESCE(${input.durationSeconds}, duration_seconds),
          width = COALESCE(${input.width}, width),
          height = COALESCE(${input.height}, height),
          codec = COALESCE(${input.codec}, codec),
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND status <> 'deleted'
        RETURNING *
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /** Editable metadata only. Never touches archive or storage columns. */
    async updateMetadata(input: {
      id: string;
      ownerId: string;
      title?: string;
      description?: string | null;
      tags?: string[];
      game?: string | null;
      eventType?: string | null;
      visibility?: MediaVisibility;
      retentionDays?: number;
      keepOnline?: boolean;
      favorite?: boolean;
      featured?: boolean;
    }): Promise<MediaItem | null> {
      const rows = await db`
        UPDATE media SET
          title = COALESCE(${input.title ?? null}, title),
          description = COALESCE(${input.description ?? null}, description),
          tags = COALESCE(${input.tags ?? null}, tags),
          game = COALESCE(${input.game ?? null}, game),
          event_type = COALESCE(${input.eventType ?? null}, event_type),
          visibility = COALESCE(${input.visibility ?? null}::media_visibility, visibility),
          retention_days = COALESCE(${input.retentionDays ?? null}, retention_days),
          keep_online = COALESCE(${input.keepOnline ?? null}, keep_online),
          favorite = COALESCE(${input.favorite ?? null}, favorite),
          featured = COALESCE(${input.featured ?? null}, featured),
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND status <> 'deleted'
        RETURNING *
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /** Owner library listing, newest first. */
    async listForOwner(ownerId: string, limit = 100, offset = 0): Promise<MediaItem[]> {
      const rows = await db`
        SELECT * FROM media
        WHERE owner_id = ${ownerId} AND status <> 'deleted'
        ORDER BY uploaded_at DESC NULLS LAST, created_at DESC
        LIMIT ${Math.min(limit, 500)} OFFSET ${Math.max(0, offset)}
      `;
      return rows.map(mapMediaRow);
    },

    /**
     * Public gallery for /clips.
     *
     * The visibility filter is in the SQL, not in the caller, so no endpoint can
     * accidentally leak private or unlisted items through this path. Archived
     * items are deliberately included: a public archived clip keeps its card.
     */
    async listPublic(limit = 60, offset = 0): Promise<MediaItem[]> {
      const rows = await db`
        SELECT * FROM media
        WHERE visibility = 'public' AND status = 'active'
        ORDER BY featured DESC, sort_order ASC, uploaded_at DESC NULLS LAST
        LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(0, offset)}
      `;
      return rows.map(mapMediaRow);
    },

    /**
     * Camera Archive listing: owner's own media, optionally narrowed to one
     * camera. `game` doubles as the camera label for KCxCamBridge uploads
     * (NVIDIA-clip parsing already treats the leading filename token as a
     * free-text label; camera names "kitchen"/"living-room" are just another
     * value in that same column). This stays a plain repository method, not
     * a route-level filter, so the camera scoping can never be bypassed by a
     * caller forgetting to apply it. Ordered by the best available recording
     * timestamp — `recorded_at` when the uploader supplied one, else
     * `uploaded_at` — newest first.
     */
    async listForOwnerByCamera(ownerId: string, camera: string | null, limit = 200, offset = 0): Promise<MediaItem[]> {
      const rows = camera
        ? await db`
            SELECT * FROM media
            WHERE owner_id = ${ownerId} AND status <> 'deleted' AND game = ${camera}
            ORDER BY COALESCE(recorded_at, uploaded_at) DESC NULLS LAST, created_at DESC
            LIMIT ${Math.min(limit, 500)} OFFSET ${Math.max(0, offset)}
          `
        : await db`
            SELECT * FROM media
            WHERE owner_id = ${ownerId} AND status <> 'deleted'
            ORDER BY COALESCE(recorded_at, uploaded_at) DESC NULLS LAST, created_at DESC
            LIMIT ${Math.min(limit, 500)} OFFSET ${Math.max(0, offset)}
          `;
      return rows.map(mapMediaRow);
    },

    /** Soft delete. The row is retained so the id is never reused. */
    async softDelete(ownerId: string, id: string): Promise<boolean> {
      const rows = await db`
        UPDATE media SET status = 'deleted', original_online = FALSE, updated_at = now()
        WHERE id = ${id} AND owner_id = ${ownerId} AND status <> 'deleted'
        RETURNING id
      `;
      return rows.length > 0;
    },

    /**
     * Authoritative local byte total: what KCxLabs believes is in R2.
     *
     * Mirrors `onlineBytesFor()` exactly — originals only when online, plus
     * thumbnails whenever a thumbnail key exists.
     */
    async totalOnlineBytes(ownerId: string): Promise<number> {
      const rows = await db`
        SELECT COALESCE(SUM(
          CASE WHEN original_online THEN size_bytes ELSE 0 END +
          CASE WHEN thumbnail_key IS NOT NULL THEN thumbnail_size_bytes ELSE 0 END
        ), 0) AS total
        FROM media
        WHERE owner_id = ${ownerId} AND status = 'active'
      `;
      return asNumber(rows[0]?.total);
    },
  };
}

// ─── Archive repository ──────────────────────────────────────────────────────

export function archiveRepository(db: Db) {
  return {
    /**
     * Items the desktop should archive next.
     *
     * Keep Online is excluded in SQL. Only items whose original is still online
     * are returned, since nothing else can free space.
     */
    async pendingJobs(ownerId: string, now: Date, limit = 20): Promise<MediaItem[]> {
      const rows = await db`
        SELECT * FROM media
        WHERE owner_id = ${ownerId}
          AND status = 'active'
          AND keep_online = FALSE
          AND original_online = TRUE
          AND archive_state IN ('active', 'archive_eligible', 'archive_failed')
          AND archive_eligible_at IS NOT NULL
          AND archive_eligible_at <= ${now.toISOString()}
        ORDER BY archive_eligible_at ASC
        LIMIT ${Math.min(limit, 100)}
      `;
      return rows.map(mapMediaRow);
    },

    /**
     * Move an item through the archive machine.
     *
     * `expectedFrom` makes the update a compare-and-set: a stale or replayed
     * client cannot move an item from a state it is no longer in. The database
     * CHECK constraints independently refuse illegal end states.
     */
    async transition(input: {
      id: string;
      ownerId: string;
      expectedFrom: ArchiveState[];
      to: ArchiveState;
    }): Promise<MediaItem | null> {
      const rows = await db`
        UPDATE media SET archive_state = ${input.to}::archive_state, updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId}
          AND archive_state = ANY(${input.expectedFrom}::archive_state[])
        RETURNING *
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /**
     * Record a verified local archive copy.
     *
     * This is the ONLY place `local_archive_verified` is set to true, and the
     * caller must have already matched both byte length and SHA-256. Everything
     * downstream — including any cloud deletion — depends on this flag, so it
     * has exactly one writer.
     */
    async confirmVerifiedArchive(input: {
      id: string;
      ownerId: string;
      localPath: string;
      sizeBytes: number;
      sha256: string;
      publicId: string;
    }): Promise<MediaItem | null> {
      const rows = await db`
        WITH updated AS (
          UPDATE media SET
            local_archive_verified = TRUE,
            local_archive_path = ${input.localPath},
            archived_at = COALESCE(archived_at, now()),
            archive_state = 'archived_local'::archive_state,
            updated_at = now()
          WHERE id = ${input.id} AND owner_id = ${input.ownerId}
            AND archive_state = 'archive_downloading'::archive_state
          RETURNING *
        ), manifest AS (
          INSERT INTO archive_manifest (media_id, public_id, local_path, size_bytes, sha256, verified_at)
          SELECT id, public_id, ${input.localPath}, ${input.sizeBytes},
                 ${input.sha256.toLowerCase()}, now()
          FROM updated
          ON CONFLICT (media_id) DO UPDATE SET
            local_path = EXCLUDED.local_path,
            size_bytes = EXCLUDED.size_bytes,
            sha256 = EXCLUDED.sha256,
            verified_at = now()
          RETURNING media_id
        )
        SELECT updated.* FROM updated
        INNER JOIN manifest ON manifest.media_id = updated.id
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    /**
     * Record that the cloud original has been removed.
     *
     * The `local_archive_verified = TRUE` predicate is a third independent
     * guard, alongside the application gate and the CHECK constraint. If it
     * matches nothing, the delete is refused and null is returned.
     */
    async markOriginalOffline(input: { id: string; ownerId: string }): Promise<MediaItem | null> {
      const rows = await db`
        UPDATE media SET
          original_online = FALSE,
          archive_state = 'archived_offline'::archive_state,
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId}
          AND local_archive_verified = TRUE
          AND archive_state = 'cloud_delete_pending'::archive_state
        RETURNING *
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    async recordFailure(input: {
      id: string;
      ownerId: string;
      reason: string;
      state: ArchiveState;
    }): Promise<void> {
      await db`
        UPDATE media SET
          archive_state = ${input.state}::archive_state,
          restore_failed_reason = ${input.reason},
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId}
      `;
    },

    /** Restore succeeded: the original is back in R2 at the same key. */
    async markRestored(input: { id: string; ownerId: string }): Promise<MediaItem | null> {
      const rows = await db`
        UPDATE media SET
          original_online = TRUE,
          archive_state = 'active'::archive_state,
          restore_requested_at = NULL,
          restore_failed_reason = NULL,
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId}
          AND archive_state = 'restoring'::archive_state
        RETURNING *
      `;
      return rows.length === 0 ? null : mapMediaRow(rows[0]);
    },

    async manifestEntry(mediaId: string) {
      const rows = await db`SELECT * FROM archive_manifest WHERE media_id = ${mediaId}`;
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        mediaId: asString(row.media_id),
        publicId: asString(row.public_id),
        localPath: asString(row.local_path),
        sizeBytes: asNumber(row.size_bytes),
        sha256: asString(row.sha256),
        archivedAt: asString(asDate(row.archived_at)),
        verifiedAt: asDate(row.verified_at),
      };
    },
  };
}

// ─── Storage metrics repository ──────────────────────────────────────────────

export function metricsRepository(db: Db) {
  return {
    async record(input: {
      bucket: string;
      payloadSizeBytes: number;
      metadataSizeBytes: number;
      objectCount: number | null;
      pendingUploadCount: number | null;
      measuredAt: string;
    }): Promise<void> {
      await db`
        INSERT INTO storage_metrics (
          bucket, payload_size_bytes, metadata_size_bytes, object_count,
          pending_upload_count, measured_at
        ) VALUES (
          ${input.bucket}, ${input.payloadSizeBytes}, ${input.metadataSizeBytes},
          ${input.objectCount}, ${input.pendingUploadCount}, ${input.measuredAt}
        )
      `;
    },

    /** Most recent reading, used when a live fetch fails or is skipped. */
    async latest(bucket: string) {
      const rows = await db`
        SELECT * FROM storage_metrics WHERE bucket = ${bucket}
        ORDER BY measured_at DESC LIMIT 1
      `;
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        storedBytes: asNumber(row.payload_size_bytes) + asNumber(row.metadata_size_bytes),
        objectCount: asNumber(row.object_count),
        pendingUploadCount: asNullableNumber(row.pending_upload_count),
        measuredAt: asString(asDate(row.measured_at)),
        fetchedAt: asString(asDate(row.fetched_at)),
      };
    },
  };
}

// ─── Auth repository ─────────────────────────────────────────────────────────

export function authRepository(db: Db) {
  return {
    async ownerByEmail(email: string) {
      const rows = await db`SELECT id, email, password_hash FROM owners WHERE email = ${email}`;
      if (rows.length === 0) return null;
      return {
        id: asString(rows[0].id),
        email: asString(rows[0].email),
        passwordHash: asString(rows[0].password_hash),
      };
    },

    async ensureOwner(input: { id: string; email: string; passwordHash: string }): Promise<void> {
      await db`
        INSERT INTO owners (id, email, password_hash) VALUES (${input.id}, ${input.email}, ${input.passwordHash})
        ON CONFLICT (email) DO NOTHING
      `;
    },

    /** Stores only the token hash. The raw token is never persisted. */
    async createDeviceToken(input: {
      id: string;
      ownerId: string;
      tokenHash: string;
      deviceName: string;
      expiresAt: string | null;
    }): Promise<void> {
      await db`
        INSERT INTO device_tokens (id, owner_id, token_hash, device_name, expires_at)
        VALUES (${input.id}, ${input.ownerId}, ${input.tokenHash}, ${input.deviceName}, ${input.expiresAt})
      `;
    },

    async deviceTokenByHash(tokenHash: string) {
      const rows = await db`
        SELECT id, owner_id, device_name, expires_at, revoked_at
        FROM device_tokens WHERE token_hash = ${tokenHash}
      `;
      if (rows.length === 0) return null;
      return {
        id: asString(rows[0].id),
        ownerId: asString(rows[0].owner_id),
        deviceName: asString(rows[0].device_name),
        expiresAt: asDate(rows[0].expires_at),
        revokedAt: asDate(rows[0].revoked_at),
      };
    },

    async touchDeviceToken(id: string): Promise<void> {
      await db`UPDATE device_tokens SET last_used_at = now() WHERE id = ${id}`;
    },

    async revokeDeviceToken(ownerId: string, id: string): Promise<boolean> {
      const rows = await db`
        UPDATE device_tokens SET revoked_at = now()
        WHERE id = ${id} AND owner_id = ${ownerId} AND revoked_at IS NULL
        RETURNING id
      `;
      return rows.length > 0;
    },
  };
}

// ─── Event log ───────────────────────────────────────────────────────────────

/**
 * Structured event log. There is deliberately no column for tokens, passwords,
 * or signed URLs, so a secret cannot be written here even by mistake.
 */
export function eventLog(db: Db) {
  return {
    async record(input: {
      event: string;
      mediaId?: string | null;
      ownerId?: string | null;
      detail?: string | null;
    }): Promise<void> {
      await db`
        INSERT INTO media_events (event, media_id, owner_id, detail)
        VALUES (${input.event}, ${input.mediaId ?? null}, ${input.ownerId ?? null}, ${input.detail ?? null})
      `;
    },
  };
}

// ─── Camera archive repository ───────────────────────────────────────────────
//
// Fully isolated from `media`/`mediaRepository`: a dedicated table, a
// dedicated bucket (see `cameraR2` in config), and a budget that only ever
// sums THIS table. Nothing here joins or reads the `media` table, and
// nothing in `mediaRepository` reads this one — that separation is what
// keeps the 5 GB camera budget honest and keeps /clips and /c/:publicId
// structurally unable to surface a camera recording.

/** `pending_delete`: claimed for removal, R2 delete not yet confirmed — still counted in the budget. See camera-storage.ts. */
export type CameraRecordingStatus = "reserved" | "active" | "pending_delete" | "deleted";

export type CameraRecording = {
  id: string;
  recordingId: string;
  ownerId: string;
  camera: string;
  cameraName: string;
  storageObjectKey: string;
  mimeType: string;
  sizeBytes: number;
  reservedBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  codec: string | null;
  recordedStartAt: string;
  recordedEndAt: string;
  durationSeconds: number | null;
  protected: boolean;
  status: CameraRecordingStatus;
  createdAt: string;
  finalizedAt: string | null;
  deletedAt: string | null;
};

function mapCameraRow(row: MediaRow): CameraRecording {
  return {
    id: asString(row.id),
    recordingId: asString(row.recording_id),
    ownerId: asString(row.owner_id),
    camera: asString(row.camera),
    cameraName: asString(row.camera_name),
    storageObjectKey: asString(row.storage_object_key),
    mimeType: asString(row.mime_type),
    sizeBytes: asNumber(row.size_bytes),
    reservedBytes: asNumber(row.reserved_bytes),
    sha256: asString(row.sha256),
    width: asNullableNumber(row.width),
    height: asNullableNumber(row.height),
    codec: asNullableString(row.codec),
    recordedStartAt: asString(asDate(row.recorded_start_at)),
    recordedEndAt: asString(asDate(row.recorded_end_at)),
    durationSeconds: asNullableNumber(row.duration_seconds),
    protected: row.protected === true,
    status: asString(row.status) as CameraRecordingStatus,
    createdAt: asString(asDate(row.created_at)),
    finalizedAt: asDate(row.finalized_at),
    deletedAt: asDate(row.deleted_at),
  };
}

function mapDeletionCandidate(row: MediaRow): DeletionCandidate {
  return { id: asString(row.id), storageObjectKey: asString(row.storage_object_key), sizeBytes: asNumber(row.size_bytes) };
}

export function cameraRepository(db: Db) {
  return {
    /** Idempotency lookup: an in-flight or already-finalized reservation for this recording. */
    async byRecordingId(recordingId: string): Promise<CameraRecording | null> {
      const rows = await db`
        SELECT * FROM camera_recordings WHERE recording_id = ${recordingId} AND status <> 'deleted'
      `;
      return rows.length === 0 ? null : mapCameraRow(rows[0]);
    },

    async byId(id: string): Promise<CameraRecording | null> {
      const rows = await db`SELECT * FROM camera_recordings WHERE id = ${id} AND status <> 'deleted'`;
      return rows.length === 0 ? null : mapCameraRow(rows[0]);
    },

    /**
     * Current live accounting: active bytes (split protected/unprotected),
     * outstanding reservations, and objects whose deletion is not yet
     * confirmed (they still occupy the bucket).
     */
    async usage(): Promise<{ protectedBytes: number; unprotectedBytes: number; reservedBytes: number; pendingDeleteBytes: number }> {
      const rows = await db`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'active' AND protected THEN size_bytes ELSE 0 END), 0) AS protected_bytes,
          COALESCE(SUM(CASE WHEN status = 'active' AND NOT protected THEN size_bytes ELSE 0 END), 0) AS unprotected_bytes,
          COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_bytes ELSE 0 END), 0) AS reserved_bytes,
          COALESCE(SUM(CASE WHEN status = 'pending_delete' THEN size_bytes ELSE 0 END), 0) AS pending_delete_bytes
        FROM camera_recordings
      `;
      return {
        protectedBytes: asNumber(rows[0]?.protected_bytes),
        unprotectedBytes: asNumber(rows[0]?.unprotected_bytes),
        reservedBytes: asNumber(rows[0]?.reserved_bytes),
        pendingDeleteBytes: asNumber(rows[0]?.pending_delete_bytes),
      };
    },

    /**
     * Oldest-first rotation CLAIM, as ONE atomic statement. Nothing is
     * deleted here: victims move to `pending_delete` with their key and size
     * intact, and only `confirmDeleted` (after R2 confirms) retires them.
     *
     * The shortfall is computed from the LIVE table inside the statement,
     * counting active + reserved bytes but NOT bytes already pending
     * deletion — those are already on their way out, so a concurrent
     * authorization that already claimed victims makes this one claim
     * nothing extra (no over-rotation). Reservations, in contrast, keep
     * counting pending bytes as used (see `reserve`), so space is never
     * handed out before its delete is confirmed.
     *
     * Selects the smallest oldest-first prefix of unprotected active rows
     * whose cumulative size reaches the shortfall. If the unprotected total
     * can't reach it (protected rows are blocking), nothing is claimed — no
     * partial, insufficient rotation. The UPDATE re-checks `status = 'active'
     * AND protected = FALSE` per row, so a concurrent protect or a concurrent
     * claim of the same row is never overridden.
     */
    async claimForRotation(input: { incomingBytes: number; budgetBytes: number }): Promise<DeletionCandidate[]> {
      const rows = await db`
        WITH committed AS (
          SELECT
            COALESCE(SUM(CASE WHEN status = 'active' THEN size_bytes ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_bytes ELSE 0 END), 0) AS bytes
          FROM camera_recordings
        ),
        need AS (
          SELECT bytes + ${input.incomingBytes} - ${input.budgetBytes} AS shortfall FROM committed
        ),
        unprotected AS (
          SELECT id, size_bytes,
                 SUM(size_bytes) OVER (ORDER BY recorded_start_at ASC, id ASC) AS running_total,
                 SUM(size_bytes) OVER () AS total_available
          FROM camera_recordings
          WHERE status = 'active' AND protected = FALSE
        ),
        victims AS (
          SELECT unprotected.id FROM unprotected, need
          WHERE need.shortfall > 0
            AND (unprotected.running_total - unprotected.size_bytes) < need.shortfall
            AND unprotected.total_available >= need.shortfall
        )
        UPDATE camera_recordings SET
          status = 'pending_delete', delete_reason = 'rotation', delete_requested_at = now(),
          delete_attempts = 1, last_delete_attempt_at = now()
        WHERE id IN (SELECT id FROM victims) AND status = 'active' AND protected = FALSE
        RETURNING id, storage_object_key, size_bytes
      `;
      return rows.map(mapDeletionCandidate);
    },

    /**
     * Abandoned uploads: a `reserved` row whose upload URL was last issued
     * more than `ttlMinutes` ago moves to `pending_delete`. Its reserved size
     * becomes its accounted size, so the budget keeps covering whatever
     * partial object may exist until R2 confirms the delete. `markActive`
     * only accepts `status = 'reserved'`, so a finalize racing this claim
     * either wins first (row is active, not claimed) or fails cleanly.
     * SKIP LOCKED lets concurrent sweeps split the work instead of blocking.
     *
     * The batch is picked in a MATERIALIZED CTE, never `WHERE id IN (SELECT
     * … LIMIT … SKIP LOCKED)`: Postgres may re-execute such a subquery during
     * the join, which (verified against real Postgres) silently exceeds LIMIT.
     */
    async claimStaleReservations(input: { ttlMinutes: number; limit: number }): Promise<DeletionCandidate[]> {
      const rows = await db`
        WITH picked AS MATERIALIZED (
          SELECT id FROM camera_recordings
          WHERE status = 'reserved' AND authorized_at < now() - make_interval(mins => ${input.ttlMinutes})
          ORDER BY authorized_at ASC
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE camera_recordings SET
          status = 'pending_delete', delete_reason = 'expired_reservation', delete_requested_at = now(),
          size_bytes = reserved_bytes, reserved_bytes = 0,
          delete_attempts = 1, last_delete_attempt_at = now()
        FROM picked
        WHERE camera_recordings.id = picked.id AND camera_recordings.status = 'reserved'
        RETURNING camera_recordings.id, camera_recordings.storage_object_key, camera_recordings.size_bytes
      `;
      return rows.map(mapDeletionCandidate);
    },

    /**
     * Retry queue for interrupted deletions. Leasing (bumping the attempt
     * counter and timestamp in the same UPDATE) means two concurrent sweeps
     * never both pick the same row, and exponential backoff (30 s doubling,
     * capped at 1 h) keeps an R2 outage from being hammered. Rows that hit
     * `maxAttempts` stay `pending_delete` — still counted, never silently
     * dropped — for manual review.
     */
    async leasePendingDeletions(input: { limit: number; maxAttempts: number }): Promise<DeletionCandidate[]> {
      const rows = await db`
        WITH picked AS MATERIALIZED (
          SELECT id FROM camera_recordings
          WHERE status = 'pending_delete'
            AND delete_attempts < ${input.maxAttempts}
            AND (last_delete_attempt_at IS NULL
                 OR last_delete_attempt_at < now() - make_interval(secs => LEAST(3600, 30 * power(2, delete_attempts))))
          ORDER BY delete_requested_at ASC
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE camera_recordings SET
          delete_attempts = camera_recordings.delete_attempts + 1, last_delete_attempt_at = now()
        FROM picked
        WHERE camera_recordings.id = picked.id AND camera_recordings.status = 'pending_delete'
        RETURNING camera_recordings.id, camera_recordings.storage_object_key, camera_recordings.size_bytes
      `;
      return rows.map(mapDeletionCandidate);
    },

    /** Only after R2 confirmed the delete. Idempotent: a second confirmation of the same row is a no-op. */
    async confirmDeleted(id: string): Promise<boolean> {
      const rows = await db`
        UPDATE camera_recordings SET status = 'deleted', deleted_at = now(), last_delete_error = NULL
        WHERE id = ${id} AND status = 'pending_delete'
        RETURNING id
      `;
      return rows.length > 0;
    },

    /** Keeps the row pending (key and size intact) and records a short, non-secret failure code. */
    async recordDeleteFailure(id: string, code: string): Promise<void> {
      await db`
        UPDATE camera_recordings SET last_delete_error = ${code.slice(0, 64)}
        WHERE id = ${id} AND status = 'pending_delete'
      `;
    },

    /**
     * Expired reservations whose late-upload grace period has passed and that
     * haven't been checked yet. Leased like deletions (attempt counter +
     * hourly backoff, SKIP LOCKED) so concurrent runs split the work.
     * Rotated rows never qualify: they were finalized, so no PUT can follow.
     */
    async leaseLateUploadChecks(input: { graceMinutes: number; limit: number; maxAttempts: number }): Promise<DeletionCandidate[]> {
      const rows = await db`
        WITH picked AS MATERIALIZED (
          SELECT id FROM camera_recordings
          WHERE status = 'deleted' AND delete_reason = 'expired_reservation'
            AND late_upload_checked_at IS NULL
            AND deleted_at < now() - make_interval(mins => ${input.graceMinutes})
            AND late_upload_check_attempts < ${input.maxAttempts}
            AND (last_late_upload_check_at IS NULL OR last_late_upload_check_at < now() - interval '1 hour')
          ORDER BY deleted_at ASC
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE camera_recordings SET
          late_upload_check_attempts = camera_recordings.late_upload_check_attempts + 1, last_late_upload_check_at = now()
        FROM picked
        WHERE camera_recordings.id = picked.id AND camera_recordings.status = 'deleted'
        RETURNING camera_recordings.id, camera_recordings.storage_object_key, camera_recordings.size_bytes
      `;
      return rows.map(mapDeletionCandidate);
    },

    async markLateUploadChecked(id: string): Promise<void> {
      await db`UPDATE camera_recordings SET late_upload_checked_at = now() WHERE id = ${id} AND status = 'deleted'`;
    },

    /** Of the given keys, those still referenced by a live (non-deleted) row — never treated as orphans. */
    async liveObjectKeys(keys: string[]): Promise<Set<string>> {
      if (keys.length === 0) return new Set();
      const rows = await db`
        SELECT storage_object_key FROM camera_recordings
        WHERE storage_object_key = ANY(${keys}::text[]) AND status <> 'deleted'
      `;
      return new Set(rows.map((r) => asString(r.storage_object_key)));
    },

    /**
     * Single-runner lease for the scheduled cleanup, one atomic upsert: it
     * succeeds when no lock exists or the existing one is older than the TTL
     * (a crashed run). Concurrent invocations get false and exit.
     */
    async tryAcquireCleanupLock(input: { holder: string; ttlSeconds: number }): Promise<boolean> {
      const rows = await db`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('camera_cleanup_lock', ${input.holder}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE app_settings.updated_at < now() - make_interval(secs => ${input.ttlSeconds})
        RETURNING value
      `;
      return rows.length > 0 && asString(rows[0].value) === input.holder;
    },

    async releaseCleanupLock(holder: string): Promise<void> {
      await db`DELETE FROM app_settings WHERE key = 'camera_cleanup_lock' AND value = ${holder}`;
    },

    async recordCleanupRun(summary: string): Promise<void> {
      await db`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('camera_cleanup_last_run', ${summary}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    },

    /**
     * Owner-facing cleanup health: deletions still waiting on R2, those that
     * exhausted their retries (still counted in the budget — they need manual
     * attention), late-upload checks that exhausted theirs, and the last
     * scheduled run's counts. Never returns keys or ids.
     */
    async cleanupHealth(input: { maxAttempts: number }): Promise<{
      pendingDeleteCount: number;
      stuckDeleteCount: number;
      stuckLateUploadCheckCount: number;
      lastCleanupRun: string | null;
    }> {
      const rows = await db`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending_delete') AS pending_delete_count,
          COUNT(*) FILTER (WHERE status = 'pending_delete' AND delete_attempts >= ${input.maxAttempts}) AS stuck_delete_count,
          COUNT(*) FILTER (WHERE status = 'deleted' AND delete_reason = 'expired_reservation'
                             AND late_upload_checked_at IS NULL AND late_upload_check_attempts >= ${input.maxAttempts}) AS stuck_late_upload_check_count,
          (SELECT value FROM app_settings WHERE key = 'camera_cleanup_last_run') AS last_cleanup_run
        FROM camera_recordings
      `;
      return {
        pendingDeleteCount: asNumber(rows[0]?.pending_delete_count),
        stuckDeleteCount: asNumber(rows[0]?.stuck_delete_count),
        stuckLateUploadCheckCount: asNumber(rows[0]?.stuck_late_upload_check_count),
        lastCleanupRun: asNullableString(rows[0]?.last_cleanup_run),
      };
    },

    async readSweepCursor(): Promise<string | null> {
      const rows = await db`SELECT value FROM app_settings WHERE key = 'camera_orphan_sweep_cursor'`;
      return rows.length === 0 ? null : asNullableString(rows[0].value);
    },

    /** A null cursor means the pass finished; the next sweep starts from the beginning. */
    async writeSweepCursor(cursor: string | null): Promise<void> {
      if (cursor === null) {
        await db`DELETE FROM app_settings WHERE key = 'camera_orphan_sweep_cursor'`;
        return;
      }
      await db`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('camera_orphan_sweep_cursor', ${cursor}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    },

    /**
     * Re-issuing an upload URL for an existing reservation restarts its TTL.
     * Returns null if the row was claimed for expiry in the meantime, so the
     * caller never hands out a URL for an object that is being deleted.
     */
    async touchReservation(id: string): Promise<CameraRecording | null> {
      const rows = await db`
        UPDATE camera_recordings SET authorized_at = now()
        WHERE id = ${id} AND status = 'reserved'
        RETURNING *
      `;
      return rows.length === 0 ? null : mapCameraRow(rows[0]);
    },

    /**
     * Create a `reserved` row, re-checking the live budget inside the INSERT
     * itself (`WHERE ... <= budgetBytes`). Pending deletions count as used
     * until confirmed. Returns null if it still doesn't fit even after the
     * caller's rotation — the caller must treat that as `storage_full`, not
     * retry the insert differently.
     */
    async reserve(input: {
      id: string;
      recordingId: string;
      ownerId: string;
      camera: string;
      cameraName: string;
      storageObjectKey: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      width: number | null;
      height: number | null;
      codec: string | null;
      recordedStartAt: string;
      recordedEndAt: string;
      durationSeconds: number | null;
      budgetBytes: number;
    }): Promise<CameraRecording | null> {
      // A single INSERT … WHERE fits-in-budget is NOT enough on its own: under
      // READ COMMITTED, concurrent inserts can't see each other's uncommitted
      // rows, so N parallel reservations each pass the check (verified against
      // real Postgres: 6 × 30 MB granted on a 100 MB budget). A transaction-
      // scoped advisory lock serializes reservations; the INSERT, as the
      // transaction's second statement, takes its snapshot only after the lock
      // is held, so it sees every reservation committed before it.
      const [, rows] = await db.transaction((txn) => [
        txn`SELECT pg_advisory_xact_lock(hashtext('kcx_camera_budget'))`,
        txn`
        WITH usage AS (
          SELECT COALESCE(SUM(size_bytes), 0) AS active_bytes
          FROM camera_recordings WHERE status IN ('active', 'pending_delete')
        ), reserved AS (
          SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes
          FROM camera_recordings WHERE status = 'reserved'
        )
        INSERT INTO camera_recordings (
          id, recording_id, owner_id, camera, camera_name, storage_object_key, mime_type,
          size_bytes, reserved_bytes, sha256, width, height, codec,
          recorded_start_at, recorded_end_at, duration_seconds, status
        )
        SELECT
          ${input.id}, ${input.recordingId}, ${input.ownerId}, ${input.camera}, ${input.cameraName},
          ${input.storageObjectKey}, ${input.mimeType}, 0, ${input.sizeBytes}, ${input.sha256.toLowerCase()},
          ${input.width}, ${input.height}, ${input.codec},
          ${input.recordedStartAt}, ${input.recordedEndAt}, ${input.durationSeconds}, 'reserved'
        FROM usage, reserved
        WHERE usage.active_bytes + reserved.reserved_bytes + ${input.sizeBytes} <= ${input.budgetBytes}
        RETURNING *
      `,
      ]);
      return rows.length === 0 ? null : mapCameraRow(rows[0]);
    },

    /**
     * Finalize. Idempotent: an already-`active` row with this id is returned
     * unchanged rather than re-updated or treated as an error, so a retried
     * finalize call after a dropped response is harmless.
     */
    async markActive(input: { id: string; actualSizeBytes: number }): Promise<{ item: CameraRecording; idempotent: boolean } | null> {
      const updated = await db`
        UPDATE camera_recordings SET
          status = 'active', size_bytes = ${input.actualSizeBytes}, reserved_bytes = 0, finalized_at = now()
        WHERE id = ${input.id} AND status = 'reserved'
        RETURNING *
      `;
      if (updated.length > 0) return { item: mapCameraRow(updated[0]), idempotent: false };

      const existing = await db`SELECT * FROM camera_recordings WHERE id = ${input.id} AND status = 'active'`;
      return existing.length > 0 ? { item: mapCameraRow(existing[0]), idempotent: true } : null;
    },

    /**
     * Owner-only toggle. Scoped to `status = 'active'` rows only — a
     * `reserved` or already-`deleted` row has no protection to toggle.
     * Race-free against rotation: `rotateForSpace` re-reads `protected` at
     * the instant its DELETE executes, so a protect that committed before
     * that statement began excludes the row; Postgres's row-level locking
     * on the matched set serializes a true in-flight race rather than
     * allowing a protected row to be deleted.
     */
    async setProtected(input: { id: string; ownerId: string; protected: boolean }): Promise<CameraRecording | null> {
      const rows = await db`
        UPDATE camera_recordings SET protected = ${input.protected}
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND status = 'active'
        RETURNING *
      `;
      return rows.length === 0 ? null : mapCameraRow(rows[0]);
    },

    /** Owner archive browsing: optional camera filter, optional [from, to) recorded-time window (caller computes LA-local day bounds). */
    async listForOwner(input: {
      ownerId: string;
      camera: string | null;
      from: string | null;
      to: string | null;
      limit?: number;
    }): Promise<CameraRecording[]> {
      const limit = Math.min(input.limit ?? 200, 500);
      const rows = await db`
        SELECT * FROM camera_recordings
        WHERE owner_id = ${input.ownerId} AND status = 'active'
          AND (${input.camera}::text IS NULL OR camera = ${input.camera})
          AND (${input.from}::timestamptz IS NULL OR recorded_start_at >= ${input.from}::timestamptz)
          AND (${input.to}::timestamptz IS NULL OR recorded_start_at < ${input.to}::timestamptz)
        ORDER BY recorded_start_at DESC
        LIMIT ${limit}
      `;
      return rows.map(mapCameraRow);
    },
  };
}
