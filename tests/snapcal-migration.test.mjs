/**
 * Sanity checks on db/migrations/002_snapcal_init.sql itself — parses the
 * file with the real migration-runner splitter (proving it is syntactically
 * well-formed at the tokenizer level: balanced dollar-quoted blocks,
 * quoted strings, comments) and asserts the statements that must exist,
 * mirroring the intent of db-verify.mjs without needing a live Neon
 * connection (no test in this repo hits live Postgres — see
 * tests/api-auth-and-upload-routes.test.mjs's header comment for why).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements, withoutTransactionControls } from "../scripts/sql-statements.mjs";

const migrationPath = join(process.cwd(), "db", "migrations", "002_snapcal_init.sql");
const source = readFileSync(migrationPath, "utf8");
const statements = withoutTransactionControls(splitSqlStatements(source));

test("002_snapcal_init.sql parses into a well-formed statement batch", () => {
  assert.ok(statements.length > 5, "expected multiple DDL statements");
  // No leftover BEGIN/COMMIT — the migration runner owns the transaction.
  for (const statement of statements) {
    assert.doesNotMatch(statement.trim(), /^(BEGIN|COMMIT)$/i);
  }
});

test("creates snapcal_calendars with owner scoping", () => {
  assert.ok(statements.some((s) => /CREATE TABLE IF NOT EXISTS snapcal_calendars/.test(s)));
  assert.ok(statements.some((s) => /snapcal_calendars.*REFERENCES owners\(id\)/s.test(s)));
});

test("creates the shared revision sequence before it is referenced", () => {
  const seqIndex = statements.findIndex((s) => /CREATE SEQUENCE IF NOT EXISTS snapcal_revision_seq/.test(s));
  const eventsIndex = statements.findIndex((s) => /CREATE TABLE IF NOT EXISTS snapcal_events/.test(s));
  assert.notEqual(seqIndex, -1);
  assert.notEqual(eventsIndex, -1);
  assert.ok(seqIndex < eventsIndex, "the sequence must be created before the events table that will use it");
});

test("creates snapcal_events with the required sync/tombstone/idempotency columns", () => {
  const eventsStatement = statements.find((s) => /CREATE TABLE IF NOT EXISTS snapcal_events/.test(s));
  assert.ok(eventsStatement);
  for (const column of [
    "id",
    "calendar_id",
    "owner_id",
    "title",
    "description",
    "location",
    "start_at",
    "end_at",
    "all_day",
    "timezone",
    "category_id",
    "reminder_offset_minutes",
    "recurrence_frequency",
    "recurrence_interval",
    "recurrence_until_date",
    "recurrence_occurrence_count",
    "client_mutation_id",
    "revision",
    "deleted_at",
    "created_at",
    "updated_at",
  ]) {
    assert.ok(eventsStatement.includes(column), `snapcal_events is missing column: ${column}`);
  }
  assert.match(eventsStatement, /CHECK \(end_at >= start_at\)/);
});

test("indexes the incremental-sync query path (calendar_id, revision)", () => {
  assert.ok(
    statements.some((s) => /CREATE INDEX IF NOT EXISTS snapcal_events_calendar_revision_idx\s+ON snapcal_events \(calendar_id, revision\)/.test(s)),
  );
});

test("enforces idempotent create via a partial unique index on client_mutation_id", () => {
  const indexStatement = statements.find((s) => /snapcal_events_client_mutation_idx/.test(s));
  assert.ok(indexStatement);
  assert.match(indexStatement, /UNIQUE INDEX/);
  assert.match(indexStatement, /WHERE client_mutation_id IS NOT NULL/);
});

test("records the migration version exactly once, at the end", () => {
  const versionInserts = statements.filter((s) => /INSERT INTO schema_migrations/.test(s));
  assert.equal(versionInserts.length, 1);
  assert.match(versionInserts[0], /'002_snapcal_init'/);
  assert.equal(statements.indexOf(versionInserts[0]), statements.length - 1, "version insert must be the final statement");
});
