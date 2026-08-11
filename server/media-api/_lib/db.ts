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
import type { DatabaseConfig } from "./config";
import type {
  ArchiveState,
  MediaItem,
  MediaKind,
  MediaRecordStatus,
  MediaVisibility,
} from "../../../src/media/types";

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
