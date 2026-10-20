/**
 * Camera Archive deletion workflow against a REAL PostgreSQL server.
 *
 * Opt-in, and refuses anything but a local database:
 *   KCX_CAMERA_PG_URL  postgres://user:pass@127.0.0.1:<port>/<db>  (localhost only — never Neon/production)
 *   KCX_PG_DRIVER      directory containing the `postgres` (postgres.js) package
 * Without both, every test here is skipped, so the default suite needs no database.
 *
 * WARNING: the target database's `public` schema is dropped and rebuilt.
 *
 * What is real: Postgres, every migration file, and the exact compiled
 * `cameraRepository` SQL (dist-electron/api-db.cjs) — row locks, SKIP LOCKED,
 * READ COMMITTED re-checks, advisory locks, CHECK constraints, now()-based
 * expiry. What is mocked: R2 (tests/helpers/camera-r2-mock.mjs).
 *
 * KCX_CAMERA_DB_DRIVER selects how the repository reaches Postgres:
 *   postgres-js (default)  postgres.js connection pool
 *   neon-http              the REAL production `neon()` HTTP driver from
 *                          api-db.cjs; only its HTTPS hop is served locally by
 *                          tests/helpers/neon-http-shim.mjs (needs `pg` in KCX_PG_DRIVER)
 * Setup and assertions always use postgres.js directly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { splitSqlStatements, withoutTransactionControls } from "../scripts/sql-statements.mjs";
import { mockOperations } from "./helpers/camera-r2-mock.mjs";
import { installNeonHttpShim } from "./helpers/neon-http-shim.mjs";

const PG_URL = process.env.KCX_CAMERA_PG_URL ?? "";
const DRIVER_DIR = process.env.KCX_PG_DRIVER ?? "";
const LOCAL_ONLY = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]+$/;
const enabled = LOCAL_ONLY.test(PG_URL) && DRIVER_DIR !== "";
const pgTest = enabled ? test : (name, ...rest) => test(name, { skip: "set KCX_CAMERA_PG_URL (localhost only) and KCX_PG_DRIVER" }, () => {});

const MB = 1_000_000;
const BUDGET = 100 * MB;
const OWNER = "owner_kcx";
const migrationsDir = fileURLToPath(new URL("../db/migrations/", import.meta.url));

const DB_DRIVER = process.env.KCX_CAMERA_DB_DRIVER ?? "postgres-js";

let sql;
let repo;
let core;
let neonShim = null;

/** postgres.js already speaks the tagged-template shape `cameraRepository` expects; add Neon's `transaction(fn)`. */
function asDb(client) {
  const db = (strings, ...values) => client(strings, ...values);
  db.transaction = (fn) => client.begin((tx) => fn(tx));
  return db;
}

async function applyMigration(file) {
  const statements = withoutTransactionControls(splitSqlStatements(readFileSync(join(migrationsDir, file), "utf8")));
  await sql.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement);
  });
}

const migrationFiles = () => readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

async function insertActive(id, { sizeMB = 10, minute = 0, isProtected = false } = {}) {
  const start = new Date(Date.UTC(2026, 6, 15, 17, minute)).toISOString();
  const end = new Date(Date.UTC(2026, 6, 15, 17, minute, 30)).toISOString();
  await sql`
    INSERT INTO camera_recordings (id, recording_id, owner_id, camera, camera_name, storage_object_key, mime_type,
      size_bytes, reserved_bytes, sha256, recorded_start_at, recorded_end_at, protected, status, finalized_at)
    VALUES (${id}, ${"rec-" + id}, ${OWNER}, 'living-room', 'Living Room', ${`camera/living-room/${id}.mp4`}, 'video/mp4',
      ${sizeMB * MB}, 0, ${"0".repeat(64)}, ${start}, ${end}, ${isProtected}, 'active', now())
  `;
}

function reserveInput(id, sizeMB) {
  return {
    id, recordingId: "rec-" + id, ownerId: OWNER, camera: "living-room", cameraName: "Living Room",
    storageObjectKey: `camera/living-room/${id}.mp4`, mimeType: "video/mp4", sizeBytes: sizeMB * MB,
    sha256: "a".repeat(64), width: null, height: null, codec: null,
    recordedStartAt: "2026-07-15T18:00:00.000Z", recordedEndAt: "2026-07-15T18:01:00.000Z",
    durationSeconds: 60, budgetBytes: BUDGET,
  };
}

const statusOf = async (id) => (await sql`SELECT status FROM camera_recordings WHERE id = ${id}`)[0]?.status;

function createStore(objects = new Set()) {
  const deletes = [];
  const failNext = { count: 0 };
  return { store: core.cameraObjectStore("kcxlabs-camera", mockOperations({ objects, deletes, failNext })), objects, deletes, failNext };
}

test.before(async () => {
  if (!enabled) return;
  const require = createRequire(join(DRIVER_DIR, "noop.js"));
  const postgres = require("postgres");
  sql = postgres(PG_URL, { max: 12, onnotice: () => {}, idle_timeout: 5 });
  core = await import("../dist-electron/api-core.cjs");
  const { cameraRepository, createDb } = await import("../dist-electron/api-db.cjs");
  if (DB_DRIVER === "neon-http") {
    neonShim = installNeonHttpShim({ connectionString: PG_URL, driverDir: DRIVER_DIR });
    repo = cameraRepository(createDb({ connectionString: PG_URL })); // production code path, unmodified
  } else {
    repo = cameraRepository(asDb(sql));
  }

  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  for (const file of migrationFiles()) await applyMigration(file);
});

test.after(async () => {
  if (neonShim) await neonShim.uninstall();
  if (sql) await sql.end({ timeout: 5 });
});

test.beforeEach(async () => {
  if (!enabled) return;
  await sql`TRUNCATE camera_recordings`;
  await sql`DELETE FROM app_settings`;
});

// ─── Migrations ─────────────────────────────────────────────────────────────

pgTest("migrations 001-006 apply in order, and re-running 005 and 006 is a no-op", async () => {
  assert.deepEqual(migrationFiles().slice(-2), ["005_camera_archive.sql", "006_camera_deletion_safety.sql"]);
  const shape = async () => (await sql`
    SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_name = 'camera_recordings')::int AS columns,
      (SELECT count(*) FROM pg_constraint WHERE conrelid = 'camera_recordings'::regclass)::int AS constraints,
      (SELECT count(*) FROM pg_indexes WHERE tablename = 'camera_recordings')::int AS indexes
  `)[0];
  const before = await shape();
  await applyMigration("005_camera_archive.sql");
  await applyMigration("006_camera_deletion_safety.sql");
  await applyMigration("006_camera_deletion_safety.sql");
  assert.deepEqual(await shape(), before);
  const statuses = (await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'camera_recordings_status_check'`)[0].def;
  assert.match(statuses, /pending_delete/);
});

pgTest("the database itself rejects a protected row in pending_delete", async () => {
  await insertActive("p1", { isProtected: true });
  await assert.rejects(sql`UPDATE camera_recordings SET status = 'pending_delete' WHERE id = 'p1'`, /camera_recordings_pending_unprotected_check/);
});

// ─── Rotation ───────────────────────────────────────────────────────────────

pgTest("rotation claims the oldest unprotected rows, deletes their objects, then retires them", async () => {
  const objects = new Set();
  for (let i = 0; i < 10; i++) {
    await insertActive(`a${i}`, { minute: i, isProtected: i === 0 });
    objects.add(`camera/living-room/a${i}.mp4`);
  }
  const { store, deletes } = createStore(objects);
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 25 * MB, budgetBytes: BUDGET });
  // Selection is oldest-first; RETURNING order is unspecified, so compare as sets.
  assert.deepEqual([...outcome.deletedIds].sort(), ["a1", "a2", "a3"], "a0 is protected and skipped");
  assert.deepEqual([...deletes].sort(), ["camera/living-room/a1.mp4", "camera/living-room/a2.mp4", "camera/living-room/a3.mp4"]);
  assert.equal(await statusOf("a0"), "active");
  assert.equal(await statusOf("a1"), "deleted");
  const usage = await repo.usage();
  assert.equal(usage.unprotectedBytes + usage.protectedBytes, 70 * MB);
  assert.equal(usage.pendingDeleteBytes, 0);
});

pgTest("protected recordings blocking the shortfall: nothing is claimed and the reservation is refused", async () => {
  await insertActive("p1", { sizeMB: 60, isProtected: true });
  await insertActive("u1", { sizeMB: 30, minute: 1 });
  const claimed = await repo.claimForRotation({ incomingBytes: 50 * MB, budgetBytes: BUDGET });
  assert.deepEqual(claimed, []);
  assert.equal(await repo.reserve(reserveInput("n1", 50)), null);
});

pgTest("pending-deletion bytes stay counted: unconfirmed space is not handed out", async () => {
  for (let i = 0; i < 10; i++) await insertActive(`a${i}`, { minute: i });
  const claimed = await repo.claimForRotation({ incomingBytes: 10 * MB, budgetBytes: BUDGET });
  assert.equal(claimed.length, 1);
  const usage = await repo.usage();
  assert.equal(usage.pendingDeleteBytes, 10 * MB);
  assert.equal(await repo.reserve(reserveInput("n1", 10)), null);
  assert.equal(await repo.confirmDeleted(claimed[0].id), true);
  assert.ok(await repo.reserve(reserveInput("n1", 10)));
});

pgTest("a protect committed while rotation is blocked on the row lock is honored (READ COMMITTED re-check)", async () => {
  for (let i = 0; i < 10; i++) await insertActive(`a${i}`, { minute: i });
  let claim;
  await sql.begin(async (tx) => {
    await tx`UPDATE camera_recordings SET protected = TRUE WHERE id = 'a0'`;
    claim = repo.claimForRotation({ incomingBytes: 10 * MB, budgetBytes: BUDGET }); // blocks on a0's row lock
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  const claimed = await claim;
  assert.ok(!claimed.some((c) => c.id === "a0"), "the now-protected row must not be claimed");
  assert.equal(await statusOf("a0"), "active");
});

pgTest("concurrent rotation claims never claim a row twice and never over-rotate", async () => {
  for (let i = 0; i < 10; i++) await insertActive(`a${i}`, { minute: i });
  const results = await Promise.all(Array.from({ length: 6 }, () => repo.claimForRotation({ incomingBytes: 10 * MB, budgetBytes: BUDGET })));
  const ids = results.flat().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate claims");
  assert.ok(ids.length >= 1 && ids.length <= 2, `claimed ${ids.length} rows for a 10 MB shortfall`);
});

// ─── Concurrent reservations ────────────────────────────────────────────────

pgTest("concurrent reservations never exceed the budget", async () => {
  const batchesBefore = neonShim?.stats.batches ?? 0;
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.reserve(reserveInput(`r${i}`, 30))));
  const granted = results.filter(Boolean).length;
  const usage = await repo.usage();
  assert.equal(granted, 3, `granted ${granted} × 30 MB against a 100 MB budget`);
  assert.ok(usage.reservedBytes <= BUDGET);
  if (neonShim) assert.equal(neonShim.stats.batches - batchesBefore, 12, "each reserve() is one Neon HTTP transaction batch");
});

pgTest("reserve() returns a fully mapped row through the driver (types parsed, not raw text)", async () => {
  const row = await repo.reserve(reserveInput("m1", 12));
  assert.equal(row.status, "reserved");
  assert.equal(row.reservedBytes, 12 * MB);
  assert.equal(typeof row.reservedBytes, "number");
  assert.equal(row.protected, false);
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

// ─── Expired reservations ───────────────────────────────────────────────────

pgTest("an expired reservation moves to pending_delete with its reserved size; finalize and URL re-issue then fail", async () => {
  await repo.reserve(reserveInput("old", 40));
  await repo.reserve(reserveInput("fresh", 10));
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '61 minutes' WHERE id = 'old'`;

  const claimed = await repo.claimStaleReservations({ ttlMinutes: core.RESERVATION_TTL_MINUTES, limit: 10 });
  assert.deepEqual(claimed.map((c) => [c.id, c.sizeBytes]), [["old", 40 * MB]]);
  const row = (await sql`SELECT status, size_bytes, reserved_bytes, delete_reason FROM camera_recordings WHERE id = 'old'`)[0];
  assert.deepEqual({ ...row, size_bytes: Number(row.size_bytes), reserved_bytes: Number(row.reserved_bytes) },
    { status: "pending_delete", size_bytes: 40 * MB, reserved_bytes: 0, delete_reason: "expired_reservation" });
  assert.equal((await repo.usage()).pendingDeleteBytes, 40 * MB);

  assert.equal(await repo.markActive({ id: "old", actualSizeBytes: 40 * MB }), null);
  assert.equal(await repo.touchReservation("old"), null);
  assert.equal(await statusOf("fresh"), "reserved");
});

pgTest("after an expired reservation is confirmed deleted, the same recording can reserve again (live-only uniqueness)", async () => {
  await repo.reserve(reserveInput("x1", 10));
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '2 hours' WHERE id = 'x1'`;
  const { store } = createStore();
  await core.reconcileCameraStorage(repo, store);
  assert.equal(await statusOf("x1"), "deleted");
  const again = await repo.reserve({ ...reserveInput("x2", 10), recordingId: "rec-x1" });
  assert.ok(again);
  await assert.rejects(repo.reserve({ ...reserveInput("x3", 10), recordingId: "rec-x1" }), /camera_recordings_recording_id_live_idx/);
});

pgTest("touching a reservation restarts its TTL", async () => {
  await repo.reserve(reserveInput("t1", 10));
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '59 minutes' WHERE id = 't1'`;
  assert.ok(await repo.touchReservation("t1"));
  await sql`UPDATE camera_recordings SET created_at = now() - interval '3 hours' WHERE id = 't1'`;
  assert.deepEqual(await repo.claimStaleReservations({ ttlMinutes: core.RESERVATION_TTL_MINUTES, limit: 10 }), []);
});

// ─── Retry eligibility and backoff ──────────────────────────────────────────

pgTest("retry leasing honors backoff, increments attempts, stops at the limit, and SKIP LOCKED never double-leases", async () => {
  for (let i = 0; i < 3; i++) await insertActive(`a${i}`, { minute: i });
  await sql`UPDATE camera_recordings SET status = 'pending_delete', delete_reason = 'rotation', delete_requested_at = now(), delete_attempts = 1, last_delete_attempt_at = now()`;

  assert.deepEqual(await repo.leasePendingDeletions({ limit: 10, maxAttempts: 8 }), [], "inside the 60 s backoff after attempt 1");

  await sql`UPDATE camera_recordings SET last_delete_attempt_at = now() - interval '61 seconds'`;
  const [first, second] = await Promise.all([
    repo.leasePendingDeletions({ limit: 10, maxAttempts: 8 }),
    repo.leasePendingDeletions({ limit: 10, maxAttempts: 8 }),
  ]);
  assert.equal(first.length + second.length, 3, "each row leased exactly once across concurrent sweeps");
  const attempts = (await sql`SELECT delete_attempts FROM camera_recordings ORDER BY id`).map((r) => r.delete_attempts);
  assert.deepEqual(attempts, [2, 2, 2]);

  // Attempt 2 → 120 s backoff.
  await sql`UPDATE camera_recordings SET last_delete_attempt_at = now() - interval '90 seconds'`;
  assert.deepEqual(await repo.leasePendingDeletions({ limit: 10, maxAttempts: 8 }), []);

  await sql`UPDATE camera_recordings SET delete_attempts = 8, last_delete_attempt_at = now() - interval '1 day'`;
  assert.deepEqual(await repo.leasePendingDeletions({ limit: 10, maxAttempts: 8 }), [], "rows at the attempt limit stay pending for manual review");
  assert.equal((await repo.usage()).pendingDeleteBytes, 30 * MB);
});

pgTest("a row locked by another session is skipped by leasing, not waited on", async () => {
  for (let i = 0; i < 2; i++) await insertActive(`a${i}`, { minute: i });
  await sql`UPDATE camera_recordings SET status = 'pending_delete', delete_requested_at = now(), delete_attempts = 1, last_delete_attempt_at = now() - interval '1 hour'`;
  let leased;
  await sql.begin(async (tx) => {
    await tx`SELECT id FROM camera_recordings WHERE id = 'a0' FOR UPDATE`;
    const started = Date.now();
    leased = await repo.leasePendingDeletions({ limit: 10, maxAttempts: 8 });
    assert.ok(Date.now() - started < 2000, "did not block on the locked row");
  });
  assert.deepEqual(leased.map((c) => c.id), ["a1"]);
});

// ─── Recovery after interrupted operations ──────────────────────────────────

pgTest("a transaction that dies after claiming rolls back: rows stay active with nothing lost", async () => {
  for (let i = 0; i < 10; i++) await insertActive(`a${i}`, { minute: i });
  await assert.rejects(
    sql.begin(async (tx) => {
      const txRepo = (await import("../dist-electron/api-db.cjs")).cameraRepository(asDb(tx));
      const claimed = await txRepo.claimForRotation({ incomingBytes: 10 * MB, budgetBytes: BUDGET });
      assert.equal(claimed.length, 1);
      throw new Error("simulated crash before commit");
    }),
    /simulated crash/,
  );
  assert.equal(await statusOf("a0"), "active");
  assert.equal((await repo.usage()).pendingDeleteBytes, 0);
});

pgTest("DB confirm failing after a successful R2 delete leaves the row pending; the next sweep re-deletes idempotently and confirms", async () => {
  await insertActive("a0", { sizeMB: 50 });
  const { store, objects, deletes } = createStore(new Set(["camera/living-room/a0.mp4"]));
  let failConfirm = true;
  const flaky = { ...repo, confirmDeleted: async (id) => { if (failConfirm) { failConfirm = false; throw new Error("connection reset"); } return repo.confirmDeleted(id); } };

  const first = await core.rotateForSpace(flaky, store, { incomingBytes: 60 * MB, budgetBytes: BUDGET });
  assert.deepEqual(first.unconfirmedIds, ["a0"]);
  assert.ok(!objects.has("camera/living-room/a0.mp4"));
  assert.equal(await statusOf("a0"), "pending_delete");
  assert.equal((await repo.usage()).pendingDeleteBytes, 50 * MB);

  await sql`UPDATE camera_recordings SET last_delete_attempt_at = now() - interval '1 hour'`;
  const retry = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(retry.deletedIds, ["a0"]);
  assert.equal(deletes.length, 2);
  assert.equal(await statusOf("a0"), "deleted");
});

// ─── Late uploads and the orphan sweep ──────────────────────────────────────

pgTest("late upload: an expired reservation's object that landed after deletion is removed once the grace period passes", async () => {
  await repo.reserve(reserveInput("late", 10));
  await repo.reserve(reserveInput("recent", 10));
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '2 hours'`;
  const { store, objects } = createStore();
  await core.reconcileCameraStorage(repo, store);
  objects.add("camera/living-room/late.mp4");   // PUT landed after cleanup
  objects.add("camera/living-room/recent.mp4");
  await sql`UPDATE camera_recordings SET deleted_at = now() - interval '7 hours' WHERE id = 'late'`;

  const outcome = await core.checkLateUploads(repo, store);
  assert.deepEqual(outcome, { checked: 1, orphansDeleted: 1, failed: 0 });
  assert.ok(!objects.has("camera/living-room/late.mp4"));
  assert.ok(objects.has("camera/living-room/recent.mp4"), "still inside its grace period");
  assert.deepEqual(await core.checkLateUploads(repo, store), { checked: 0, orphansDeleted: 0, failed: 0 }, "checked once");
});

pgTest("late upload check never deletes an object a live (active or protected) row still references", async () => {
  await repo.reserve(reserveInput("gone", 10));
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '2 hours'`;
  const { store, objects, deletes } = createStore();
  await core.reconcileCameraStorage(repo, store);
  await sql`UPDATE camera_recordings SET deleted_at = now() - interval '7 hours' WHERE id = 'gone'`;
  // Pathological: a protected, active row shares the same key.
  await insertActive("keeper", { isProtected: true });
  await sql`UPDATE camera_recordings SET storage_object_key = 'camera/living-room/gone.mp4' WHERE id = 'keeper'`;
  objects.add("camera/living-room/gone.mp4");
  deletes.length = 0;

  const outcome = await core.checkLateUploads(repo, store);
  assert.deepEqual(outcome, { checked: 1, orphansDeleted: 0, failed: 0 });
  assert.deepEqual(deletes, []);
  assert.ok(objects.has("camera/living-room/gone.mp4"));
});

pgTest("cleanup stops starting new work at its time budget, reports truncation, and still releases its lock", async () => {
  for (let i = 0; i < 30; i++) await repo.reserve({ ...reserveInput(`t${i}`, 1), budgetBytes: 10_000 * MB });
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '2 hours'`;
  const { store } = createStore();
  let t = 0;
  const clock = () => t;
  const reconcileStore = { ...store, deleteObject: async (key) => { t += 30_000; return store.deleteObject(key); } }; // each delete "takes" 30 s
  const summary = await core.runScheduledCleanup(repo, reconcileStore, { holder: "slow", sweep: true, clock, timeBudgetMs: 45_000 });
  assert.equal(summary.truncated, true);
  assert.equal(summary.deleted, 10, "the in-flight batch finishes; no further pass starts");
  assert.equal(summary.sweep, null);
  assert.equal((await sql`SELECT count(*)::int AS n FROM app_settings WHERE key = 'camera_cleanup_lock'`)[0].n, 0);
});

pgTest("cleanup health surfaces pending and stuck deletions and the last run's counts", async () => {
  for (let i = 0; i < 3; i++) await insertActive(`a${i}`, { minute: i });
  await sql`UPDATE camera_recordings SET status = 'pending_delete', delete_requested_at = now(), delete_attempts = 1, last_delete_attempt_at = now() WHERE id IN ('a0', 'a1')`;
  await sql`UPDATE camera_recordings SET delete_attempts = ${core.MAX_DELETE_ATTEMPTS} WHERE id = 'a1'`;
  const { store } = createStore();
  await core.runScheduledCleanup(repo, store, { holder: "h", sweep: false });
  const health = await repo.cleanupHealth({ maxAttempts: core.MAX_DELETE_ATTEMPTS });
  assert.equal(health.pendingDeleteCount, 2);
  assert.equal(health.stuckDeleteCount, 1);
  const last = JSON.parse(health.lastCleanupRun);
  assert.equal(last.ran, true);
  assert.match(last.at, /^\d{4}-/);
  assert.doesNotMatch(health.lastCleanupRun, /camera\/living-room/, "no keys in the persisted summary");
});

pgTest("orphan sweep deletes only old, untracked camera objects — never active, protected, reserved, or recent ones", async () => {
  await insertActive("act", { minute: 1 });
  await insertActive("prot", { minute: 2, isProtected: true });
  await repo.reserve(reserveInput("inflight", 10));
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  const objects = new Map([
    ["camera/living-room/act.mp4", old],
    ["camera/living-room/prot.mp4", old],
    ["camera/living-room/inflight.mp4", old],
    ["camera/living-room/orphan-old.mp4", old],
    ["camera/living-room/orphan-recent.mp4", recent],
    ["releases/app.exe", old],
  ]);
  const { store } = createStore(objects);
  const outcome = await core.sweepOrphanObjects(repo, store);
  assert.equal(outcome.orphansDeleted, 1);
  assert.deepEqual([...objects.keys()].sort(), [
    "camera/living-room/act.mp4", "camera/living-room/inflight.mp4", "camera/living-room/orphan-recent.mp4",
    "camera/living-room/prot.mp4", "releases/app.exe",
  ]);
});

pgTest("orphan sweep is bounded to one page per run and resumes from its persisted cursor", async () => {
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const objects = new Map(Array.from({ length: 150 }, (_, i) => [`camera/living-room/o${String(i).padStart(3, "0")}.mp4`, old]));
  const { store } = createStore(objects);
  const first = await core.sweepOrphanObjects(repo, store);
  assert.deepEqual([first.listed, first.orphansDeleted, first.completedPass], [100, 100, false]);
  assert.equal(await repo.readSweepCursor(), "100");
  // Mock cursors are list offsets; 50 keys remain, now at offsets 0-49.
  await repo.writeSweepCursor(null);
  const second = await core.sweepOrphanObjects(repo, store);
  assert.deepEqual([second.listed, second.completedPass], [50, true]);
  assert.equal(await repo.readSweepCursor(), null);
});

// ─── Scheduled cleanup ──────────────────────────────────────────────────────

pgTest("scheduled cleanup is single-runner: a concurrent run backs off, the lock is released, and a stale lock is reclaimable", async () => {
  const { store } = createStore();
  const [a, b] = await Promise.all([
    core.runScheduledCleanup(repo, store, { holder: "run-a", sweep: false }),
    core.runScheduledCleanup(repo, store, { holder: "run-b", sweep: false }),
  ]);
  assert.deepEqual([a.ran, b.ran].sort(), [false, true]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM app_settings WHERE key = 'camera_cleanup_lock'`)[0].n, 0, "released");

  assert.equal(await repo.tryAcquireCleanupLock({ holder: "crashed", ttlSeconds: 600 }), true);
  assert.equal(await repo.tryAcquireCleanupLock({ holder: "next", ttlSeconds: 600 }), false);
  await sql`UPDATE app_settings SET updated_at = now() - interval '11 minutes' WHERE key = 'camera_cleanup_lock'`;
  assert.equal(await repo.tryAcquireCleanupLock({ holder: "next", ttlSeconds: 600 }), true);
});

pgTest("scheduled cleanup work is bounded per run and never touches active or protected recordings", async () => {
  for (let i = 0; i < 60; i++) await repo.reserve({ ...reserveInput(`s${i}`, 1), budgetBytes: 10_000 * MB });
  await sql`UPDATE camera_recordings SET authorized_at = now() - interval '2 hours'`;
  await insertActive("keep", { minute: 1 });
  await insertActive("keepP", { minute: 2, isProtected: true });
  const { store } = createStore();

  const run1 = await core.runScheduledCleanup(repo, store, { holder: "r1", sweep: false });
  assert.equal(run1.deleted, core.CLEANUP_MAX_PASSES * core.DELETE_BATCH_LIMIT);
  const run2 = await core.runScheduledCleanup(repo, store, { holder: "r2", sweep: false });
  assert.equal(run2.deleted, 10);
  assert.equal(await statusOf("keep"), "active");
  assert.equal(await statusOf("keepP"), "active");
});
