/**
 * Proves the single Vercel Function at `api/router.ts` — added so the Media
 * Center API stays under the Hobby plan's 12-function limit — routes every one
 * of the 22 real URLs to its real, unmodified handler, and that the dispatcher
 * itself never touches the request in a way that could drop a query string,
 * a body, an Authorization header, or a dynamic id segment.
 *
 * `api/[...path].ts` (a Next.js catch-all naming convention) turned out not to
 * be honored by Vercel's generic Functions runtime for a plain Vite project:
 * every request 404'd before reaching the function at all. `api/router.ts` is
 * reached instead via an explicit `vercel.json` rewrite,
 * `/api/:path* -> /api/router?__kcx_path=:path*`, so a large block of tests
 * below exercises that reconstruction specifically — building the same
 * `?__kcx_path=...` shape Vercel produces and proving the dispatcher restores
 * the original public URL before any route logic runs.
 *
 * Live dispatch (`dispatch(req, res)`) is exercised for every route whose
 * first gate (`requireMethod` or `requireDevice`) short-circuits before any
 * database or R2 call — 20 of the 22. The remaining two, `clips` and
 * `media/public/[publicId]`, have no auth gate and touch the database for any
 * request, so this suite proves routing to them with `resolveRoute` alone
 * (pure, no I/O) and leaves their business logic to the static source-text
 * checks already in media-api-routes.test.mjs, consistent with how that file
 * already avoids invoking those two live.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeRequest, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";

// Synthetic only — shaped to pass config validation, never used to reach a
// real database or bucket. Every live-dispatch case below returns before a
// successful database read (a 400/401/405 short-circuit), or — for the two
// Authorization-header cases — fails fast against this fake host instead of
// hanging, which is itself what proves the header reached `requireDevice`.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost/test";
process.env.R2_ACCOUNT_ID ??= "test-account";
process.env.R2_ACCESS_KEY_ID ??= "test-key-id";
process.env.R2_SECRET_ACCESS_KEY ??= "test-secret";
process.env.R2_BUCKET ??= "test-bucket";
process.env.OWNER_EMAIL ??= "owner@example.test";
process.env.OWNER_PASSWORD_HASH ??= "scrypt$16384$8$1$74657374$74657374";
process.env.SESSION_SECRET ??= "a".repeat(64);

const HOST = "localhost:3456";
const NO_HANG = { timeout: 8000 };
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * esbuild's CJS output for a module that only does `export default X` is
 * sometimes reachable at `module.default` and sometimes at `module.default.default`
 * depending on whether Node's cjs-module-lexer has already run for this
 * process — observed directly against this repo's own bundles. Unwrapping
 * defensively here is cheaper and more reliable than depending on import order.
 */
function unwrapDefault(mod) {
  return typeof mod.default === "function" ? mod.default : mod.default.default;
}

const { resolveRoute, dispatch } = await (async () => {
  const mod = await import("../dist-electron/api-dispatch.cjs");
  return { resolveRoute: mod.resolveRoute, dispatch: unwrapDefault(mod) };
})();

async function run(options) {
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await dispatch(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.ended ? bodyOf(res) : null, ended: res.ended, req };
}

/**
 * Builds the exact `?__kcx_path=...` shape Vercel's `/api/:path* -> /api/router?__kcx_path=:path*`
 * rewrite produces for a given original path (no leading `/api/`, no leading slash) and query
 * string: `__kcx_path` first, then every original query parameter auto-appended after it — Vercel
 * appends the incoming request's query parameters that aren't already present in the destination.
 */
function rewrittenUrl(originalPathAfterApi, originalQuery = "") {
  const params = new URLSearchParams();
  params.set("__kcx_path", originalPathAfterApi);
  for (const [key, value] of new URLSearchParams(originalQuery)) params.append(key, value);
  return `/api/router?${params.toString()}`;
}

// ─── Structural: the dispatcher delegates, it does not reimplement ──────────

test("the dispatcher file only routes; it imports every route module rather than reimplementing logic", () => {
  const dispatcher = source("api/router.ts");
  assert.match(dispatcher, /export default async function dispatch/);
  assert.match(dispatcher, /export function resolveRoute/);
  // All 22 routes imported from their relocated modules, none re-declared inline.
  for (const specifier of [
    "auth/pair", "auth/revoke", "clips", "media/index", "media/check-hash",
    "media/upload-authorize", "media/finalize", "media/[id]", "media/public/[publicId]",
    "media/[id]/restore-authorize", "media/[id]/restore-finalize", "archive/jobs",
    "archive/[id]/start", "archive/[id]/complete", "archive/[id]/fail",
    "archive/[id]/download-authorize", "archive/[id]/remove-cloud-original",
    "media/archive/auth/login", "media/archive/auth/logout", "media/archive/list",
    "media/archive/[id]/play", "media/archive/[id]/download",
    "camera/auth/login", "camera/auth/logout", "camera/upload-authorize", "camera/finalize",
    "camera/archive/list", "camera/archive/budget", "camera/archive/[id]/play",
    "camera/archive/[id]/download", "camera/archive/[id]/protect", "camera/archive/[id]/unprotect",
    "camera/maintenance/cleanup",
  ]) {
    // ".js" is required on the specifier for native Node ESM (Vercel runs this as a real ES
    // module, not bundled) even though the actual source file is .ts.
    assert.match(dispatcher, new RegExp(`from "\\.\\./server/media-api/routes/${specifier.replace(/[[\]]/g, "\\$&")}\\.js"`), `missing import for ${specifier}`);
  }
  assert.doesNotMatch(dispatcher, /requireDevice|requireMethod|createDb|presignUpload/, "dispatcher must not reimplement route logic");
  assert.match(dispatcher, /__kcx_path/, "dispatcher must reverse the vercel.json __kcx_path rewrite");
});

test("vercel.json rewrites /api/:path* to /api/router before the SPA catch-all, and leaves NEXUS untouched", () => {
  const vercel = JSON.parse(source("vercel.json"));
  const rewrites = vercel.rewrites;
  const apiIndex = rewrites.findIndex((rule) => rule.source === "/api/:path*");
  const spaIndex = rewrites.findIndex((rule) => rule.destination === "/index.html");
  const nexusAssetsIndex = rewrites.findIndex((rule) => rule.source === "/nexus/assets/(.*)");
  assert.notEqual(apiIndex, -1, "the /api/:path* rewrite is missing");
  assert.equal(rewrites[apiIndex].destination, "/api/router?__kcx_path=:path*");
  assert.ok(apiIndex < spaIndex, "the /api rewrite must come before the SPA catch-all");
  assert.notEqual(nexusAssetsIndex, -1, "the /nexus/assets rewrite must be preserved");
  assert.deepEqual(vercel.redirects, [
    { source: "/snapcal", destination: "/snapcal/", permanent: false },
    { source: "/nexus-cloud", destination: "/nexus", permanent: true },
    { source: "/nexus-cloud/portal", destination: "/nexus/portal", permanent: true },
  ]);
});

// ─── Pure routing: every canonical URL resolves to a distinct handler ───────

const canonicalUrls = [
  "/api/auth/pair",
  "/api/auth/revoke",
  "/api/clips",
  "/api/media",
  "/api/media/check-hash",
  "/api/media/upload-authorize",
  "/api/media/finalize",
  "/api/media/abc123",
  "/api/media/public/pub456",
  "/api/media/abc123/restore-authorize",
  "/api/media/abc123/restore-finalize",
  "/api/archive/jobs",
  "/api/archive/xyz789/start",
  "/api/archive/xyz789/complete",
  "/api/archive/xyz789/fail",
  "/api/archive/xyz789/download-authorize",
  "/api/archive/xyz789/remove-cloud-original",
  "/api/media/archive/auth/login",
  "/api/media/archive/auth/logout",
  "/api/media/archive/list",
  "/api/media/archive/abc123/play",
  "/api/media/archive/abc123/download",
  "/api/camera/auth/login",
  "/api/camera/auth/logout",
  "/api/camera/upload-authorize",
  "/api/camera/finalize",
  "/api/camera/archive/list",
  "/api/camera/archive/budget",
  "/api/camera/archive/abc123/play",
  "/api/camera/archive/abc123/download",
  "/api/camera/archive/abc123/protect",
  "/api/camera/archive/abc123/unprotect",
  "/api/camera/maintenance/cleanup",
];

test("every one of the 33 real URLs resolves to a real (non-null) handler", () => {
  for (const url of canonicalUrls) {
    assert.notEqual(resolveRoute(url), null, `${url} did not resolve`);
  }
});

test("every resolved route is a distinct handler (no accidental aliasing between routes)", () => {
  const handlers = canonicalUrls.map(resolveRoute);
  assert.equal(new Set(handlers).size, canonicalUrls.length);
});

test("resolveRoute is stable: the same URL always resolves to the same handler reference", () => {
  assert.equal(resolveRoute("/api/clips"), resolveRoute("/api/clips"));
});

test("static routes take precedence over the same-shape dynamic media/<id> pattern", () => {
  // "check-hash", "upload-authorize", and "finalize" must never be captured as a media id.
  assert.equal(resolveRoute("/api/media/check-hash"), resolveRoute("/api/media/check-hash"));
  assert.notEqual(resolveRoute("/api/media/check-hash"), resolveRoute("/api/media/some-real-id"));
  assert.notEqual(resolveRoute("/api/media/upload-authorize"), resolveRoute("/api/media/some-real-id"));
  assert.notEqual(resolveRoute("/api/media/finalize"), resolveRoute("/api/media/some-real-id"));
});

test("a trailing slash and a request without the /api prefix resolve identically", () => {
  assert.equal(resolveRoute("/api/clips/"), resolveRoute("/api/clips"));
  assert.equal(resolveRoute("clips"), resolveRoute("/api/clips"));
});

test("unknown paths and near-miss shapes resolve to null", () => {
  for (const url of ["/api/unknown", "/api/media/abc/def/ghi", "/api/archive", "/api/media/abc/not-a-real-action", "/"]) {
    assert.equal(resolveRoute(url), null, `${url} should not resolve`);
  }
});

test("clips and the public media route resolve (proven without invoking them live, since neither has an auth gate before touching the database)", () => {
  assert.notEqual(resolveRoute("/api/clips"), null);
  assert.notEqual(resolveRoute("/api/media/public/anyPublicId"), null);
});

// ─── Live dispatch: routing reaches the real handler for every safe route ───

test("unknown /api path returns 404 through the real dispatcher, not a hang", NO_HANG, async () => {
  const { status, body } = await run({ method: "GET", url: "/api/does-not-exist" });
  assert.equal(status, 404);
  assert.deepEqual(JSON.parse(body), { error: "not_found" });
});

test("a wrong HTTP method on a routed path still gets the route's own method rejection, not a 404", NO_HANG, async () => {
  const { status, headers } = await run({ method: "GET", url: "/api/auth/pair" });
  assert.equal(status, 405);
  assert.equal(headers.allow, "POST");
});

test("request bodies survive dispatch: a differentiated 400 vs 401 proves the real body was read", NO_HANG, async () => {
  const malformed = await run({ method: "POST", url: "/api/auth/pair", body: JSON.stringify({}) });
  assert.equal(malformed.status, 400);

  const wrongCredentials = await run({
    method: "POST",
    url: "/api/auth/pair",
    body: JSON.stringify({ email: "not-the-owner@example.test", password: "x", deviceName: "probe" }),
  });
  assert.equal(wrongCredentials.status, 401);
  assert.deepEqual(JSON.parse(wrongCredentials.body), { error: "invalid_credentials" });
});

test("query strings survive dispatch: a query string never breaks routing to the real handler", NO_HANG, async () => {
  const { status } = await run({ method: "GET", url: "/api/archive/jobs?limit=5&offset=10" });
  assert.equal(status, 401); // reaches requireDevice, not a 404 — the query string did not confuse routing.
});

test("the Authorization header survives dispatch: its absence and presence reach requireDevice differently", NO_HANG, async () => {
  const missing = await run({ method: "POST", url: "/api/media/check-hash", body: JSON.stringify({ sha256: "a".repeat(64) }) });
  assert.equal(missing.status, 401);
  assert.deepEqual(JSON.parse(missing.body), { error: "unauthorized" });

  // A present (if fake) token clears the null-token short-circuit and reaches the device-token
  // lookup, which fails fast against this synthetic, unreachable database — proving the header
  // value itself, not just its absence, reached the real handler through the dispatcher.
  const present = await run({
    method: "POST",
    url: "/api/media/check-hash",
    headers: { host: HOST, authorization: "Bearer some-fake-token" },
    body: JSON.stringify({ sha256: "a".repeat(64) }),
  });
  assert.equal(present.status, 500);
  assert.deepEqual(JSON.parse(present.body), { error: "internal_error" });
});

test("dynamic media/<id> ids survive dispatch regardless of value", NO_HANG, async () => {
  for (const id of ["simple123", "with-dashes-456", "med_abcXYZ789"]) {
    const { status } = await run({ method: "GET", url: `/api/media/${id}` });
    assert.equal(status, 401, `id "${id}" did not reach requireDevice`);
  }
});

test("dynamic archive/<id>/start ids survive dispatch regardless of value", NO_HANG, async () => {
  for (const id of ["AAA111", "BBB-222_test", "med_longerIdValue999"]) {
    const { status } = await run({ method: "POST", url: `/api/archive/${id}/start` });
    assert.equal(status, 401, `id "${id}" did not reach requireDevice`);
  }
});

const safeRoutes = [
  { name: "auth/revoke", method: "POST", url: "/api/auth/revoke", body: JSON.stringify({ deviceTokenId: "x" }) },
  { name: "media (list)", method: "GET", url: "/api/media" },
  { name: "media/check-hash", method: "POST", url: "/api/media/check-hash", body: JSON.stringify({ sha256: "a".repeat(64) }) },
  { name: "media/upload-authorize", method: "POST", url: "/api/media/upload-authorize", body: JSON.stringify({ filename: "clip.mp4", sizeBytes: 1024, sha256: "a".repeat(64) }) },
  { name: "media/finalize", method: "POST", url: "/api/media/finalize", body: JSON.stringify({ mediaId: "x" }) },
  { name: "media/<id> (item)", method: "GET", url: "/api/media/some-id" },
  { name: "media/<id>/restore-authorize", method: "POST", url: "/api/media/some-id/restore-authorize", body: JSON.stringify({}) },
  { name: "media/<id>/restore-finalize", method: "POST", url: "/api/media/some-id/restore-finalize" },
  { name: "archive/jobs", method: "GET", url: "/api/archive/jobs" },
  { name: "archive/<id>/start", method: "POST", url: "/api/archive/some-id/start" },
  { name: "archive/<id>/complete", method: "POST", url: "/api/archive/some-id/complete", body: JSON.stringify({}) },
  { name: "archive/<id>/fail", method: "POST", url: "/api/archive/some-id/fail", body: JSON.stringify({ reason: "x" }) },
  { name: "archive/<id>/download-authorize", method: "POST", url: "/api/archive/some-id/download-authorize" },
  { name: "archive/<id>/remove-cloud-original", method: "POST", url: "/api/archive/some-id/remove-cloud-original" },
];

for (const route of safeRoutes) {
  test(`${route.name}: reached and rejected unauthenticated through the real dispatcher, not a hang`, NO_HANG, async () => {
    const { status, ended } = await run(route);
    assert.equal(ended, true);
    assert.equal(status, 401);
  });
}

test("auth/pair: reached through the real dispatcher, not a hang (no auth gate — validated by its own credential check instead)", NO_HANG, async () => {
  const { status, ended } = await run({ method: "POST", url: "/api/auth/pair", body: JSON.stringify({}) });
  assert.equal(ended, true);
  assert.equal(status, 400);
});

test("vercel.json schedules exactly one Hobby-compatible daily cron: the camera cleanup, outside the 6AM-10PM LA recording window", () => {
  const vercel = JSON.parse(source("vercel.json"));
  assert.deepEqual(vercel.crons, [{ path: "/api/camera/maintenance/cleanup", schedule: "17 11 * * *" }]);
  const [minute, hour, dom, month, dow] = vercel.crons[0].schedule.split(" ");
  // Hobby allows at most one run per day: fixed minute and hour, every day.
  assert.match(minute, /^\d+$/);
  assert.match(hour, /^\d+$/);
  assert.deepEqual([dom, month, dow], ["*", "*", "*"]);
  // 11:17 UTC is 03:17 PST / 04:17 PDT; Hobby may fire anywhere in that hour, still before 06:00 LA.
  assert.ok(Number(hour) === 11, "keep the run inside the overnight gap in both PST and PDT");
  assert.equal(vercel.functions, undefined, "project-wide function settings (e.g. maxDuration) are left to the dashboard default");
});

test("a Vercel Cron call to /api/camera/maintenance/cleanup survives the production rewrite and reaches the CRON_SECRET gate (401 without it)", NO_HANG, async () => {
  const { status, body } = await run({ method: "GET", url: rewrittenUrl("camera/maintenance/cleanup") });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("through the production rewrite, the cleanup route accepts only the exact CRON_SECRET bearer, then fails closed without camera R2 credentials", NO_HANG, async () => {
  const secret = "s".repeat(48);
  const saved = { cron: process.env.CRON_SECRET, id: process.env.CAMERA_R2_ACCESS_KEY_ID, key: process.env.CAMERA_R2_SECRET_ACCESS_KEY };
  process.env.CRON_SECRET = secret;
  delete process.env.CAMERA_R2_ACCESS_KEY_ID;
  delete process.env.CAMERA_R2_SECRET_ACCESS_KEY;
  try {
    const url = rewrittenUrl("camera/maintenance/cleanup");
    const wrong = await run({ method: "GET", url, headers: { host: HOST, authorization: `Bearer ${"x".repeat(48)}` } });
    assert.equal(wrong.status, 401);
    const noScheme = await run({ method: "GET", url, headers: { host: HOST, authorization: secret } });
    assert.equal(noScheme.status, 401);
    const cron = await run({ method: "GET", url, headers: { host: HOST, authorization: `Bearer ${secret}`, "user-agent": "vercel-cron/1.0" } });
    assert.equal(cron.status, 503, "authenticated, then closed because camera R2 credentials are absent");
    assert.deepEqual(JSON.parse(cron.body), { error: "camera_storage_unconfigured" });
  } finally {
    for (const [k, v] of [["CRON_SECRET", saved.cron], ["CAMERA_R2_ACCESS_KEY_ID", saved.id], ["CAMERA_R2_SECRET_ACCESS_KEY", saved.key]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ─── vercel.json rewrite reconstruction: /api/router?__kcx_path=... ─────────
//
// Every case below sends the request in the shape Vercel's rewrite actually produces
// (`rewrittenUrl(...)`), not the direct `/api/...` shape the tests above use, proving the
// dispatcher's reconstruction — not just its routing table — works end to end.

test("the exact example from the task: /api/media/abc123/restore-authorize?foo=bar reconstructs exactly", NO_HANG, async () => {
  const req = fakeRequest({
    method: "POST",
    url: rewrittenUrl("media/abc123/restore-authorize", "foo=bar"),
    headers: { host: HOST },
    body: JSON.stringify({}),
  });
  const res = fakeResponse();
  await dispatch(req, res);
  assert.equal(req.url, "/api/media/abc123/restore-authorize?foo=bar");
  assert.equal(res.statusCode, 401); // reaches requireDevice — the reconstructed URL routed correctly.
});

test("a rewritten static route (auth/pair) reaches the real handler, not a 404", NO_HANG, async () => {
  const { status } = await run({ method: "POST", url: rewrittenUrl("auth/pair"), body: JSON.stringify({}) });
  assert.equal(status, 400); // same malformed-body rejection as the direct-URL case.
});

test("a rewritten dynamic media/<id> route reaches the real handler, not a 404", NO_HANG, async () => {
  const { status } = await run({ method: "GET", url: rewrittenUrl("media/some-real-id") });
  assert.equal(status, 401);
});

test("a rewritten dynamic archive/<id>/start route reaches the real handler, not a 404", NO_HANG, async () => {
  const { status } = await run({ method: "POST", url: rewrittenUrl("archive/some-real-id/start") });
  assert.equal(status, 401);
});

test("original query strings survive the rewrite, and __kcx_path is removed before downstream handling", NO_HANG, async () => {
  const { status, req } = await run({ method: "GET", url: rewrittenUrl("archive/jobs", "limit=5&offset=10") });
  assert.equal(status, 401); // not a 404 — the query string alongside __kcx_path did not confuse routing.
  assert.equal(req.url, "/api/archive/jobs?limit=5&offset=10");
  assert.ok(!req.url.includes("__kcx_path"), "__kcx_path leaked into the reconstructed URL");
});

test("a POST body survives the rewrite untouched: a differentiated 400 vs 401 proves the real body was read", NO_HANG, async () => {
  const malformed = await run({ method: "POST", url: rewrittenUrl("auth/pair"), body: JSON.stringify({}) });
  assert.equal(malformed.status, 400);

  const wrongCredentials = await run({
    method: "POST",
    url: rewrittenUrl("auth/pair"),
    body: JSON.stringify({ email: "not-the-owner@example.test", password: "x", deviceName: "probe" }),
  });
  assert.equal(wrongCredentials.status, 401);
  assert.deepEqual(JSON.parse(wrongCredentials.body), { error: "invalid_credentials" });
});

test("the Authorization header survives the rewrite untouched", NO_HANG, async () => {
  const missing = await run({
    method: "POST",
    url: rewrittenUrl("media/check-hash"),
    body: JSON.stringify({ sha256: "a".repeat(64) }),
  });
  assert.equal(missing.status, 401);
  assert.deepEqual(JSON.parse(missing.body), { error: "unauthorized" });

  // Same technique as the direct-URL Authorization test: a present token clears the null-token
  // short-circuit and reaches the device-token DB lookup, which fails fast against this synthetic,
  // unreachable database — proving the header value reached the real handler through the rewrite.
  const present = await run({
    method: "POST",
    url: rewrittenUrl("media/check-hash"),
    headers: { host: HOST, authorization: "Bearer some-fake-token" },
    body: JSON.stringify({ sha256: "a".repeat(64) }),
  });
  assert.equal(present.status, 500);
  assert.deepEqual(JSON.parse(present.body), { error: "internal_error" });
});

test("an unknown route still 404s when sent in the rewritten shape", NO_HANG, async () => {
  const { status, body } = await run({ method: "GET", url: rewrittenUrl("does-not-exist") });
  assert.equal(status, 404);
  assert.deepEqual(JSON.parse(body), { error: "not_found" });
});

test("a direct invocation with no __kcx_path (vercel dev, or bypassing the rewrite) leaves req.url untouched", NO_HANG, async () => {
  const { req } = await run({ method: "GET", url: "/api/archive/jobs" });
  assert.equal(req.url, "/api/archive/jobs");
});
