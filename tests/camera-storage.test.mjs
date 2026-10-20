/**
 * Camera Archive storage safety: crash-recoverable rotation, abandoned-upload
 * cleanup, and the fail-closed camera credential config.
 *
 * No live Postgres or R2. The orchestration in `_lib/camera-storage.ts` runs
 * exactly as compiled, against:
 *  - an in-memory repository that models the state machine the SQL in
 *    `cameraRepository` implements (status transitions, live-budget shortfall,
 *    lease + backoff), with failure injection; and
 *  - a mocked object store that records every delete and can fail on demand.
 * The SQL itself is pinned by source checks at the bottom of this file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fakeRequest, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";
import { mockOperations } from "./helpers/camera-r2-mock.mjs";

const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

process.env.DATABASE_URL ??= "postgresql://test:test@localhost/test";
process.env.R2_ACCOUNT_ID ??= "test-account";
process.env.R2_ACCESS_KEY_ID ??= "test-key-id";
process.env.R2_SECRET_ACCESS_KEY ??= "test-secret";
process.env.R2_BUCKET ??= "test-bucket";
process.env.OWNER_EMAIL ??= "owner@example.test";
process.env.SESSION_SECRET ??= "a".repeat(64);
process.env.OWNER_PASSWORD_HASH ??= "scrypt$placeholder";

let core;
test.before(async () => {
  core = await import("../dist-electron/api-core.cjs");
});

const MB = 1_000_000;
const BUDGET = 100 * MB;
const MINUTE = 60_000;

// ─── In-memory model of cameraRepository's deletion SQL ─────────────────────

function createModel({ now = () => Date.now() } = {}) {
  const rows = new Map();
  const failures = { confirm: 0 };

  const sum = (pred, field = "sizeBytes") => [...rows.values()].filter(pred).reduce((s, r) => s + r[field], 0);
  const lease = (row) => { row.deleteAttempts += 1; row.lastDeleteAttemptAt = now(); };
  const candidate = (r) => ({ id: r.id, storageObjectKey: r.storageObjectKey, sizeBytes: r.sizeBytes });

  const repo = {
    rows,
    failures,
    addActive(id, { sizeBytes = 10 * MB, recordedStartAt, protected: isProtected = false } = {}) {
      rows.set(id, {
        id, status: "active", protected: isProtected, sizeBytes, reservedBytes: 0,
        storageObjectKey: `camera/living-room/${id}.mp4`, recordedStartAt: recordedStartAt ?? id,
        authorizedAt: now(), deleteAttempts: 0, lastDeleteAttemptAt: null, lastDeleteError: null,
      });
    },
    usage() {
      return {
        protectedBytes: sum((r) => r.status === "active" && r.protected),
        unprotectedBytes: sum((r) => r.status === "active" && !r.protected),
        reservedBytes: sum((r) => r.status === "reserved", "reservedBytes"),
        pendingDeleteBytes: sum((r) => r.status === "pending_delete"),
      };
    },
    // Mirrors claimForRotation: shortfall from active + reserved, excluding bytes already pending deletion.
    async claimForRotation({ incomingBytes, budgetBytes }) {
      const committed = sum((r) => r.status === "active") + sum((r) => r.status === "reserved", "reservedBytes");
      const shortfall = committed + incomingBytes - budgetBytes;
      if (shortfall <= 0) return [];
      const unprotected = [...rows.values()]
        .filter((r) => r.status === "active" && !r.protected)
        .sort((a, b) => (a.recordedStartAt < b.recordedStartAt ? -1 : a.recordedStartAt > b.recordedStartAt ? 1 : a.id < b.id ? -1 : 1));
      const total = unprotected.reduce((s, r) => s + r.sizeBytes, 0);
      if (total < shortfall) return [];
      const victims = [];
      let running = 0;
      for (const r of unprotected) {
        if (running >= shortfall) break;
        running += r.sizeBytes;
        victims.push(r);
      }
      for (const r of victims) { r.status = "pending_delete"; r.deleteAttempts = 1; r.lastDeleteAttemptAt = now(); }
      return victims.map(candidate);
    },
    async claimStaleReservations({ ttlMinutes, limit }) {
      const stale = [...rows.values()]
        .filter((r) => r.status === "reserved" && r.authorizedAt < now() - ttlMinutes * MINUTE)
        .sort((a, b) => a.authorizedAt - b.authorizedAt)
        .slice(0, limit);
      for (const r of stale) {
        r.status = "pending_delete"; r.sizeBytes = r.reservedBytes; r.reservedBytes = 0;
        r.deleteAttempts = 1; r.lastDeleteAttemptAt = now();
      }
      return stale.map(candidate);
    },
    async leasePendingDeletions({ limit, maxAttempts }) {
      const due = [...rows.values()]
        .filter((r) => r.status === "pending_delete" && r.deleteAttempts < maxAttempts
          && (r.lastDeleteAttemptAt === null || r.lastDeleteAttemptAt < now() - Math.min(3600, 30 * 2 ** r.deleteAttempts) * 1000))
        .slice(0, limit);
      due.forEach(lease);
      return due.map(candidate);
    },
    async confirmDeleted(id) {
      if (failures.confirm > 0) { failures.confirm -= 1; throw new Error("db connection reset"); }
      const r = rows.get(id);
      if (!r || r.status !== "pending_delete") return false;
      r.status = "deleted";
      return true;
    },
    async recordDeleteFailure(id, code) {
      const r = rows.get(id);
      if (r && r.status === "pending_delete") r.lastDeleteError = code;
    },
    // Mirrors reserve(): active + pending_delete + reserved must fit.
    async reserve({ id, sizeBytes, budgetBytes }) {
      const used = sum((r) => r.status === "active" || r.status === "pending_delete") + sum((r) => r.status === "reserved", "reservedBytes");
      if (used + sizeBytes > budgetBytes) return null;
      rows.set(id, {
        id, status: "reserved", protected: false, sizeBytes: 0, reservedBytes: sizeBytes,
        storageObjectKey: `camera/living-room/${id}.mp4`, recordedStartAt: id, authorizedAt: now(),
        deleteAttempts: 0, lastDeleteAttemptAt: null, lastDeleteError: null,
      });
      return rows.get(id);
    },
    async markActive(id) {
      const r = rows.get(id);
      if (!r || r.status !== "reserved") return null;
      r.status = "active"; r.sizeBytes = r.reservedBytes; r.reservedBytes = 0;
      return r;
    },
    async touchReservation(id) {
      const r = rows.get(id);
      if (!r || r.status !== "reserved") return null;
      r.authorizedAt = now();
      return r;
    },
    async setProtected(id, value) {
      const r = rows.get(id);
      if (!r || r.status !== "active") return null;
      r.protected = value;
      return r;
    },
  };
  return repo;
}

function createStore({ bucket = "kcxlabs-camera" } = {}) {
  const objects = new Set();
  const deletes = [];
  const failNext = { count: 0, name: "NetworkingError" };
  const store = core.cameraObjectStore(bucket, mockOperations({ objects, deletes, failNext }));
  return { store, objects, deletes, failNext };
}

function clock(start = Date.parse("2026-10-20T18:00:00Z")) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// ─── Fix 1: rotation deletes from R2 before retiring rows ───────────────────

test("rotation: oldest unprotected recordings are deleted from R2, then retired; budget drops by exactly their size", async () => {
  const repo = createModel();
  const { store, objects, deletes } = createStore();
  for (const id of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b0"]) {
    repo.addActive(id);
    objects.add(`camera/living-room/${id}.mp4`);
  }
  // 100 MB used, 25 MB incoming: needs 25 MB → three oldest 10 MB clips.
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 25 * MB, budgetBytes: BUDGET });
  assert.deepEqual(outcome.deletedIds, ["a1", "a2", "a3"]);
  assert.equal(outcome.freedBytes, 30 * MB);
  assert.deepEqual(deletes, ["camera/living-room/a1.mp4", "camera/living-room/a2.mp4", "camera/living-room/a3.mp4"]);
  assert.ok(!objects.has("camera/living-room/a1.mp4"));
  assert.equal(repo.rows.get("a1").status, "deleted");
  assert.equal(repo.usage().unprotectedBytes, 70 * MB);
  assert.ok(await repo.reserve({ id: "new", sizeBytes: 25 * MB, budgetBytes: BUDGET }));
});

test("rotation: no shortfall means nothing is claimed or deleted", async () => {
  const repo = createModel();
  const { store, deletes } = createStore();
  repo.addActive("a1");
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 10 * MB, budgetBytes: BUDGET });
  assert.deepEqual(outcome.deletedIds, []);
  assert.deepEqual(deletes, []);
});

test("protected recordings are never claimed; if they block the shortfall nothing is deleted and the reservation is refused", async () => {
  const repo = createModel();
  const { store, deletes } = createStore();
  repo.addActive("p1", { sizeBytes: 60 * MB, protected: true });
  repo.addActive("u1", { sizeBytes: 30 * MB });
  // 90 MB used, 50 MB incoming: shortfall 40 MB, but only 30 MB is unprotected.
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 50 * MB, budgetBytes: BUDGET });
  assert.deepEqual(outcome.deletedIds, []);
  assert.deepEqual(deletes, []);
  assert.equal(repo.rows.get("p1").status, "active");
  assert.equal(repo.rows.get("u1").status, "active");
  assert.equal(await repo.reserve({ id: "new", sizeBytes: 50 * MB, budgetBytes: BUDGET }), null);
});

test("a recording protected before rotation is skipped and the next-oldest unprotected one is used instead", async () => {
  const repo = createModel();
  const { store } = createStore();
  repo.addActive("a1"); repo.addActive("a2"); repo.addActive("a3");
  await repo.setProtected("a1", true);
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 80 * MB, budgetBytes: BUDGET });
  assert.deepEqual(outcome.deletedIds, ["a2"]);
  assert.equal(repo.rows.get("a1").status, "active");
});

test("a recording already pending deletion cannot be protected (only active rows can be toggled)", async () => {
  const repo = createModel();
  repo.addActive("a1");
  await repo.claimForRotation({ incomingBytes: 95 * MB, budgetBytes: BUDGET });
  assert.equal(repo.rows.get("a1").status, "pending_delete");
  assert.equal(await repo.setProtected("a1", true), null);
});

// ─── R2 failure and retry ───────────────────────────────────────────────────

test("R2 delete failure: the row stays pending_delete with key and size intact, keeps counting against the budget, and records only the error class name", async () => {
  const repo = createModel();
  const { store, failNext } = createStore();
  repo.addActive("a1", { sizeBytes: 50 * MB });
  repo.addActive("a2", { sizeBytes: 50 * MB });
  failNext.count = 1;
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 40 * MB, budgetBytes: BUDGET });
  assert.deepEqual(outcome.failedIds, ["a1"]);
  assert.deepEqual(outcome.deletedIds, []);
  const row = repo.rows.get("a1");
  assert.equal(row.status, "pending_delete");
  assert.equal(row.storageObjectKey, "camera/living-room/a1.mp4");
  assert.equal(row.sizeBytes, 50 * MB);
  assert.equal(row.lastDeleteError, "NetworkingError");
  assert.equal(repo.usage().pendingDeleteBytes, 50 * MB);
  // The unconfirmed space is NOT handed out.
  assert.equal(await repo.reserve({ id: "new", sizeBytes: 40 * MB, budgetBytes: BUDGET }), null);
});

test("R2 delete failure is retried by reconciliation after backoff, then confirmed and the space released", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, failNext, deletes } = createStore();
  repo.addActive("a1", { sizeBytes: 50 * MB });
  repo.addActive("a2", { sizeBytes: 50 * MB });
  failNext.count = 1;
  await core.rotateForSpace(repo, store, { incomingBytes: 40 * MB, budgetBytes: BUDGET });

  // Immediately: still inside the backoff window, so no retry hammering.
  let outcome = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(outcome.deletedIds, []);
  assert.equal(deletes.length, 1);

  c.advance(2 * MINUTE);
  outcome = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(outcome.deletedIds, ["a1"]);
  assert.equal(repo.rows.get("a1").status, "deleted");
  assert.equal(repo.usage().pendingDeleteBytes, 0);
  assert.ok(await repo.reserve({ id: "new", sizeBytes: 40 * MB, budgetBytes: BUDGET }));
});

test("retries are bounded: after MAX_DELETE_ATTEMPTS the row stays pending (still counted) and is no longer leased", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, failNext, deletes } = createStore();
  repo.addActive("a1", { sizeBytes: 50 * MB });
  failNext.count = 1000;
  await core.rotateForSpace(repo, store, { incomingBytes: 60 * MB, budgetBytes: BUDGET });
  for (let i = 0; i < 20; i++) {
    c.advance(2 * 60 * MINUTE);
    await core.reconcileCameraStorage(repo, store);
  }
  assert.equal(deletes.length, core.MAX_DELETE_ATTEMPTS);
  assert.equal(repo.rows.get("a1").status, "pending_delete");
  assert.equal(repo.usage().pendingDeleteBytes, 50 * MB);
});

// ─── Database failure after a successful R2 delete ──────────────────────────

test("DB failure after the R2 delete: the row stays pending (unconfirmed) and the retry re-deletes idempotently, then confirms", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, objects, deletes } = createStore();
  repo.addActive("a1", { sizeBytes: 50 * MB });
  objects.add("camera/living-room/a1.mp4");
  repo.failures.confirm = 1;

  const first = await core.rotateForSpace(repo, store, { incomingBytes: 60 * MB, budgetBytes: BUDGET });
  assert.deepEqual(first.unconfirmedIds, ["a1"]);
  assert.ok(!objects.has("camera/living-room/a1.mp4"), "object is gone from R2");
  assert.equal(repo.rows.get("a1").status, "pending_delete", "metadata kept until confirmed");
  assert.equal(repo.usage().pendingDeleteBytes, 50 * MB);

  c.advance(2 * MINUTE);
  const retry = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(retry.deletedIds, ["a1"]);
  assert.equal(deletes.length, 2, "the second delete targets an already-missing key, which R2 treats as success");
  assert.equal(repo.rows.get("a1").status, "deleted");
});

// ─── Concurrency ────────────────────────────────────────────────────────────

test("concurrent authorizations: the second claims nothing extra while the first's deletes are pending, and cannot reserve the not-yet-freed space", async () => {
  const repo = createModel();
  const { store } = createStore();
  for (const id of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b0"]) repo.addActive(id);

  // A claims (not yet deleted). B arrives in between.
  const claimedA = await repo.claimForRotation({ incomingBytes: 10 * MB, budgetBytes: BUDGET });
  assert.deepEqual(claimedA.map((c) => c.id), ["a1"]);
  const claimedB = await repo.claimForRotation({ incomingBytes: 10 * MB, budgetBytes: BUDGET });
  assert.deepEqual(claimedB, [], "pending bytes are already on their way out: no over-rotation");
  assert.equal(await repo.reserve({ id: "clipB", sizeBytes: 10 * MB, budgetBytes: BUDGET }), null, "unconfirmed space is not double-counted as free");

  // A completes its delete, then reserves.
  await core.deleteClaimedObjects(repo, store, claimedA);
  assert.ok(await repo.reserve({ id: "clipA", sizeBytes: 10 * MB, budgetBytes: BUDGET }));
  // B's retry rotates the next-oldest and succeeds.
  await core.rotateForSpace(repo, store, { incomingBytes: 10 * MB, budgetBytes: BUDGET });
  assert.ok(await repo.reserve({ id: "clipB", sizeBytes: 10 * MB, budgetBytes: BUDGET }));
  assert.ok(repo.usage().unprotectedBytes + repo.usage().reservedBytes <= BUDGET);
});

test("concurrent reconciliation sweeps never delete the same object twice (lease)", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, deletes, failNext } = createStore();
  repo.addActive("a1"); repo.addActive("a2");
  failNext.count = 2;
  await core.rotateForSpace(repo, store, { incomingBytes: 100 * MB, budgetBytes: BUDGET });
  assert.equal(deletes.length, 2);
  c.advance(5 * MINUTE);
  await Promise.all([core.reconcileCameraStorage(repo, store), core.reconcileCameraStorage(repo, store)]);
  assert.equal(deletes.length, 4, "each pending object retried exactly once across both sweeps");
  assert.equal(repo.rows.get("a1").status, "deleted");
  assert.equal(repo.rows.get("a2").status, "deleted");
});

// ─── Fix 2: abandoned uploads ───────────────────────────────────────────────

test("stale reservation: expires after the TTL, its partial object is deleted from R2, and its budget hold is released", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, objects, deletes } = createStore();
  await repo.reserve({ id: "r1", sizeBytes: 40 * MB, budgetBytes: BUDGET });
  objects.add("camera/living-room/r1.mp4"); // partial upload landed
  assert.equal(repo.usage().reservedBytes, 40 * MB);

  c.advance((core.RESERVATION_TTL_MINUTES - 1) * MINUTE);
  await core.reconcileCameraStorage(repo, store);
  assert.equal(repo.rows.get("r1").status, "reserved", "not expired before the TTL");

  c.advance(2 * MINUTE);
  const outcome = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(outcome.deletedIds, ["r1"]);
  assert.deepEqual(deletes, ["camera/living-room/r1.mp4"]);
  assert.ok(!objects.has("camera/living-room/r1.mp4"));
  assert.equal(repo.usage().reservedBytes, 0);
  assert.equal(repo.usage().pendingDeleteBytes, 0);
});

test("stale reservation with no object ever written: cleanup still succeeds (delete of a missing key is a no-op)", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store } = createStore();
  await repo.reserve({ id: "r1", sizeBytes: 40 * MB, budgetBytes: BUDGET });
  c.advance(2 * 60 * MINUTE);
  const outcome = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(outcome.deletedIds, ["r1"]);
});

test("stale reservation cleanup failing in R2: the reservation's size keeps counting (as pending) until a retry confirms", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, failNext } = createStore();
  await repo.reserve({ id: "r1", sizeBytes: 40 * MB, budgetBytes: BUDGET });
  c.advance(2 * 60 * MINUTE);
  failNext.count = 1;
  const first = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(first.failedIds, ["r1"]);
  assert.equal(repo.usage().pendingDeleteBytes, 40 * MB);
  assert.equal(await repo.reserve({ id: "big", sizeBytes: 70 * MB, budgetBytes: BUDGET }), null);
  c.advance(5 * MINUTE);
  const retry = await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(retry.deletedIds, ["r1"]);
  assert.ok(await repo.reserve({ id: "big", sizeBytes: 70 * MB, budgetBytes: BUDGET }));
});

test("re-issuing an upload URL restarts the reservation TTL, so an actively retried upload is never expired", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store } = createStore();
  await repo.reserve({ id: "r1", sizeBytes: 10 * MB, budgetBytes: BUDGET });
  c.advance(50 * MINUTE);
  assert.ok(await repo.touchReservation("r1"));
  c.advance(50 * MINUTE);
  await core.reconcileCameraStorage(repo, store);
  assert.equal(repo.rows.get("r1").status, "reserved");
});

test("finalize racing expiry: once a reservation is claimed, finalize and URL re-issue both fail; a finalized clip is never expired", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store } = createStore();
  await repo.reserve({ id: "late", sizeBytes: 10 * MB, budgetBytes: BUDGET });
  await repo.reserve({ id: "done", sizeBytes: 10 * MB, budgetBytes: BUDGET });
  await repo.markActive("done");
  c.advance(2 * 60 * MINUTE);
  await repo.claimStaleReservations({ ttlMinutes: core.RESERVATION_TTL_MINUTES, limit: 10 });
  assert.equal(await repo.markActive("late"), null);
  assert.equal(await repo.touchReservation("late"), null);
  assert.equal(repo.rows.get("done").status, "active");
  await core.reconcileCameraStorage(repo, store);
  assert.equal(repo.rows.get("done").status, "active");
});

test("reconciliation never touches active, finalized or protected recordings", async () => {
  const c = clock();
  const repo = createModel({ now: c.now });
  const { store, deletes } = createStore();
  repo.addActive("a1");
  repo.addActive("p1", { protected: true });
  c.advance(24 * 60 * MINUTE);
  await core.reconcileCameraStorage(repo, store);
  assert.deepEqual(deletes, []);
  assert.equal(repo.rows.get("a1").status, "active");
  assert.equal(repo.rows.get("p1").status, "active");
});

// ─── Isolation from other buckets and keys ──────────────────────────────────

test("the object store refuses any bucket other than kcxlabs-camera", () => {
  const ops = mockOperations({ objects: new Set(), deletes: [], failNext: { count: 0 } });
  for (const bucket of ["kcxlabs-media", "kcxlabs-releases", "test-bucket", ""]) {
    assert.throws(() => core.cameraObjectStore(bucket, ops), /CAMERA_R2_BUCKET/);
  }
  assert.equal(core.cameraObjectStore("kcxlabs-camera", ops).bucket, "kcxlabs-camera");
});

test("keys outside camera/<camera>/ are never deleted, even if a row somehow holds one", async () => {
  const repo = createModel();
  const { store, deletes } = createStore();
  repo.addActive("a1");
  repo.rows.get("a1").storageObjectKey = "media/owner/clip.mp4";
  repo.addActive("a2");
  repo.rows.get("a2").storageObjectKey = "camera/living-room/../../releases/app.exe";
  const outcome = await core.rotateForSpace(repo, store, { incomingBytes: 100 * MB, budgetBytes: BUDGET });
  assert.deepEqual(deletes, []);
  assert.deepEqual(outcome.failedIds.sort(), ["a1", "a2"]);
  assert.equal(repo.rows.get("a1").lastDeleteError, "invalid_key");
  assert.equal(repo.rows.get("a1").status, "pending_delete");
});

test("isCameraObjectKey accepts the keys upload-authorize generates and rejects everything else", () => {
  assert.equal(core.isCameraObjectKey("camera/living-room/2026-07-15T17_00_00.000Z-cam_abc123.mp4"), true);
  assert.equal(core.isCameraObjectKey("camera/living-room/"), false);
  assert.equal(core.isCameraObjectKey("releases/app.exe"), false);
  assert.equal(core.isCameraObjectKey("camera/living-room/a/b.mp4"), false);
  assert.equal(core.isCameraObjectKey("camera/living-room/..mp4"), false);
});

// ─── Fix 3: fail-closed camera credentials ──────────────────────────────────

const HEX32 = "0123456789abcdef0123456789abcdef";
const HEX64 = HEX32 + HEX32;
const cameraEnv = (overrides = {}) => ({
  R2_ACCOUNT_ID: "fedcba9876543210fedcba9876543210",
  R2_ACCESS_KEY_ID: "media-key-id",
  R2_SECRET_ACCESS_KEY: "media-secret",
  CAMERA_R2_ACCESS_KEY_ID: HEX32,
  CAMERA_R2_SECRET_ACCESS_KEY: HEX64.replace(/0/g, "f"),
  ...overrides,
});

test("camera config: explicit dedicated credentials load, bucket is kcxlabs-camera, no public host", () => {
  const config = core.loadCameraR2Config(cameraEnv());
  assert.equal(config.bucket, "kcxlabs-camera");
  assert.equal(config.publicHost, null);
  assert.equal(config.accessKeyId, HEX32);
});

test("camera config: general Media Center R2 credentials are NEVER used as a fallback", () => {
  const env = cameraEnv({ CAMERA_R2_ACCESS_KEY_ID: undefined, CAMERA_R2_SECRET_ACCESS_KEY: undefined });
  assert.throws(() => core.loadCameraR2Config(env), (error) => {
    assert.ok(error instanceof core.ConfigError);
    assert.deepEqual(error.missing.sort(), ["CAMERA_R2_ACCESS_KEY_ID", "CAMERA_R2_SECRET_ACCESS_KEY"]);
    return true;
  });
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ CAMERA_R2_SECRET_ACCESS_KEY: "  " })), /CAMERA_R2_SECRET_ACCESS_KEY/);
});

test("camera config: reusing the Media Center token, a wrong bucket, a public host, or malformed keys all fail closed", () => {
  const sharedKey = HEX32.replace(/a/g, "b");
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ R2_ACCESS_KEY_ID: sharedKey, CAMERA_R2_ACCESS_KEY_ID: sharedKey })), /dedicated camera token/);
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ CAMERA_R2_BUCKET: "kcxlabs-media" })), /CAMERA_R2_BUCKET/);
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ CAMERA_R2_BUCKET: "kcxlabs-releases" })), /CAMERA_R2_BUCKET/);
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ CAMERA_R2_PUBLIC_HOST: "camera.kcxlabs.org" })), /CAMERA_R2_PUBLIC_HOST/);
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ CAMERA_R2_ACCESS_KEY_ID: "short" })), /CAMERA_R2_ACCESS_KEY_ID/);
  assert.throws(() => core.loadCameraR2Config(cameraEnv({ CAMERA_R2_SECRET_ACCESS_KEY: "short" })), /CAMERA_R2_SECRET_ACCESS_KEY/);
});

test("camera config errors name variables only — never their values", () => {
  const secret = HEX64.replace(/1/g, "e");
  try {
    core.loadCameraR2Config(cameraEnv({ CAMERA_R2_SECRET_ACCESS_KEY: secret, CAMERA_R2_BUCKET: "kcxlabs-media", CAMERA_R2_ACCESS_KEY_ID: "bad" }));
    assert.fail("expected a ConfigError");
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.doesNotMatch(error.message, /\bbad\b/);
  }
});

test("missing camera credentials disable only the camera config; Media Center R2 config loads unchanged", () => {
  const env = cameraEnv({ CAMERA_R2_ACCESS_KEY_ID: undefined, CAMERA_R2_SECRET_ACCESS_KEY: undefined, R2_BUCKET: undefined });
  assert.equal(core.loadOptionalCameraR2Config(env), null);
  const media = core.loadR2Config(env);
  assert.equal(media.bucket, "kcxlabs-media");
  assert.equal(media.accessKeyId, "media-key-id");
});

test("camera play route fails closed with 503 when the camera token is absent, even for a valid owner session", { timeout: 8000 }, async () => {
  const saved = { id: process.env.CAMERA_R2_ACCESS_KEY_ID, secret: process.env.CAMERA_R2_SECRET_ACCESS_KEY };
  delete process.env.CAMERA_R2_ACCESS_KEY_ID;
  delete process.env.CAMERA_R2_SECRET_ACCESS_KEY;
  try {
    const { default: play } = await import("../dist-electron/routes/camera/archive/[id]/play.cjs");
    const signed = core.signSession("owner_kcx", process.env.SESSION_SECRET);
    const req = fakeRequest({
      method: "GET",
      url: "/api/camera/archive/abc123/play",
      headers: { host: "localhost:3456", cookie: `camera_archive_session=${encodeURIComponent(signed)}` },
    });
    const res = fakeResponse();
    await play.default(req, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(bodyOf(res)), { error: "camera_storage_unconfigured" });
  } finally {
    if (saved.id !== undefined) process.env.CAMERA_R2_ACCESS_KEY_ID = saved.id;
    if (saved.secret !== undefined) process.env.CAMERA_R2_SECRET_ACCESS_KEY = saved.secret;
  }
});

// ─── Scheduled cleanup route: CRON_SECRET only, fails closed ────────────────

async function callCleanup({ method = "GET", authorization, env = {} }) {
  const keys = ["CRON_SECRET", "CAMERA_R2_ACCESS_KEY_ID", "CAMERA_R2_SECRET_ACCESS_KEY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const { default: cleanup } = await import("../dist-electron/routes/camera/maintenance/cleanup.cjs");
    const headers = { host: "localhost:3456", ...(authorization ? { authorization } : {}) };
    const req = fakeRequest({ method, url: "/api/camera/maintenance/cleanup", headers });
    const res = fakeResponse();
    await cleanup.default(req, res);
    return { status: res.statusCode, body: JSON.parse(bodyOf(res)) };
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const CRON = "c".repeat(48);

test("cleanup route: anonymous, wrong-secret, owner-cookie and device-token requests are all 401", { timeout: 8000 }, async () => {
  assert.deepEqual(await callCleanup({ env: { CRON_SECRET: CRON } }), { status: 401, body: { error: "unauthorized" } });
  assert.equal((await callCleanup({ env: { CRON_SECRET: CRON }, authorization: `Bearer ${"d".repeat(48)}` })).status, 401);
  assert.equal((await callCleanup({ env: { CRON_SECRET: CRON }, authorization: CRON })).status, 401, "must be a Bearer token");
  assert.equal((await callCleanup({ env: { CRON_SECRET: CRON }, authorization: "Bearer some-real-device-token" })).status, 401);
});

test("cleanup route: no CRON_SECRET, or one too short to be real, means closed — even to a matching bearer", { timeout: 8000 }, async () => {
  assert.equal((await callCleanup({ authorization: "Bearer " })).status, 401);
  assert.equal((await callCleanup({ env: { CRON_SECRET: "short" }, authorization: "Bearer short" })).status, 401);
});

test("cleanup route: a valid cron secret without camera R2 credentials is 503 before any DB or R2 access", { timeout: 8000 }, async () => {
  const result = await callCleanup({ env: { CRON_SECRET: CRON }, authorization: `Bearer ${CRON}` });
  assert.deepEqual(result, { status: 503, body: { error: "camera_storage_unconfigured" } });
});

test("cleanup route: methods other than GET/POST are rejected", { timeout: 8000 }, async () => {
  assert.equal((await callCleanup({ method: "DELETE", env: { CRON_SECRET: CRON }, authorization: `Bearer ${CRON}` })).status, 405);
});

test("source check: cleanup route authenticates with CRON_SECRET only (constant-time), is registered, and never uses session or device auth", () => {
  const route = source("server/media-api/routes/camera/maintenance/cleanup.ts");
  assert.match(route, /loadCronSecret\(\)/);
  assert.match(route, /timingSafeEqual/);
  assert.doesNotMatch(route, /requireOwnerSession|requireDevice|requireOwnerOrDevice/);
  assert.ok(route.indexOf("cronAuthorized(request, secret)") < route.indexOf("loadAppConfig()"), "auth runs before config/DB/R2");
  const router = source("api/router.ts");
  assert.match(router, /"camera\/maintenance\/cleanup": cameraMaintenanceCleanup/);
  const config = source("server/media-api/_lib/config.ts");
  assert.match(config, /SECRET_KEYS = \[[\s\S]*"CRON_SECRET"[\s\S]*\] as const/);
  assert.doesNotMatch(source("src/App.tsx"), /CRON_SECRET/);
});

test("source check: batch leases use MATERIALIZED CTEs (never IN-subquery LIMIT, which Postgres can re-execute past the limit)", () => {
  const db = source("server/media-api/_lib/db.ts");
  for (const fn of ["claimStaleReservations", "leasePendingDeletions", "leaseLateUploadChecks"]) {
    const body = db.slice(db.indexOf(`async ${fn}`), db.indexOf(`async ${fn}`) + 1500);
    assert.match(body, /WITH picked AS MATERIALIZED/, fn);
    assert.doesNotMatch(body, /WHERE id IN \(\s*SELECT/, fn);
  }
});

test("source check: reserve() serializes on a transaction-scoped advisory lock before its budget-checked INSERT", () => {
  const db = source("server/media-api/_lib/db.ts");
  const body = db.slice(db.indexOf("async reserve(input"), db.indexOf("async markActive"));
  assert.match(body, /db\.transaction\(\(txn\) => \[\s*txn`SELECT pg_advisory_xact_lock\(hashtext\('kcx_camera_budget'\)\)`/);
});

// ─── Source checks pinning the SQL the in-memory model mirrors ──────────────

test("source check: rotation claims (UPDATE to pending_delete) instead of DELETE, re-checks protected, and excludes pending bytes from the shortfall", () => {
  const db = source("server/media-api/_lib/db.ts");
  const claim = db.slice(db.indexOf("async claimForRotation"), db.indexOf("async claimStaleReservations"));
  assert.match(claim, /status = 'pending_delete'/);
  assert.match(claim, /WHERE id IN \(SELECT id FROM victims\) AND status = 'active' AND protected = FALSE/);
  assert.match(claim, /ORDER BY recorded_start_at ASC, id ASC/);
  assert.match(claim, /total_available >= need\.shortfall/);
  assert.match(claim, /RETURNING id, storage_object_key, size_bytes/);
  assert.doesNotMatch(claim, /status IN \('active', 'pending_delete'\)/);
  assert.doesNotMatch(db, /DELETE FROM camera_recordings/);
});

test("source check: reserve() and usage() count pending_delete bytes until confirmed", () => {
  const db = source("server/media-api/_lib/db.ts");
  assert.match(db, /reserve\(input[\s\S]{0,3000}WHERE status IN \('active', 'pending_delete'\)/);
  assert.match(db, /status = 'pending_delete' THEN size_bytes ELSE 0 END\), 0\) AS pending_delete_bytes/);
});

test("source check: only confirmDeleted retires a row, and only from pending_delete", () => {
  const db = source("server/media-api/_lib/db.ts");
  const cameraSection = db.slice(db.indexOf("Camera archive repository"));
  const matches = cameraSection.match(/SET status = 'deleted'/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(db, /SET status = 'deleted', deleted_at = now\(\), last_delete_error = NULL\s+WHERE id = \$\{id\} AND status = 'pending_delete'/);
});

test("source check: stale reservations and retries use SKIP LOCKED leases; expiry keys off authorized_at", () => {
  const db = source("server/media-api/_lib/db.ts");
  assert.match(db, /claimStaleReservations[\s\S]{0,900}authorized_at < now\(\) - make_interval\(mins => \$\{input\.ttlMinutes\}\)[\s\S]{0,200}FOR UPDATE SKIP LOCKED/);
  assert.match(db, /leasePendingDeletions[\s\S]{0,1200}delete_attempts < \$\{input\.maxAttempts\}[\s\S]{0,400}FOR UPDATE SKIP LOCKED/);
});

test("source check: migration 006 adds pending_delete, forbids protected pending rows, and scopes recording_id uniqueness to live rows", () => {
  const sql = source("db/migrations/006_camera_deletion_safety.sql");
  assert.match(sql, /CHECK \(status IN \('reserved', 'active', 'pending_delete', 'deleted'\)\)/);
  assert.match(sql, /CHECK \(status <> 'pending_delete' OR protected = FALSE\)/);
  assert.match(sql, /ON camera_recordings \(recording_id\)\s+WHERE status <> 'deleted'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS authorized_at/);
});

test("source check: camera routes reach R2 only through cameraR2Context and fail closed with 503", () => {
  for (const path of [
    "server/media-api/routes/camera/upload-authorize.ts",
    "server/media-api/routes/camera/finalize.ts",
    "server/media-api/routes/camera/archive/[id]/play.ts",
    "server/media-api/routes/camera/archive/[id]/download.ts",
  ]) {
    const route = source(path);
    assert.match(route, /cameraR2Context\(context\.config\)/, path);
    assert.match(route, /json\(503, \{ error: "camera_storage_unconfigured" \}\)/, path);
    assert.doesNotMatch(route, /config\.r2\b/, path);
  }
});

test("source check: upload-authorize reconciles, rotates via the R2-confirming workflow, then reserves; never re-presigns a row being deleted", () => {
  const route = source("server/media-api/routes/camera/upload-authorize.ts");
  const reconcile = route.indexOf("reconcileCameraStorage(repo, store)");
  const rotate = route.indexOf("rotateForSpace(repo, store,");
  const reserve = route.indexOf("repo.reserve({");
  assert.ok(reconcile > -1 && rotate > reconcile && reserve > rotate);
  assert.match(route, /repo\.touchReservation\(existing\.id\)/);
  assert.match(route, /recording_being_removed/);
});
