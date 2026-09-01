-- Durable event lifecycle shared by SnapCal Web, Desktop, and Android.
-- Existing rows remain scheduled; clients change status only through explicit user actions.
BEGIN;

ALTER TABLE snapcal_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SCHEDULED';

ALTER TABLE snapcal_events
  DROP CONSTRAINT IF EXISTS snapcal_events_status_check;

ALTER TABLE snapcal_events
  ADD CONSTRAINT snapcal_events_status_check
  CHECK (status IN ('SCHEDULED', 'COMPLETED', 'MISSED', 'DISMISSED', 'CANCELLED'));

INSERT INTO schema_migrations (version) VALUES ('004_snapcal_event_status')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
