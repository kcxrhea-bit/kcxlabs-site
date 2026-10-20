-- Dedicated, isolated storage for KCxCamBridge camera backups.
--
-- Deliberately a SEPARATE table from `media`: the 5 GB camera budget must
-- only ever sum rows in this table, never the general Media Center's
-- uploads or release files. No foreign key to `media` — these rows are
-- never surfaced through /clips or /c/:publicId.
--
-- `camera` is a free-text column with a CHECK allow-list rather than a
-- Postgres ENUM, so adding a second camera later is a one-line constraint
-- change, not a type migration.
CREATE TABLE IF NOT EXISTS camera_recordings (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  camera TEXT NOT NULL CHECK (camera IN ('living-room')),
  camera_name TEXT NOT NULL,
  storage_object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  codec TEXT,
  recorded_start_at TIMESTAMPTZ NOT NULL,
  recorded_end_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CHECK (recorded_end_at > recorded_start_at)
);

-- Oldest-first rotation scans active, unprotected rows ordered by capture time.
CREATE INDEX IF NOT EXISTS camera_recordings_rotation_idx
  ON camera_recordings (status, protected, recorded_start_at)
  WHERE status = 'active';

-- Archive browsing: by owner, optionally narrowed to one camera and date.
CREATE INDEX IF NOT EXISTS camera_recordings_owner_camera_idx
  ON camera_recordings (owner_id, camera, recorded_start_at DESC)
  WHERE status = 'active';

-- Stale-reservation reconciliation sweep.
CREATE INDEX IF NOT EXISTS camera_recordings_reserved_idx
  ON camera_recordings (status, created_at)
  WHERE status = 'reserved';

-- Owner-configurable settings (currently just the camera budget override).
-- Reused as a general single-row key/value table if other owner settings
-- need persisting later; today it holds exactly one key.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('005_camera_archive')
  ON CONFLICT (version) DO NOTHING;
