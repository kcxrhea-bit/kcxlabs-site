-- Crash-recoverable deletion for the Camera Archive (see
-- server/media-api/_lib/camera-storage.ts).
--
-- A row leaving the archive (rotation or an expired reservation) now passes
-- through `pending_delete`, which keeps its R2 key and size until the R2
-- delete is confirmed. Previously rotation hard-deleted rows and never
-- removed the objects, orphaning footage in the bucket.
--
-- Safe to re-run: every change is guarded with IF [NOT] EXISTS.

ALTER TABLE camera_recordings DROP CONSTRAINT IF EXISTS camera_recordings_status_check;
ALTER TABLE camera_recordings ADD CONSTRAINT camera_recordings_status_check
  CHECK (status IN ('reserved', 'active', 'pending_delete', 'deleted'));

-- When the upload URL for a reservation was last issued; drives the TTL so a
-- legitimately retried upload is never expired mid-flight.
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ;
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS delete_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS last_delete_attempt_at TIMESTAMPTZ;
-- Short error class name only (e.g. "NetworkError"), never an SDK message.
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS last_delete_error TEXT;

ALTER TABLE camera_recordings DROP CONSTRAINT IF EXISTS camera_recordings_delete_reason_check;
ALTER TABLE camera_recordings ADD CONSTRAINT camera_recordings_delete_reason_check
  CHECK (delete_reason IS NULL OR delete_reason IN ('rotation', 'expired_reservation'));

-- Defence in depth: a protected recording can never be in the deletion workflow.
ALTER TABLE camera_recordings DROP CONSTRAINT IF EXISTS camera_recordings_pending_unprotected_check;
ALTER TABLE camera_recordings ADD CONSTRAINT camera_recordings_pending_unprotected_check
  CHECK (status <> 'pending_delete' OR protected = FALSE);

-- `deleted` rows are kept as an audit trail, so recording_id is unique only
-- among live rows; otherwise a recording whose abandoned reservation expired
-- could never be uploaded again.
ALTER TABLE camera_recordings DROP CONSTRAINT IF EXISTS camera_recordings_recording_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS camera_recordings_recording_id_live_idx
  ON camera_recordings (recording_id)
  WHERE status <> 'deleted';

-- Late-upload reconciliation: an expired reservation's signed PUT could land
-- after its row was deleted. The scheduled cleanup re-checks each such key
-- once, after a grace period, and removes any object it finds.
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS late_upload_checked_at TIMESTAMPTZ;
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS late_upload_check_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS last_late_upload_check_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS camera_recordings_late_upload_idx
  ON camera_recordings (deleted_at)
  WHERE status = 'deleted' AND delete_reason = 'expired_reservation' AND late_upload_checked_at IS NULL;

-- Orphan sweep looks keys up in batches.
CREATE INDEX IF NOT EXISTS camera_recordings_object_key_idx
  ON camera_recordings (storage_object_key);

-- Retry queue for interrupted deletions.
CREATE INDEX IF NOT EXISTS camera_recordings_pending_delete_idx
  ON camera_recordings (delete_requested_at)
  WHERE status = 'pending_delete';

-- Stale-reservation sweep now keys off authorized_at, not created_at.
DROP INDEX IF EXISTS camera_recordings_reserved_idx;
CREATE INDEX IF NOT EXISTS camera_recordings_reserved_idx
  ON camera_recordings (authorized_at)
  WHERE status = 'reserved';

INSERT INTO schema_migrations (version) VALUES ('006_camera_deletion_safety')
  ON CONFLICT (version) DO NOTHING;
