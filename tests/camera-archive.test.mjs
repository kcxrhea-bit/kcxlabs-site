/**
 * Camera Archive — dedicated `/api/camera/*` subsystem for KCxCamBridge
 * backups. No live Postgres or R2 connection: everything here is reachable
 * without one, matching the convention in tests/media-archive.test.mjs and
 * tests/snapcal-auth.test.mjs.
 *
 * Isolation this suite proves:
 *  - the camera session cookie is a THIRD, independent credential: distinct
 *    from both the SnapCal and generic Media Center cookies
 *  - upload-authorize/finalize are device-bearer-only; archive browsing,
 *    play, download, protect, unprotect are owner-session-only — a device
 *    token must never reach the archive-management surface
 *  - the Living Room-only camera allow-list and the 6AM-10PM
 *    America/Los_Angeles schedule window (DST-aware) are enforced in pure,
 *    directly-testable logic
 *  - nothing this feature adds can be reached by /clips or /c/:publicId
 *
 * The budget/rotation/concurrency SQL in `_lib/db.ts`'s `cameraRepository`
 * is reasoned through and verified by source inspection here (its ordering,
 * oldest-first sort, protected-row exclusion, idempotency), NOT executed
 * against a real Postgres — there is no live database in this environment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fakeRequest, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";

const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

process.env.DATABASE_URL ??= "postgresql://test:test@localhost/test";
process.env.R2_ACCOUNT_ID ??= "test-account";
process.env.R2_ACCESS_KEY_ID ??= "test-key-id";
process.env.R2_SECRET_ACCESS_KEY ??= "test-secret";
process.env.R2_BUCKET ??= "test-bucket";
process.env.OWNER_EMAIL ??= "owner@example.test";
process.env.SESSION_SECRET ??= "a".repeat(64);

const HOST = "localhost:3456";
const NO_HANG = { timeout: 8000 };

let signSession;
let verifySignedSession;
let isAllowedCamera;
let checkSchedule;
let laDayBoundsUtc;

test.before(async () => {
  const core = await import("../dist-electron/api-core.cjs");
  signSession = core.signSession;
  verifySignedSession = core.verifySignedSession;
  isAllowedCamera = core.isAllowedCamera;
  checkSchedule = core.checkSchedule;
  laDayBoundsUtc = core.laDayBoundsUtc;
  process.env.OWNER_PASSWORD_HASH = await core.hashPassword("correct horse battery staple");
});

async function run(routeModule, options) {
  const nodeHandler = routeModule.default;
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await nodeHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.ended ? bodyOf(res) : null };
}

function fetchRequest(url, headers = {}) {
  return new Request(`http://${HOST}${url}`, { headers });
}

// ─── Pure schedule/camera logic — no DB involved at all ─────────────────────

test("isAllowedCamera: only 'living-room' passes; 'kitchen' and anything else is rejected", () => {
  assert.equal(isAllowedCamera("living-room"), true);
  assert.equal(isAllowedCamera("kitchen"), false);
  assert.equal(isAllowedCamera("Living-Room"), false);
  assert.equal(isAllowedCamera(""), false);
  assert.equal(isAllowedCamera(null), false);
  assert.equal(isAllowedCamera(undefined), false);
  assert.equal(isAllowedCamera(123), false);
});

test("checkSchedule: fully inside the 6AM-10PM LA window passes", () => {
  // 2026-07-15 is PDT (UTC-7): 10:00 LA = 17:00 UTC.
  const result = checkSchedule("2026-07-15T17:00:00.000Z", "2026-07-15T17:05:00.000Z");
  assert.deepEqual(result, { ok: true });
});

test("checkSchedule: a clip that is correct in UTC but wrong once converted to LA time is rejected", () => {
  // 2026-07-15T05:00:00Z is 2026-07-14T22:00:00 PDT — 10 PM LA, i.e. exactly the excluded boundary,
  // the previous LA calendar day. Reading this as a bare UTC hour (05:00) would look "inside" a
  // naive 06:00-22:00 check; only a real timezone conversion catches it.
  const result = checkSchedule("2026-07-15T05:00:00.000Z", "2026-07-15T05:05:00.000Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "after_window");
});

test("checkSchedule: a clip crossing 6 AM LA (starts before, ends after) is rejected", () => {
  // 05:59:00 PDT = 12:59:00Z : 06:01:00 PDT = 13:01:00Z.
  const result = checkSchedule("2026-07-15T12:59:00.000Z", "2026-07-15T13:01:00.000Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "before_window");
});

test("checkSchedule: a clip crossing 10 PM LA (starts before, ends after) is rejected", () => {
  // 21:59:00 PDT = 04:59:00Z (next day) : 22:01:00 PDT = 05:01:00Z (next day).
  const result = checkSchedule("2026-07-16T04:59:00.000Z", "2026-07-16T05:01:00.000Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "after_window");
});

test("checkSchedule: a clip starting before 6 AM LA, fully outside, is rejected as before_window", () => {
  // 04:00-04:05 PDT = 11:00-11:05Z.
  const result = checkSchedule("2026-07-15T11:00:00.000Z", "2026-07-15T11:05:00.000Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "before_window");
});

test("checkSchedule: an invalid/reversed range is rejected", () => {
  assert.equal(checkSchedule("not-a-date", "2026-07-15T17:05:00.000Z").ok, false);
  assert.equal(checkSchedule("2026-07-15T17:05:00.000Z", "2026-07-15T17:00:00.000Z").ok, false);
});

test("checkSchedule: DST transition day (2026-03-08, PST->PDT at 2 AM LA) — a clip entirely within the window still passes", () => {
  // Spring-forward day: 10:00 LA is still PST (UTC-8) before the 2 AM local jump already
  // happened earlier that morning, so by 10 AM the offset is already PDT (UTC-7).
  const result = checkSchedule("2026-03-08T17:00:00.000Z", "2026-03-08T17:05:00.000Z");
  assert.deepEqual(result, { ok: true });
});

test("laDayBoundsUtc: returns a [from, to) pair whose duration is a real LA calendar day, including on a DST transition date", () => {
  const normal = laDayBoundsUtc("2026-07-15");
  assert.ok(normal);
  const normalHours = (new Date(normal.toIso).getTime() - new Date(normal.fromIso).getTime()) / 3_600_000;
  assert.equal(normalHours, 24);

  // 2026-03-08 is the spring-forward day in America/Los_Angeles — 23 wall-clock hours.
  const dst = laDayBoundsUtc("2026-03-08");
  assert.ok(dst);
  const dstHours = (new Date(dst.toIso).getTime() - new Date(dst.fromIso).getTime()) / 3_600_000;
  assert.equal(dstHours, 23);
});

test("laDayBoundsUtc: rejects a malformed date key", () => {
  assert.equal(laDayBoundsUtc("not-a-date"), null);
  assert.equal(laDayBoundsUtc("2026-7-15"), null);
});

// ─── POST /api/camera/auth/login, logout — cookie shape and isolation ──────

test("camera/auth/login: wrong method is rejected", NO_HANG, async () => {
  const { default: login } = await import("../dist-electron/routes/camera/auth/login.cjs");
  const { status } = await run(login, { method: "GET", url: "/api/camera/auth/login" });
  assert.equal(status, 405);
});

test("camera/auth/login: wrong credentials are 401, no cookie, no metadata leaked", NO_HANG, async () => {
  const { default: login } = await import("../dist-electron/routes/camera/auth/login.cjs");
  const { status, body, headers } = await run(login, {
    method: "POST",
    url: "/api/camera/auth/login",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.OWNER_EMAIL, password: "nope" }),
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "invalid_credentials" });
  assert.equal(headers["set-cookie"], undefined);
});

test("camera/auth/login: correct credentials set an HttpOnly/Secure/SameSite=Lax cookie scoped to /api/camera, named camera_archive_session, no token in the body", NO_HANG, async () => {
  const { default: login } = await import("../dist-electron/routes/camera/auth/login.cjs");
  const { status, body, headers } = await run(login, {
    method: "POST",
    url: "/api/camera/auth/login",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.OWNER_EMAIL.toUpperCase(), password: "correct horse battery staple" }),
  });
  assert.equal(status, 200);
  assert.doesNotMatch(body, /token/i);

  const cookie = headers["set-cookie"];
  assert.match(cookie, /^camera_archive_session=/);
  assert.match(cookie, /Path=\/api\/camera/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);

  const rawValue = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  assert.equal(verifySignedSession(rawValue, process.env.SESSION_SECRET), "owner_kcx");
});

test("camera/auth/logout: clears the cookie with Max-Age=0, scoped to /api/camera", NO_HANG, async () => {
  const { default: logout } = await import("../dist-electron/routes/camera/auth/logout.cjs");
  const { status, headers } = await run(logout, { method: "POST", url: "/api/camera/auth/logout" });
  assert.equal(status, 200);
  assert.match(headers["set-cookie"], /^camera_archive_session=;/);
  assert.match(headers["set-cookie"], /Max-Age=0/);
});

// ─── requireOwnerSession() — owner-session-ONLY, no device-bearer fallback ─

test("requireOwnerSession: no cookie at all is 401 with no metadata leaked", NO_HANG, async () => {
  const { requireOwnerSession, isResponse } = await import("../dist-electron/api-http.cjs");
  const result = await requireOwnerSession(fetchRequest("/api/camera/archive/list"));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: "unauthorized" });
});

test("requireOwnerSession: a VALID DEVICE BEARER TOKEN alone, with no cookie, is still 401 — proving device tokens cannot reach archive management", NO_HANG, async () => {
  const { requireOwnerSession, isResponse } = await import("../dist-electron/api-http.cjs");
  // No requireDevice/DB call happens here at all: requireOwnerSession never inspects Authorization.
  const result = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { authorization: "Bearer some-real-looking-device-token" }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerSession: a forged/invalid session cookie is rejected", NO_HANG, async () => {
  const { requireOwnerSession, isResponse } = await import("../dist-electron/api-http.cjs");
  const result = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { cookie: "camera_archive_session=owner_kcx.not-a-real-signature" }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerSession: a cookie signed with a different secret is rejected (cross-secret forgery)", NO_HANG, async () => {
  const { requireOwnerSession, isResponse } = await import("../dist-electron/api-http.cjs");
  const forged = signSession("owner_kcx", "a-totally-different-secret-00000000000");
  const result = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { cookie: `camera_archive_session=${encodeURIComponent(forged)}` }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerSession: a correctly-signed cookie for a different owner id is rejected", NO_HANG, async () => {
  const { requireOwnerSession, isResponse } = await import("../dist-electron/api-http.cjs");
  const signed = signSession("someone_else", process.env.SESSION_SECRET);
  const result = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { cookie: `camera_archive_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerSession: a valid, correctly-signed cookie resolves the owner context without touching the database", NO_HANG, async () => {
  const { requireOwnerSession, isResponse } = await import("../dist-electron/api-http.cjs");
  const signed = signSession("owner_kcx", process.env.SESSION_SECRET);
  const result = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { cookie: `camera_archive_session=${encodeURIComponent(signed)}` }));
  assert.ok(!isResponse(result));
  assert.equal(result.ownerId, "owner_kcx");
});

test("the camera_archive_session cookie is a THIRD independent credential: the SnapCal or generic Media Center cookie does not authenticate it, and vice versa", NO_HANG, async () => {
  const { requireOwnerSession, requireOwnerOrDevice, requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const signed = signSession("owner_kcx", process.env.SESSION_SECRET);

  const withSnapcalCookie = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { cookie: `snapcal_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(withSnapcalCookie));
  assert.equal(withSnapcalCookie.status, 401);

  const withMediaCookie = await requireOwnerSession(fetchRequest("/api/camera/archive/list", { cookie: `media_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(withMediaCookie));
  assert.equal(withMediaCookie.status, 401);

  const cameraCookieAgainstSnapcal = await requireOwnerOrDevice(fetchRequest("/api/snapcal/v1/calendars", { cookie: `camera_archive_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(cameraCookieAgainstSnapcal));
  assert.equal(cameraCookieAgainstSnapcal.status, 401);

  const cameraCookieAgainstMedia = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list", { cookie: `camera_archive_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(cameraCookieAgainstMedia));
  assert.equal(cameraCookieAgainstMedia.status, 401);
});

// ─── Route-level auth gating: archive list/budget/play/download/protect ────

test("camera/archive/list: wrong method rejected before auth", NO_HANG, async () => {
  const { default: list } = await import("../dist-electron/routes/camera/archive/list.cjs");
  const { status } = await run(list, { method: "POST", url: "/api/camera/archive/list" });
  assert.equal(status, 405);
});

test("camera/archive/list: unauthenticated GET is 401, no metadata leaked", NO_HANG, async () => {
  const { default: list } = await import("../dist-electron/routes/camera/archive/list.cjs");
  const { status, body } = await run(list, { method: "GET", url: "/api/camera/archive/list" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("camera/archive/list: a bearer-token-only request (no cookie) is 401 before any DB/R2 call", NO_HANG, async () => {
  const { default: list } = await import("../dist-electron/routes/camera/archive/list.cjs");
  const { status, body } = await run(list, {
    method: "GET",
    url: "/api/camera/archive/list",
    headers: { host: HOST, authorization: "Bearer some-real-device-token" },
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("camera/archive/budget: unauthenticated GET is 401", NO_HANG, async () => {
  const { default: budget } = await import("../dist-electron/routes/camera/archive/budget.cjs");
  const { status } = await run(budget, { method: "GET", url: "/api/camera/archive/budget" });
  assert.equal(status, 401);
});

test("camera/archive/[id]/play: unauthenticated GET is 401 before any R2/database call", NO_HANG, async () => {
  const { default: play } = await import("../dist-electron/routes/camera/archive/[id]/play.cjs");
  const { status, body } = await run(play, { method: "GET", url: "/api/camera/archive/abc123/play" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("camera/archive/[id]/download: unauthenticated GET is 401 before any R2/database call", NO_HANG, async () => {
  const { default: dl } = await import("../dist-electron/routes/camera/archive/[id]/download.cjs");
  const { status, body } = await run(dl, { method: "GET", url: "/api/camera/archive/abc123/download" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("camera/archive/[id]/protect: a valid DEVICE BEARER TOKEN alone (no cookie) is 401 — device tokens cannot protect/unprotect", NO_HANG, async () => {
  const { default: protect } = await import("../dist-electron/routes/camera/archive/[id]/protect.cjs");
  const { status, body } = await run(protect, {
    method: "POST",
    url: "/api/camera/archive/abc123/protect",
    headers: { host: HOST, authorization: "Bearer some-real-device-token" },
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("camera/archive/[id]/unprotect: unauthenticated POST is 401", NO_HANG, async () => {
  const { default: unprotect } = await import("../dist-electron/routes/camera/archive/[id]/unprotect.cjs");
  const { status } = await run(unprotect, { method: "POST", url: "/api/camera/archive/abc123/unprotect" });
  assert.equal(status, 401);
});

// ─── POST /api/camera/upload-authorize, finalize: device-bearer-only ──────

test("camera/upload-authorize: wrong method rejected before auth", NO_HANG, async () => {
  const { default: authorize } = await import("../dist-electron/routes/camera/upload-authorize.cjs");
  const { status } = await run(authorize, { method: "GET", url: "/api/camera/upload-authorize" });
  assert.equal(status, 405);
});

test("camera/upload-authorize: no bearer token is 401 before reading the body at all", NO_HANG, async () => {
  const { default: authorize } = await import("../dist-electron/routes/camera/upload-authorize.cjs");
  const { status, body } = await run(authorize, { method: "POST", url: "/api/camera/upload-authorize" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("camera/upload-authorize: a present (fake) bearer token clears the 401 short-circuit and reaches the device-token DB lookup, surfacing as 500 against this synthetic database — proving the header itself reached requireDevice", NO_HANG, async () => {
  const { default: authorize } = await import("../dist-electron/routes/camera/upload-authorize.cjs");
  const { status, body } = await run(authorize, {
    method: "POST",
    url: "/api/camera/upload-authorize",
    headers: { host: HOST, authorization: "Bearer some-fake-token" },
    body: JSON.stringify({ recordingId: "r1", camera: "living-room", filename: "clip.mp4" }),
  });
  assert.equal(status, 500);
  assert.deepEqual(JSON.parse(body), { error: "internal_error" });
});

test("camera/finalize: no bearer token is 401", NO_HANG, async () => {
  const { default: finalize } = await import("../dist-electron/routes/camera/finalize.cjs");
  const { status } = await run(finalize, { method: "POST", url: "/api/camera/finalize" });
  assert.equal(status, 401);
});

// ─── Source checks: things only verifiable without a live database ────────

test("source check: upload-authorize hard-rejects any camera other than 'living-room' with 403, independent of every other field — not a soft warning", () => {
  const authSource = source("server/media-api/routes/camera/upload-authorize.ts");
  assert.match(authSource, /isAllowedCamera\(camera\)/);
  assert.match(authSource, /json\(403, \{ error: "camera_not_allowed" \}\)/);
});

test("source check: upload-authorize re-validates the recording's timestamps against the schedule server-side, rejecting (422) rather than silently trimming", () => {
  const authSource = source("server/media-api/routes/camera/upload-authorize.ts");
  assert.match(authSource, /checkSchedule\(recordedStartAt, recordedEndAt\)/);
  assert.match(authSource, /json\(422, \{ error: "outside_schedule"/);
});

test("source check: upload-authorize rotates for space BEFORE attempting to reserve, and never reserves past budget without the DB's own live re-check", () => {
  const authSource = source("server/media-api/routes/camera/upload-authorize.ts");
  const rotateIndex = authSource.indexOf("rotateForSpace(repo, store,");
  const reserveIndex = authSource.indexOf("repo.reserve({");
  assert.ok(rotateIndex > -1 && reserveIndex > -1 && rotateIndex < reserveIndex, "rotation must happen before the reservation attempt");
});

test("source check: rotation claims oldest-first, excludes protected rows, and refuses to claim anything if the unprotected total can't cover the shortfall", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  assert.match(dbSource, /claimForRotation[\s\S]{0,1600}WHERE status = 'active' AND protected = FALSE/);
  assert.match(dbSource, /claimForRotation[\s\S]{0,1600}ORDER BY recorded_start_at ASC, id ASC/);
  assert.match(dbSource, /claimForRotation[\s\S]{0,2000}total_available >= need\.shortfall/);
  // A non-positive shortfall claims nothing: enforced in SQL by `need.shortfall > 0`.
  assert.match(dbSource, /claimForRotation[\s\S]{0,2000}WHERE need\.shortfall > 0/);
});

test("source check: reserve() re-checks the live budget inside the INSERT itself — a stale app-level read can never cause an over-budget row to be created", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  assert.match(dbSource, /reserve\(input[\s\S]{0,3000}WHERE usage\.active_bytes \+ reserved\.reserved_bytes \+ \$\{input\.sizeBytes\} <= \$\{input\.budgetBytes\}/);
});

test("source check: protect/unprotect are never reachable via requireDevice — only requireOwnerSession", () => {
  const protectSource = source("server/media-api/routes/camera/archive/[id]/protect.ts");
  const unprotectSource = source("server/media-api/routes/camera/archive/[id]/unprotect.ts");
  for (const routeSource of [protectSource, unprotectSource]) {
    assert.match(routeSource, /requireOwnerSession\(request\)/);
    assert.doesNotMatch(routeSource, /requireDevice\(/);
    assert.doesNotMatch(routeSource, /requireOwnerOrDevice/);
  }
});

test("source check: upload-authorize and finalize use requireDevice exclusively — never a session cookie", () => {
  const authSource = source("server/media-api/routes/camera/upload-authorize.ts");
  const finalizeSource = source("server/media-api/routes/camera/finalize.ts");
  for (const routeSource of [authSource, finalizeSource]) {
    assert.match(routeSource, /requireDevice\(request\)/);
    assert.doesNotMatch(routeSource, /requireOwnerSession/);
  }
});

test("source check: finalize rejects a size/hash mismatch and leaves the row reserved rather than marking it active", () => {
  const finalizeSource = source("server/media-api/routes/camera/finalize.ts");
  assert.match(finalizeSource, /json\(409, \{ error: "size_mismatch" \}\)/);
  assert.match(finalizeSource, /json\(409, \{ error: "hash_mismatch" \}\)/);
  assert.doesNotMatch(finalizeSource, /markActive[\s\S]{0,50}size_mismatch/);
});

test("source check: finalize is idempotent — an already-active row returns success without re-running markActive's UPDATE", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  assert.match(dbSource, /markActive[\s\S]{0,900}idempotent: true/);
});

test("source check: the 5 GB camera budget and the camera bucket are fully separate from the general Media Center table and bucket", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  // The camera repository's usage()/reserve()/rotateForSpace() only ever reference camera_recordings.
  const cameraSectionStart = dbSource.indexOf("Camera archive repository");
  const cameraSection = dbSource.slice(cameraSectionStart);
  assert.ok(cameraSectionStart > -1);
  assert.doesNotMatch(cameraSection, /FROM media\b/);
  assert.doesNotMatch(cameraSection, /INSERT INTO media\b/);
  assert.doesNotMatch(cameraSection, /UPDATE media\b/);

  const configSource = source("server/media-api/_lib/config.ts");
  assert.match(configSource, /CAMERA_R2_BUCKET.*kcxlabs-camera/);
  // A missing CAMERA_R2_BUCKET must never silently alias the general media bucket's default.
  assert.doesNotMatch(configSource, /loadCameraR2Config[\s\S]{0,700}kcxlabs-media/);
});

test("source check: /clips (listPublic) and /c/:publicId still gate on visibility exactly as before — camera_recordings is never joined or read by either", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  assert.match(dbSource, /listPublic[\s\S]{0,200}WHERE visibility = 'public'/);
  assert.doesNotMatch(dbSource, /listPublic[\s\S]{0,400}camera_recordings/);

  const publicRoute = source("server/media-api/routes/media/public/[publicId].ts");
  assert.match(publicRoute, /item\.visibility === "private"\) return json\(404/);
  assert.doesNotMatch(publicRoute, /camera_recordings/);

  const clipsRoute = source("server/media-api/routes/clips.ts");
  assert.doesNotMatch(clipsRoute, /camera_recordings/);
});

test("source check: the generic media upload-authorize no longer accepts camera/recordedAt overrides — exactly one live path for camera data", () => {
  const genericUpload = source("server/media-api/routes/media/upload-authorize.ts");
  assert.doesNotMatch(genericUpload, /cameraOverride/);
  assert.doesNotMatch(genericUpload, /recordedAtOverride/);
});

test("source check: reservation TTL expiry exists so a crashed/dropped finalize doesn't permanently lock budget", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  assert.match(dbSource, /claimStaleReservations/);
  assert.match(dbSource, /status = 'reserved' AND authorized_at < now\(\)/);
});
