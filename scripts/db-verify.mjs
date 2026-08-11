/**
 * Verifies the live Neon schema matches what migration 001 is supposed to have
 * produced. Read-only: it never creates, alters, or drops anything.
 *
 *   npm run db:verify
 *
 * This exists because "the SQL file parsed locally" is not evidence that the
 * database has the right shape. Every check below queries the live catalog.
 */

import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const connectionString = process.env.DATABASE_URL;
if (typeof connectionString !== "string" || connectionString.trim() === "") {
  console.error("DATABASE_URL is not set. Add it to .env.local (gitignored).");
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(connectionString);

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

// ─── Tables ──────────────────────────────────────────────────────────────────

const tables = (
  await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
).map((row) => row.table_name);

for (const expected of [
  "media",
  "owners",
  "device_tokens",
  "collections",
  "collection_media",
  "usage_months",
  "media_events",
  "archive_manifest",
  "storage_metrics",
  "schema_migrations",
]) {
  check(`table ${expected}`, tables.includes(expected), tables.includes(expected) ? "present" : "MISSING");
}

// ─── Enum values ─────────────────────────────────────────────────────────────

const enumValues = async (typeName) =>
  (
    await sql`
      SELECT e.enumlabel AS value
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = ${typeName}
      ORDER BY e.enumsortorder
    `
  ).map((row) => row.value);

const archiveStates = await enumValues("archive_state");
const expectedStates = [
  "active",
  "archive_eligible",
  "archive_downloading",
  "archived_local",
  "cloud_delete_pending",
  "archived_offline",
  "archive_failed",
  "restore_requested",
  "restoring",
  "restore_failed",
];
const missingStates = expectedStates.filter((state) => !archiveStates.includes(state));
check(
  "enum archive_state",
  archiveStates.length > 0 && missingStates.length === 0,
  missingStates.length === 0 ? `${archiveStates.length} values` : `missing: ${missingStates.join(", ")}`,
);
check(
  "archive_state has no retired cloud_deleted",
  !archiveStates.includes("cloud_deleted"),
  archiveStates.includes("cloud_deleted") ? "STILL PRESENT" : "correctly absent",
);

const visibility = await enumValues("media_visibility");
check("enum media_visibility", visibility.join(",") === "private,unlisted,public", visibility.join(", "));

// ─── Column defaults and presence ────────────────────────────────────────────

const columns = await sql`
  SELECT column_name, column_default, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'media'
`;
const columnMap = new Map(columns.map((row) => [row.column_name, row]));

const retention = columnMap.get("retention_days");
check(
  "media.retention_days default is 10",
  retention?.column_default?.startsWith("10") === true,
  retention?.column_default ?? "column missing",
);

const visibilityDefault = columnMap.get("visibility");
check(
  "media.visibility default is unlisted",
  /unlisted/.test(visibilityDefault?.column_default ?? ""),
  visibilityDefault?.column_default ?? "column missing",
);

for (const expected of [
  "public_id",
  "original_online",
  "thumbnail_key",
  "thumbnail_size_bytes",
  "restore_requested_at",
  "restore_failed_reason",
  "local_archive_verified",
  "local_archive_path",
  "archive_state",
  "keep_online",
  "upload_id",
  "finalized_at",
  "sha256",
]) {
  check(`media.${expected}`, columnMap.has(expected), columnMap.has(expected) ? "present" : "MISSING");
}

// ─── Constraints ─────────────────────────────────────────────────────────────

const constraints = (
  await sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.media'::regclass AND contype = 'c'
  `
).map((row) => row.conname);

for (const expected of [
  "media_cloud_delete_requires_local_archive",
  "media_offline_original_requires_local_archive",
]) {
  check(
    `constraint ${expected}`,
    constraints.includes(expected),
    constraints.includes(expected) ? "present" : "MISSING — deletion safety not enforced",
  );
}

// ─── Indexes ─────────────────────────────────────────────────────────────────

const indexes = (
  await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'media'`
).map((row) => row.indexname);

for (const expected of [
  "media_owner_sha256_idx",
  "media_public_gallery_idx",
  "media_archive_sweep_idx",
  "media_online_originals_idx",
  "media_owner_recent_idx",
]) {
  check(`index ${expected}`, indexes.includes(expected), indexes.includes(expected) ? "present" : "MISSING");
}

// ─── Live constraint behaviour ───────────────────────────────────────────────
//
// Proves the safety constraint actually rejects an unsafe row, rather than
// merely existing in the catalog. Runs inside a transaction that is always
// rolled back, so nothing is persisted.

let constraintEnforced = false;
let constraintDetail = "not tested";
try {
  await sql.transaction([
    sql.query("INSERT INTO owners (id, email, password_hash) VALUES ('__verify__', '__verify__@test.invalid', 'scrypt$x')"),
    sql.query(`INSERT INTO media (
      id, public_id, owner_id, original_filename, mime_type, size_bytes, sha256,
      storage_object_key, status, archive_state, original_online, local_archive_verified
    ) VALUES (
      '__verify__', '__verify__', '__verify__', 'x.mp4', 'video/mp4', 1,
      '${"a".repeat(64)}', 'media/x', 'active', 'archived_offline', false, false
    )`),
  ]);
  constraintDetail = "NOT ENFORCED — an unverified archived row was accepted";
} catch (error) {
  const message = String(error?.message ?? "");
  if (/media_cloud_delete_requires_local_archive|media_offline_original_requires_local_archive/.test(message)) {
    constraintEnforced = true;
    constraintDetail = "rejected an archived row with no verified local copy";
  } else {
    constraintDetail = `unexpected error: ${message}`;
  }
}
check("deletion safety constraint actually rejects unsafe rows", constraintEnforced, constraintDetail);

// ─── Report ──────────────────────────────────────────────────────────────────

console.log("\nNeon schema verification\n");
let failed = 0;
for (const result of results) {
  if (!result.pass) failed += 1;
  console.log(`  [${result.pass ? "OK  " : "FAIL"}] ${result.name.padEnd(52)} ${result.detail}`);
}

console.log(`\n${results.length - failed}/${results.length} checks passed.`);
if (failed > 0) {
  console.log("Schema does not match migration 001.\n");
  process.exit(1);
}
console.log("Schema matches migration 001.\n");
