-- 001_media_init.sql — KCx Media Center initial schema
--
-- Target: Postgres 15+ (Neon). Apply with `npm run db:migrate`; never edit a
-- production schema by hand.
--
-- Migrations are append-only ONCE APPLIED: to change something after this file
-- has run against any database, add 002_*.sql instead of editing it. This file
-- has not yet been applied anywhere (no Neon project exists), so the retention
-- default was corrected in place rather than shipping a same-day 002.
--
-- Design notes:
--   * Real columns, not a JSON blob, so retention and listing queries can be
--     indexed and reasoned about.
--   * Deletion safety is enforced here as well as in application code: see the
--     media_cloud_delete_requires_local_archive CHECK constraint. A bug in the
--     API cannot mark an item cloud-deleted without a verified local copy.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Enumerations ───────────────────────────────────────────────────────────
-- Enums rather than free text so an invalid state cannot be written at all.

DO $$ BEGIN
  CREATE TYPE media_visibility AS ENUM ('private', 'unlisted', 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE media_record_status AS ENUM ('pending', 'active', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE media_kind AS ENUM ('video', 'image', 'audio', 'document', 'archive', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One state machine spanning both tiers: ONLINE (R2 holds the original) and
-- ARCHIVED_OFFLINE (the PC holds it, the media record and share page live on).
-- 'archived_offline' replaces the earlier 'cloud_deleted': the item is not
-- destroyed, only relocated, and it is restorable.
DO $$ BEGIN
  CREATE TYPE archive_state AS ENUM (
    'active',
    'archive_eligible',
    'archive_downloading',
    'archived_local',
    'cloud_delete_pending',
    'archived_offline',
    'archive_failed',
    'restore_requested',
    'restoring',
    'restore_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Owners ─────────────────────────────────────────────────────────────────
-- Single-owner today, but the column exists everywhere so multi-owner never
-- requires a data migration. The password hash is scrypt (node:crypto), stored
-- as "scrypt$N$r$p$salt$hash"; plaintext passwords are never stored or logged.

CREATE TABLE IF NOT EXISTS owners (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Device tokens ──────────────────────────────────────────────────────────
-- The desktop authenticates with a bearer token issued once at pairing.
-- Only the SHA-256 of the token is stored: a database disclosure cannot be
-- replayed as a valid credential. Revocation and expiry are both supported.

CREATE TABLE IF NOT EXISTS device_tokens (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  token_hash   TEXT UNIQUE NOT NULL,
  device_name  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS device_tokens_owner_idx ON device_tokens (owner_id);

-- ─── Media ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS media (
  id                     TEXT PRIMARY KEY,

  -- The only identifier that appears in a share URL. High-entropy and unique;
  -- for unlisted items this value IS the access control, so it is never
  -- sequential and never derived from user input.
  public_id              TEXT UNIQUE NOT NULL,
  owner_id               TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,

  -- Source file
  original_filename      TEXT NOT NULL,
  extension              TEXT NOT NULL DEFAULT '',
  mime_type              TEXT NOT NULL,
  kind                   media_kind NOT NULL DEFAULT 'other',
  size_bytes             BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256                 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),

  -- Storage
  storage_provider       TEXT NOT NULL DEFAULT 'r2',
  -- Key of the large original. Retained after archival so a restore can put the
  -- object back at exactly the same key and the share URL keeps resolving.
  -- Presence of a key does not imply the object exists: original_online does.
  storage_object_key     TEXT NOT NULL,
  -- Whether R2 currently holds the original. The share page, the player, and
  -- byte accounting all read this one flag.
  original_online        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Small poster kept online so archived clips still show a frame.
  thumbnail_key          TEXT,
  thumbnail_size_bytes   BIGINT NOT NULL DEFAULT 0 CHECK (thumbnail_size_bytes >= 0),

  -- Restore
  restore_requested_at   TIMESTAMPTZ,
  restore_failed_reason  TEXT,

  -- Descriptive metadata
  title                  TEXT NOT NULL DEFAULT '',
  description            TEXT,
  tags                   TEXT[] NOT NULL DEFAULT '{}',
  game                   TEXT,
  event_type             TEXT,

  -- Media characteristics; null when ffprobe was unavailable or failed. A
  -- failed probe must never block an upload, hence every column is nullable.
  duration_seconds       DOUBLE PRECISION,
  width                  INTEGER,
  height                 INTEGER,
  codec                  TEXT,

  -- Lifecycle
  status                 media_record_status NOT NULL DEFAULT 'pending',
  visibility             media_visibility NOT NULL DEFAULT 'unlisted',
  -- Days online before an item becomes ARCHIVE ELIGIBLE. Kept in sync with
  -- DEFAULT_RETENTION_DAYS in src/media/types.ts. This governs only when
  -- archiving is offered; the deletion gate below is unaffected by it.
  retention_days         INTEGER NOT NULL DEFAULT 10 CHECK (retention_days >= 1),
  keep_online            BOOLEAN NOT NULL DEFAULT FALSE,
  archive_state          archive_state NOT NULL DEFAULT 'active',
  archive_eligible_at    TIMESTAMPTZ,
  archived_at            TIMESTAMPTZ,
  local_archive_verified BOOLEAN NOT NULL DEFAULT FALSE,
  local_archive_path     TEXT,

  -- Upload idempotency: the storage multipart upload id. Finalize is keyed on
  -- (id, upload_id) so a duplicated or retried finalize call updates the same
  -- row instead of creating a second media record.
  upload_id              TEXT,
  finalized_at           TIMESTAMPTZ,

  recorded_at            TIMESTAMPTZ,
  uploaded_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE INVARIANT, enforced by the database itself.
  --
  -- An item may only be recorded as cloud-deleted (or queued for it) when a
  -- local archive copy has been downloaded and checksum-verified. This makes
  -- "delete the only known copy" unrepresentable rather than merely avoided.
  -- Manual owner-initiated deletion is a separate path that sets status
  -- 'deleted' and does not use these archive states.
  CONSTRAINT media_cloud_delete_requires_local_archive CHECK (
    archive_state NOT IN ('cloud_delete_pending', 'archived_offline', 'restore_requested', 'restore_failed')
    OR local_archive_verified = TRUE
  ),

  -- The other half of the same rule, from the object's point of view: an active
  -- item whose original is not in R2 must have a verified local copy. Together
  -- with the constraint above, "the only copy was deleted" cannot be represented
  -- in this database at all — storage pressure included, since pressure never
  -- writes a state, it only changes which item is worked on next.
  CONSTRAINT media_offline_original_requires_local_archive CHECK (
    status <> 'active'
    OR original_online = TRUE
    OR local_archive_verified = TRUE
  ),

  -- A verified local archive must record where the copy actually is.
  CONSTRAINT media_verified_archive_has_path CHECK (
    local_archive_verified = FALSE OR local_archive_path IS NOT NULL
  )
);

-- Content-addressed dedupe: the same bytes uploaded twice by the same owner
-- reuse the existing record instead of paying to store a second copy.
-- Partial, so soft-deleted rows do not block re-uploading the same content.
CREATE UNIQUE INDEX IF NOT EXISTS media_owner_sha256_idx
  ON media (owner_id, sha256)
  WHERE status <> 'deleted';

-- Drives the public /clips gallery. Partial on visibility so the index itself
-- cannot serve a private or unlisted row by accident.
CREATE INDEX IF NOT EXISTS media_public_gallery_idx
  ON media (uploaded_at DESC)
  WHERE visibility = 'public' AND status = 'active';

-- Drives the archive job feed.
CREATE INDEX IF NOT EXISTS media_archive_sweep_idx
  ON media (archive_eligible_at)
  WHERE keep_online = FALSE AND status = 'active';

-- Drives storage-pressure candidate selection: only items whose original is
-- still in R2 can free space by being archived.
CREATE INDEX IF NOT EXISTS media_online_originals_idx
  ON media (uploaded_at)
  WHERE original_online = TRUE AND status = 'active' AND keep_online = FALSE;

-- ─── Local archive manifest (server-side mirror) ────────────────────────────
-- The desktop keeps the authoritative manifest on disk; this table records what
-- the desktop has confirmed, so the backend knows which cloud objects have a
-- verified local copy and can answer restore requests. Lookup is by media_id,
-- never by filename.

CREATE TABLE IF NOT EXISTS archive_manifest (
  media_id    TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  public_id   TEXT NOT NULL,
  local_path  TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256      TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);

-- ─── Provider storage metrics cache ─────────────────────────────────────────
-- Readings from Cloudflare's GraphQL Analytics API. Cached so the budget can be
-- evaluated without calling Cloudflare on every upload, and so staleness is
-- explicit rather than assumed.
--
-- These columns hold a POINT-IN-TIME measurement of bytes in the bucket. They
-- are NOT billable GB-month, which is an integral over time and is not derived
-- or stored anywhere in this schema.

CREATE TABLE IF NOT EXISTS storage_metrics (
  id                   BIGSERIAL PRIMARY KEY,
  bucket               TEXT NOT NULL,
  payload_size_bytes   BIGINT NOT NULL,
  metadata_size_bytes  BIGINT NOT NULL DEFAULT 0,
  object_count         BIGINT,
  pending_upload_count BIGINT,
  -- When Cloudflare measured it, which is not when we fetched it.
  measured_at          TIMESTAMPTZ NOT NULL,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_metrics_recent_idx ON storage_metrics (measured_at DESC);

CREATE INDEX IF NOT EXISTS media_owner_recent_idx ON media (owner_id, uploaded_at DESC);

-- ─── Collections (modelled now, unused in v1) ───────────────────────────────
-- Created up front so adding "Best Eliminations" later is a feature, not a
-- schema migration against a populated media table.

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  visibility  media_visibility NOT NULL DEFAULT 'private',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, slug)
);

CREATE TABLE IF NOT EXISTS collection_media (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  media_id      TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, media_id)
);

-- ─── Featured / favourites ──────────────────────────────────────────────────

ALTER TABLE media ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ─── Usage accounting ───────────────────────────────────────────────────────
-- Monthly upload totals, so the API can refuse uploads past a configured quota.
-- This is the cost safeguard: without it a runaway loop could upload unbounded
-- data before anyone noticed.

CREATE TABLE IF NOT EXISTS usage_months (
  owner_id       TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  month          TEXT NOT NULL,           -- 'YYYY-MM'
  uploaded_bytes BIGINT NOT NULL DEFAULT 0,
  upload_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, month)
);

-- ─── Structured event log ───────────────────────────────────────────────────
-- Observability without leaking secrets: this table records what happened, and
-- deliberately has no column for tokens, passwords, or signed URLs.

CREATE TABLE IF NOT EXISTS media_events (
  id         BIGSERIAL PRIMARY KEY,
  media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  owner_id   TEXT,
  event      TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_events_recent_idx ON media_events (created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('001_media_init')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
