/**
 * Proves the six routes converted in this pass (api/auth/pair.ts,
 * api/auth/revoke.ts, api/media/check-hash.ts, api/media/upload-authorize.ts,
 * api/media/finalize.ts, api/archive/jobs.ts) execute and return through the
 * real `toNodeHandler` adapter — not a reimplementation of it — instead of
 * hanging the way a bare Fetch-style export does under `vercel dev`.
 *
 * Every request here is deliberately unauthenticated or invalid so the route
 * short-circuits (400/401) before ever calling Neon or R2: no live
 * credentials are needed, and none of the env values below are real. A
 * 400/401 is a PASS — the point is proving the handler runs to completion,
 * not exercising the full authenticated path (that's covered live against
 * `vercel dev` separately, and by the unit tests in media-api-routes.test.mjs
 * for the validation logic itself).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fakeRequest, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";

// Synthetic only — shaped to pass config validation, never used to reach a
// real database or bucket because every case below returns before doing so.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost/test";
process.env.R2_ACCOUNT_ID ??= "test-account";
process.env.R2_ACCESS_KEY_ID ??= "test-key-id";
process.env.R2_SECRET_ACCESS_KEY ??= "test-secret";
process.env.R2_BUCKET ??= "test-bucket";
process.env.OWNER_EMAIL ??= "owner@example.test";
process.env.OWNER_PASSWORD_HASH ??= "scrypt$16384$8$1$74657374$74657374";
process.env.SESSION_SECRET ??= "a".repeat(64);

const HOST = "localhost:3456";

/** A route hanging would hang the whole suite; fail fast and loudly instead. */
const NO_HANG = { timeout: 5000 };

async function run(routeModule, options) {
  const nodeHandler = routeModule.default;
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await nodeHandler(req, res);
  return { status: res.statusCode, body: res.ended ? bodyOf(res) : null, ended: res.ended };
}

test("auth/pair: malformed body is rejected by real validation, not a hang", NO_HANG, async () => {
  const { default: pair } = await import("../dist-electron/routes/auth/pair.cjs");
  const { status, ended } = await run(pair, {
    method: "POST",
    url: "/api/auth/pair",
    body: JSON.stringify({}),
  });
  assert.equal(ended, true);
  assert.equal(status, 400);
});

test("auth/pair: wrong owner email is rejected by real credential validation, not a hang", NO_HANG, async () => {
  const { default: pair } = await import("../dist-electron/routes/auth/pair.cjs");
  const { status, body } = await run(pair, {
    method: "POST",
    url: "/api/auth/pair",
    body: JSON.stringify({ email: "not-the-owner@example.test", password: "whatever", deviceName: "test-device" }),
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "invalid_credentials" });
});

test("auth/revoke: unauthenticated request reaches real auth and returns 401, not a hang", NO_HANG, async () => {
  const { default: revoke } = await import("../dist-electron/routes/auth/revoke.cjs");
  const { status, body } = await run(revoke, {
    method: "POST",
    url: "/api/auth/revoke",
    body: JSON.stringify({ deviceTokenId: "does-not-matter" }),
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("media/check-hash: unauthenticated request reaches real auth and returns 401, not a hang", NO_HANG, async () => {
  const { default: checkHash } = await import("../dist-electron/routes/media/check-hash.cjs");
  const { status } = await run(checkHash, {
    method: "POST",
    url: "/api/media/check-hash",
    body: JSON.stringify({ sha256: "a".repeat(64) }),
  });
  assert.equal(status, 401);
});

test("media/upload-authorize: unauthenticated request reaches its real auth/validation layer, not a hang", NO_HANG, async () => {
  const { default: uploadAuthorize } = await import("../dist-electron/routes/media/upload-authorize.cjs");
  const { status, body } = await run(uploadAuthorize, {
    method: "POST",
    url: "/api/media/upload-authorize",
    body: JSON.stringify({ filename: "clip.mp4", sizeBytes: 1024, sha256: "a".repeat(64) }),
  });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

test("media/finalize: unauthenticated request reaches its real auth/validation layer, not a hang", NO_HANG, async () => {
  const { default: finalize } = await import("../dist-electron/routes/media/finalize.cjs");
  const { status } = await run(finalize, {
    method: "POST",
    url: "/api/media/finalize",
    body: JSON.stringify({ mediaId: "does-not-matter" }),
  });
  assert.equal(status, 401);
});

test("archive/jobs: unauthenticated GET reaches real auth and returns 401, not a hang", NO_HANG, async () => {
  const { default: jobs } = await import("../dist-electron/routes/archive/jobs.cjs");
  const { status } = await run(jobs, { method: "GET", url: "/api/archive/jobs" });
  assert.equal(status, 401);
});
