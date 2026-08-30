/**
 * Proves the SnapCal routes execute through the real `toNodeHandler`
 * adapter and their real auth/validation layer, mirroring
 * tests/api-auth-and-upload-routes.test.mjs's approach: every request here
 * is deliberately public, unauthenticated, or malformed so the route
 * short-circuits before ever calling Neon — no live database is needed.
 * (Revision-conflict / idempotent-retry / tombstone / cross-calendar
 * isolation behavior lives in server/snapcal-api/_lib/db.ts and is exercised
 * by the SQL itself; that requires a live Postgres connection, matching
 * this repo's existing convention of not hitting one from these tests.)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fakeRequest, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";

// Synthetic only — shaped to pass config validation, never used to reach a
// real database because every case below returns before doing so.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost/test";
process.env.R2_ACCOUNT_ID ??= "test-account";
process.env.R2_ACCESS_KEY_ID ??= "test-key-id";
process.env.R2_SECRET_ACCESS_KEY ??= "test-secret";
process.env.R2_BUCKET ??= "test-bucket";
process.env.OWNER_EMAIL ??= "owner@example.test";
process.env.OWNER_PASSWORD_HASH ??= "scrypt$16384$8$1$74657374$74657374";
process.env.SESSION_SECRET ??= "a".repeat(64);

const HOST = "localhost:3456";
const NO_HANG = { timeout: 5000 };

async function run(routeModule, options) {
  const nodeHandler = routeModule.default;
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await nodeHandler(req, res);
  return { status: res.statusCode, body: res.ended ? bodyOf(res) : null, ended: res.ended };
}

test("snapcal/health: public GET returns 200 with the version contract, no auth needed", NO_HANG, async () => {
  const { default: health } = await import("../dist-electron/routes/health.cjs");
  const { status, body } = await run(health, { method: "GET", url: "/api/snapcal/v1/health" });
  assert.equal(status, 200);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.service, "SnapCal");
  assert.equal(parsed.apiVersion, 1);
  // Privacy: only these known-safe fields, never anything database- or credential-shaped.
  assert.deepEqual(Object.keys(parsed).sort(), ["apiVersion", "ok", "service", "status"]);
});

test("snapcal/health: wrong method is rejected", NO_HANG, async () => {
  const { default: health } = await import("../dist-electron/routes/health.cjs");
  const { status } = await run(health, { method: "POST", url: "/api/snapcal/v1/health" });
  assert.equal(status, 405);
});

test("snapcal/calendars: unauthenticated GET reaches real auth and returns 401, not a hang", NO_HANG, async () => {
  const { default: calendars } = await import("../dist-electron/routes/calendars.cjs");
  const { status, body } = await run(calendars, { method: "GET", url: "/api/snapcal/v1/calendars" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("snapcal/calendars: malformed Authorization header is rejected, not a hang", NO_HANG, async () => {
  const { default: calendars } = await import("../dist-electron/routes/calendars.cjs");
  const { status } = await run(calendars, {
    method: "GET",
    url: "/api/snapcal/v1/calendars",
    headers: { host: HOST, authorization: "Basic not-a-bearer-token" },
  });
  assert.equal(status, 401);
});

test("snapcal/events GET: unauthenticated request returns 401 before validating query params", NO_HANG, async () => {
  const { default: events } = await import("../dist-electron/routes/events/index.cjs");
  const { status } = await run(events, { method: "GET", url: "/api/snapcal/v1/events" });
  assert.equal(status, 401);
});

test("snapcal/events POST: unauthenticated request returns 401 before touching the database", NO_HANG, async () => {
  const { default: events } = await import("../dist-electron/routes/events/index.cjs");
  const { status } = await run(events, {
    method: "POST",
    url: "/api/snapcal/v1/events",
    body: JSON.stringify({ calendarId: "cal_x", title: "X", startAt: "2026-09-01T10:00:00.000Z", endAt: "2026-09-01T10:30:00.000Z" }),
  });
  assert.equal(status, 401);
});

test("snapcal/events: unsupported method is rejected with 405 after auth", NO_HANG, async () => {
  const { default: events } = await import("../dist-electron/routes/events/index.cjs");
  // Still unauthenticated here — 401 must win over 405 (auth is checked first for every method).
  const { status } = await run(events, { method: "PUT", url: "/api/snapcal/v1/events" });
  assert.equal(status, 401);
});

test("snapcal/events/[id] GET: unauthenticated request returns 401", NO_HANG, async () => {
  const { default: eventItem } = await import("../dist-electron/routes/events/[id].cjs");
  const { status } = await run(eventItem, { method: "GET", url: "/api/snapcal/v1/events/evt_123?calendarId=cal_x" });
  assert.equal(status, 401);
});

test("snapcal/events/[id] PATCH: unauthenticated request returns 401 before validating the patch body", NO_HANG, async () => {
  const { default: eventItem } = await import("../dist-electron/routes/events/[id].cjs");
  const { status } = await run(eventItem, {
    method: "PATCH",
    url: "/api/snapcal/v1/events/evt_123",
    body: JSON.stringify({ calendarId: "cal_x", expectedRevision: 1, title: "New" }),
  });
  assert.equal(status, 401);
});

test("snapcal/events/[id] DELETE: unauthenticated request returns 401", NO_HANG, async () => {
  const { default: eventItem } = await import("../dist-electron/routes/events/[id].cjs");
  const { status } = await run(eventItem, {
    method: "DELETE",
    url: "/api/snapcal/v1/events/evt_123",
    body: JSON.stringify({ calendarId: "cal_x", expectedRevision: 1 }),
  });
  assert.equal(status, 401);
});

test("api/router: every SnapCal URL resolves to a distinct, stable handler", NO_HANG, async () => {
  // Mirrors tests/api-dispatch-routing.test.mjs's own convention: resolveRoute
  // is compared against itself/other resolveRoute calls, never against a
  // separately-built standalone route bundle — dist-electron/routes/*.cjs and
  // api-dispatch.cjs are two independent esbuild outputs of the same source,
  // so their function objects are never reference-equal even when correct.
  const { resolveRoute } = await import("../dist-electron/api-dispatch.cjs");

  const urls = [
    "/api/snapcal/v1/health",
    "/api/snapcal/v1/calendars",
    "/api/snapcal/v1/events",
    "/api/snapcal/v1/events/evt_abc123",
  ];
  for (const url of urls) {
    assert.notEqual(resolveRoute(url), null, `${url} did not resolve`);
  }
  const handlers = urls.map(resolveRoute);
  assert.equal(new Set(handlers).size, handlers.length, "each SnapCal route must resolve to a distinct handler");

  assert.equal(resolveRoute("/api/snapcal/v1/health"), resolveRoute("/api/snapcal/v1/health"));
  assert.equal(resolveRoute("/api/snapcal/v1/events/evt_1"), resolveRoute("/api/snapcal/v1/events/evt_2"));
});

test("api/router: an unknown SnapCal-shaped path is not matched (returns null, not a wrong handler)", NO_HANG, async () => {
  const { resolveRoute } = await import("../dist-electron/api-dispatch.cjs");
  assert.equal(resolveRoute("/api/snapcal/v2/health"), null);
  assert.equal(resolveRoute("/api/snapcal/v1/events/evt_abc/extra"), null);
});
