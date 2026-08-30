-- 002_snapcal_init.sql — SnapCal hosted calendar schema
--
-- Target: Postgres 15+ (Neon). Apply with `npm run db:migrate`; never edit a
-- production schema by hand.
--
-- Migrations are append-only ONCE APPLIED: to change something after this
-- file has run against any database, add 003_*.sql instead of editing it.
--
-- Design notes:
--   * Same conventions as 001_media_init.sql: real typed columns (not a JSON
--     blob), enums for closed state sets, CHECK constraints enforcing
--     invariants at the database layer (not only in application code), and
--     app-generated TEXT primary keys rather than serials.
--   * Single owner today ("owner_kcx", see 001's owners table) — every
--     calendar and event still carries owner_id so multi-owner never
--     requires a data migration, matching 001's stated rationale.
--   * `revision` is a monotonic counter from a single shared sequence,
--     assigned on every insert AND every update (including tombstoning a
--     deleted event). Incremental sync pulls
--     `WHERE calendar_id = ? AND revision > ?` — clients never re-download
--     the whole calendar. See docs/snapcal-architecture.md for the full
--     sync/conflict protocol this schema supports.
--   * Deletions are tombstones (`deleted_at` set, row retained with a fresh
--     revision) rather than DELETE, so a client that was offline during a
--     deletion still learns about it on its next incremental pull.
--   * `client_mutation_id` plus the partial unique index below make a
--     retried "create" from the same client a no-op instead of a duplicate
--     event — required for safe retry over an unreliable network.

BEGIN;

-- ─── Calendars ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snapcal_calendars (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#8b5cf6',
  revision    BIGINT NOT NULL,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snapcal_calendars_owner_idx ON snapcal_calendars (owner_id);

-- ─── Shared revision sequence ───────────────────────────────────────────────
-- One sequence spans both calendars and events so a single monotonically
-- increasing cursor value is meaningful across the whole owner's data, not
-- just within one table — a client can persist one `lastRevision` number.

CREATE SEQUENCE IF NOT EXISTS snapcal_revision_seq;

-- ─── Events ─────────────────────────────────────────────────────────────────
-- Mirrors KsnapCalx's existing local CalendarEvent fields (see
-- packages/calendar-core in the KsnapCalx repo) plus the columns incremental
-- sync requires. Category/reminder/recurrence are preserved as plain
-- columns, matching KsnapCalx's own 005_calendar_hardening migration, so the
-- desktop client's existing semantics are not silently discarded when an
-- event round-trips through the hosted API.

CREATE TABLE IF NOT EXISTS snapcal_events (
  id                            TEXT PRIMARY KEY,
  calendar_id                   TEXT NOT NULL REFERENCES snapcal_calendars(id) ON DELETE CASCADE,
  owner_id                      TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,

  title                         TEXT NOT NULL,
  description                   TEXT,
  location                      TEXT,

  start_at                      TIMESTAMPTZ NOT NULL,
  end_at                        TIMESTAMPTZ NOT NULL,
  all_day                       BOOLEAN NOT NULL DEFAULT FALSE,
  -- IANA time zone name the event was authored in (e.g. "America/Chicago").
  -- start_at/end_at are always stored as absolute UTC instants; this column
  -- is what makes the representation timezone-SAFE rather than merely
  -- timezone-aware — a client can always recover the original wall-clock
  -- time the event was created with, not just a UTC instant.
  timezone                      TEXT NOT NULL DEFAULT 'UTC',

  category_id                   TEXT,
  reminder_offset_minutes       INTEGER,
  recurrence_frequency          TEXT,
  recurrence_interval           INTEGER,
  recurrence_until_date         TEXT,
  recurrence_occurrence_count   INTEGER,

  -- Idempotent-retry support: a client generates this once per logical
  -- mutation and resends the same value on retry. NULL for events that
  -- predate this column (e.g. migrated from a client that doesn't send one).
  client_mutation_id            TEXT,

  -- Incremental-sync cursor. Reassigned on every insert and update.
  revision                      BIGINT NOT NULL,

  -- Tombstone: set instead of deleting the row, so a client can learn about
  -- the deletion on its next incremental pull instead of the row silently
  -- disappearing from a query it never re-runs from scratch.
  deleted_at                    TIMESTAMPTZ,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT snapcal_events_end_after_start CHECK (end_at >= start_at)
);

-- Incremental pull: "everything for this calendar past revision N", in
-- revision order, is the one query the whole sync protocol depends on.
CREATE INDEX IF NOT EXISTS snapcal_events_calendar_revision_idx
  ON snapcal_events (calendar_id, revision);

CREATE INDEX IF NOT EXISTS snapcal_events_owner_idx ON snapcal_events (owner_id);

-- Idempotent create: a retried request with the same (calendar, client
-- mutation id) is a no-op, not a duplicate event. Partial index — most rows
-- have no client_mutation_id and must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS snapcal_events_client_mutation_idx
  ON snapcal_events (calendar_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('002_snapcal_init')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
