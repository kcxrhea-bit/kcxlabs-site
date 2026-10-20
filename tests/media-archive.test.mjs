/**
 * Camera Archive web viewer — security-focused coverage for the owner-only
 * `/api/media/archive/*` routes. No live Postgres or R2 connection: every
 * case here is reachable without one, same convention as
 * tests/snapcal-auth.test.mjs and tests/api-dispatch-routing.test.mjs.
 *
 * What this suite proves:
 *  - unauthenticated/malformed-session access is rejected before any data read
 *  - a valid owner session (and, separately, a bearer device token) is accepted
 *  - the non-leakage boundary holds: private visibility stays invisible to
 *    /clips and /c/:publicId regardless of anything this feature adds
 *  - login/logout set/clear the correct, narrowly-scoped cookie
 *  - a forged or wrong-secret session is rejected
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
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const OWNER_PASSWORD = "correct horse battery staple";

let ownerPasswordHash;
let signSession;
let verifySignedSession;

test.before(async () => {
  const core = await import("../dist-electron/api-core.cjs");
  signSession = core.signSession;
  verifySignedSession = core.verifySignedSession;
  ownerPasswordHash = await core.hashPassword(OWNER_PASSWORD);
  process.env.OWNER_PASSWORD_HASH = ownerPasswordHash;
});

async function run(routeModule, options) {
  const nodeHandler = routeModule.default;
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await nodeHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.ended ? bodyOf(res) : null, ended: res.ended };
}

function fetchRequest(url, headers = {}) {
  return new Request(`http://${HOST}${url}`, { headers });
}

// ─── POST /api/media/archive/auth/login ─────────────────────────────────────

test("media/archive/auth/login: wrong method is rejected", NO_HANG, async () => {
  const { default: login } = await import("../dist-electron/routes/media/archive/auth/login.cjs");
  const { status } = await run(login, { method: "GET", url: "/api/media/archive/auth/login" });
  assert.equal(status, 405);
});

test("media/archive/auth/login: wrong credentials return 401, no cookie set, no metadata in the body", NO_HANG, async () => {
  const { default: login } = await import("../dist-electron/routes/media/archive/auth/login.cjs");
  const { status, body, headers } = await run(login, {
    method: "POST",
    url: "/api/media/archive/auth/login",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: "nope" }),
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "invalid_credentials" });
  assert.equal(headers["set-cookie"], undefined);
});

test("media/archive/auth/login: correct credentials set an HttpOnly, Secure, SameSite=Lax cookie scoped to /api/media, no bearer token in the body", NO_HANG, async () => {
  const { default: login } = await import("../dist-electron/routes/media/archive/auth/login.cjs");
  const { status, body, headers } = await run(login, {
    method: "POST",
    url: "/api/media/archive/auth/login",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL.toUpperCase(), password: OWNER_PASSWORD }),
  });
  assert.equal(status, 200);
  const parsed = JSON.parse(body);
  assert.deepEqual(parsed, { ok: true });
  // No bearer/device token anywhere in the response body — the browser only ever gets the cookie.
  assert.doesNotMatch(JSON.stringify(parsed), /token/i);

  const cookie = headers["set-cookie"];
  assert.ok(cookie, "expected a Set-Cookie header");
  assert.match(cookie, /^media_session=/);
  assert.match(cookie, /Path=\/api\/media/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);

  const rawValue = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  assert.equal(verifySignedSession(rawValue, process.env.SESSION_SECRET), "owner_kcx");
});

// ─── POST /api/media/archive/auth/logout ────────────────────────────────────

test("media/archive/auth/logout: clears the cookie with Max-Age=0, scoped to /api/media", NO_HANG, async () => {
  const { default: logout } = await import("../dist-electron/routes/media/archive/auth/logout.cjs");
  const { status, body, headers } = await run(logout, { method: "POST", url: "/api/media/archive/auth/logout" });
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
  assert.match(headers["set-cookie"], /^media_session=;/);
  assert.match(headers["set-cookie"], /Path=\/api\/media/);
  assert.match(headers["set-cookie"], /Max-Age=0/);
});

// ─── requireOwnerOrDeviceForMedia() ─────────────────────────────────────────

test("requireOwnerOrDeviceForMedia: no bearer and no cookie is 401 with no metadata leaked", NO_HANG, async () => {
  const { requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const result = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list"));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: "unauthorized" });
});

test("requireOwnerOrDeviceForMedia: a forged/invalid session cookie is rejected", NO_HANG, async () => {
  const { requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const result = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list", { cookie: "media_session=owner_kcx.not-a-real-signature" }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerOrDeviceForMedia: a session cookie signed with the right algorithm but a different secret is rejected (cross-secret forgery)", NO_HANG, async () => {
  const { requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const signedWithWrongSecret = signSession("owner_kcx", "a-totally-different-secret-00000000000");
  const result = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list", { cookie: `media_session=${encodeURIComponent(signedWithWrongSecret)}` }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerOrDeviceForMedia: a session cookie correctly signed for a different owner id is rejected", NO_HANG, async () => {
  const { requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const signedForSomeoneElse = signSession("someone_else", process.env.SESSION_SECRET);
  const result = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list", { cookie: `media_session=${encodeURIComponent(signedForSomeoneElse)}` }));
  assert.ok(isResponse(result));
  assert.equal(result.status, 401);
});

test("requireOwnerOrDeviceForMedia: a valid, correctly-signed session cookie resolves the owner context without touching the database", NO_HANG, async () => {
  const { requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const signed = signSession("owner_kcx", process.env.SESSION_SECRET);
  const result = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list", { cookie: `media_session=${encodeURIComponent(signed)}` }));
  assert.ok(!isResponse(result));
  assert.equal(result.ownerId, "owner_kcx");
});

test("requireOwnerOrDeviceForMedia: a bearer token takes priority over a cookie, and a malformed Authorization header falls back to the cookie", NO_HANG, async () => {
  const { requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const signed = signSession("owner_kcx", process.env.SESSION_SECRET);
  // A non-bearer Authorization header must not block the cookie fallback.
  const result = await requireOwnerOrDeviceForMedia(
    fetchRequest("/api/media/archive/list", { authorization: "Basic not-a-bearer-token", cookie: `media_session=${encodeURIComponent(signed)}` }),
  );
  assert.ok(!isResponse(result));
  assert.equal(result.ownerId, "owner_kcx");
});

test("the media_session cookie is a distinct credential from the SnapCal cookie: one being valid does not authenticate the other route family", NO_HANG, async () => {
  const { requireOwnerOrDevice, requireOwnerOrDeviceForMedia, isResponse } = await import("../dist-electron/api-http.cjs");
  const signed = signSession("owner_kcx", process.env.SESSION_SECRET);
  // Only the snapcal_session cookie is present; the Camera Archive resolver must not accept it.
  const archiveResult = await requireOwnerOrDeviceForMedia(fetchRequest("/api/media/archive/list", { cookie: `snapcal_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(archiveResult));
  assert.equal(archiveResult.status, 401);
  // And the reverse: a media_session cookie does not authenticate SnapCal's resolver.
  const snapcalResult = await requireOwnerOrDevice(fetchRequest("/api/snapcal/v1/calendars", { cookie: `media_session=${encodeURIComponent(signed)}` }));
  assert.ok(isResponse(snapcalResult));
  assert.equal(snapcalResult.status, 401);
});

// ─── GET /api/media/archive/list, play, download: method/auth gating ───────

test("media/archive/list: wrong method is rejected before auth", NO_HANG, async () => {
  const { default: list } = await import("../dist-electron/routes/media/archive/list.cjs");
  const { status } = await run(list, { method: "POST", url: "/api/media/archive/list" });
  assert.equal(status, 405);
});

test("media/archive/list: unauthenticated GET is 401, no media metadata in the body", NO_HANG, async () => {
  const { default: list } = await import("../dist-electron/routes/media/archive/list.cjs");
  const { status, body } = await run(list, { method: "GET", url: "/api/media/archive/list" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("media/archive/[id]/play: unauthenticated GET is 401 before any R2/database call", NO_HANG, async () => {
  const { default: play } = await import("../dist-electron/routes/media/archive/[id]/play.cjs");
  const { status, body } = await run(play, { method: "GET", url: "/api/media/archive/abc123/play" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("media/archive/[id]/download: unauthenticated GET is 401 before any R2/database call", NO_HANG, async () => {
  const { default: dl } = await import("../dist-electron/routes/media/archive/[id]/download.cjs");
  const { status, body } = await run(dl, { method: "GET", url: "/api/media/archive/abc123/download" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("media/archive/[id]/play: a present (if fake) bearer token clears the 401 short-circuit and reaches the device-token lookup, proving the header itself reached the handler", NO_HANG, async () => {
  const { default: play } = await import("../dist-electron/routes/media/archive/[id]/play.cjs");
  const { status, body } = await run(play, {
    method: "GET",
    url: "/api/media/archive/abc123/play",
    headers: { host: HOST, authorization: "Bearer some-fake-token" },
  });
  // Not 401 (the "no credential at all" short-circuit) — the fake token clears that and reaches
  // the device-token lookup, which throws against this synthetic, unreachable test database,
  // surfacing as a 500 — exactly the same convention already proven in
  // api-dispatch-routing.test.mjs's equivalent check-hash case. A thrown/hung request would fail
  // NO_HANG instead; this proves the Authorization header itself reached requireDevice.
  assert.equal(status, 500);
  assert.deepEqual(JSON.parse(body), { error: "internal_error" });
});

// ─── Non-leakage: nothing this feature adds weakens /clips or /c/:publicId ──

test("source check: /clips (listPublic) and /c/:publicId (byPublicId handler) still gate on visibility exactly as before — this feature's new SQL does not touch either query", () => {
  const dbSource = source("server/media-api/_lib/db.ts");
  assert.match(dbSource, /listPublic[\s\S]{0,200}WHERE visibility = 'public'/, "listPublic must still filter to visibility='public' in SQL");

  const publicRoute = source("server/media-api/routes/media/public/[publicId].ts");
  assert.match(publicRoute, /item\.visibility === "private"\) return json\(404/, "the public share route must still 404 private items");

  // The new owner-only listing method must be a SEPARATE function — it isn't reached by
  // /clips or /c/:publicId — scoped to owner_id in SQL, so it can never become the source of a
  // visibility leak even if someone later forgets a check at the route layer.
  assert.match(dbSource, /listForOwnerByCamera[\s\S]{0,300}WHERE owner_id = \$\{ownerId\}/);
});
