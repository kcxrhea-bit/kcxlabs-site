-- 003_snapcal_pairing.sql — QR / short-code device pairing sessions
--
-- Target: Postgres 15+ (Neon). Apply with `npm run db:migrate`.
--
-- Additive only: no existing table, column, or semantics from 001/002 change.
-- A pairing session is a short-lived, single-use bridge between a logged-in
-- browser (which creates it) and an unpaired Android device (which redeems
-- it) that ends in the SAME device_tokens row `POST /api/auth/pair` already
-- creates — there is no second, parallel credential system.
--
-- Design notes:
--   * secret_hash is SHA-256 of the high-entropy QR secret (never stored
--     raw), mirroring how device_tokens.token_hash already works.
--   * code_hash is SHA-256 of the normalized human-friendly short code.
--     Because this is a single-owner system, the redemption endpoint scans
--     the small set of that owner's live (unexpired, unredeemed) sessions
--     and does a constant-time compare against each one's code_hash rather
--     than looking the code up by an indexed exact hash match — this makes
--     attempt_count a real per-session brute-force counter instead of a
--     counter an attacker can dodge by targeting a different session per
--     guess.
--   * redeemed_at IS NULL is the single-use gate; redemption is a
--     compare-and-set UPDATE (see server/snapcal-api/_lib/pairing.ts) so two
--     concurrent redemption attempts cannot both succeed.

BEGIN;

CREATE TABLE IF NOT EXISTS snapcal_pairing_sessions (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,

  -- SHA-256 of the QR secret / SHA-256 of the normalized short code. Neither
  -- raw value is ever persisted.
  secret_hash     TEXT UNIQUE NOT NULL,
  code_hash       TEXT NOT NULL,

  -- Failed short-code redemption attempts against THIS session. The
  -- redemption endpoint treats a session at or past the limit as invalid,
  -- same as an expired one.
  attempt_count   INTEGER NOT NULL DEFAULT 0,

  -- Set at successful redemption, alongside redeemed_at, in the same CAS
  -- update. Lets the browser's status poll report which device connected.
  device_token_id TEXT REFERENCES device_tokens(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  redeemed_at     TIMESTAMPTZ
);

-- Drives both the owner-scoped active-session scan used by short-code
-- redemption and the browser's status poll.
CREATE INDEX IF NOT EXISTS snapcal_pairing_sessions_owner_idx
  ON snapcal_pairing_sessions (owner_id, expires_at)
  WHERE redeemed_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('003_snapcal_pairing')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
