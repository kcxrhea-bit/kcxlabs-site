/**
 * POST /api/snapcal/v1/ocr/appointment — route-level tests, same approach as
 * tests/snapcal-routes.test.mjs: exercised through the real `toNodeHandler`
 * adapter and real `requireDevice()` auth. No live database is used, so —
 * matching every other authenticated SnapCal route's test coverage in this
 * repo — a request WITH a bearer token can only be proven to have reached
 * real device-token verification (it fails at 500 against the synthetic,
 * unreachable DATABASE_URL), not proven to pass it. Request-body validation
 * that runs after auth is covered directly against `validateOcrRequest` in
 * tests/snapcal-ocr-validate.test.mjs instead, with no auth involved.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fakeRequest, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";

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
const VALID_BASE64_IMAGE = Buffer.from("not-a-real-jpeg-but-non-empty").toString("base64");

/**
 * esbuild's CJS output for a module that only does `export default X` is
 * sometimes reachable at `module.default` and sometimes at
 * `module.default.default` depending on whether Node's cjs-module-lexer has
 * already run for this process — same defensive unwrap
 * tests/api-dispatch-routing.test.mjs already uses.
 */
function unwrapDefault(mod) {
  return typeof mod.default === "function" ? mod.default : mod.default.default;
}

async function run(routeModule, options) {
  const nodeHandler = unwrapDefault(routeModule);
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await nodeHandler(req, res);
  return { status: res.statusCode, body: res.ended ? bodyOf(res) : null, ended: res.ended };
}

async function loadRoute() {
  return import("../dist-electron/routes/ocr/appointment.cjs");
}

test("wrong method is rejected before auth", NO_HANG, async () => {
  const route = await loadRoute();
  const { status } = await run(route, { method: "GET", url: "/api/snapcal/v1/ocr/appointment" });
  assert.equal(status, 405);
});

test("unauthenticated request (no Authorization header) is rejected with 401 before touching config or Vision", NO_HANG, async () => {
  const route = await loadRoute();
  const { status, body } = await run(route, {
    method: "POST",
    url: "/api/snapcal/v1/ocr/appointment",
    body: JSON.stringify({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE }),
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("a malformed Authorization header is rejected with 401, not a hang", NO_HANG, async () => {
  const route = await loadRoute();
  const { status } = await run(route, {
    method: "POST",
    url: "/api/snapcal/v1/ocr/appointment",
    headers: { host: HOST, authorization: "NotBearer garbage" },
    body: JSON.stringify({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE }),
  });
  assert.equal(status, 401);
});

test("a present (if fake) bearer token clears the null-token short-circuit and reaches real device-token verification — proven by a 500 against the synthetic, unreachable database, the same technique tests/api-dispatch-routing.test.mjs uses for every other authenticated route", NO_HANG, async () => {
  const route = await loadRoute();
  const { status, ended } = await run(route, {
    method: "POST",
    url: "/api/snapcal/v1/ocr/appointment",
    headers: { host: HOST, authorization: "Bearer some-fake-token" },
    body: JSON.stringify({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE }),
  });
  assert.equal(ended, true);
  assert.equal(status, 500);
});

test("api/router: /api/snapcal/v1/ocr/appointment resolves to this route's own handler, distinct from every other route", async () => {
  const { resolveRoute } = await import("../dist-electron/api-dispatch.cjs");
  const ocrHandler = resolveRoute("/api/snapcal/v1/ocr/appointment");
  assert.notEqual(ocrHandler, null);
  assert.notEqual(ocrHandler, resolveRoute("/api/snapcal/v1/calendars"));
  assert.notEqual(ocrHandler, resolveRoute("/api/snapcal/v1/events"));
});
