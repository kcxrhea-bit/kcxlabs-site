/**
 * QR / short-code device pairing: pure primitives from
 * server/snapcal-api/_lib/pairing.ts (dependency-free, no Postgres), plus the
 * three new route handlers' pre-database gates — method checks, request
 * validation, and the auth gate on the two browser-facing routes — mirroring
 * the "DB-free tests only" convention used throughout this suite (see
 * tests/snapcal-auth.test.mjs's header comment).
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

async function run(routeModule, options) {
  const nodeHandler = routeModule.default;
  const req = fakeRequest({ headers: { host: HOST }, ...options });
  const res = fakeResponse();
  await nodeHandler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.ended ? bodyOf(res) : null, ended: res.ended };
}

// ─── Pure primitives (server/snapcal-api/_lib/pairing.ts) ───────────────────

const pairingLib = await import("../dist-electron/lib/snapcal-pairing.cjs");

test("generatePairingSecret: 32 random bytes, base64url, unique across calls", () => {
  const a = pairingLib.generatePairingSecret();
  const b = pairingLib.generatePairingSecret();
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /[+/=]/, "must be base64url, not base64");
});

test("generatePairingCode: six digits, space-separated as XXX XXX", () => {
  const code = pairingLib.generatePairingCode();
  assert.match(code, /^\d{3} \d{3}$/);
});

test("normalizePairingCode: strips spaces and non-digit formatting", () => {
  assert.equal(pairingLib.normalizePairingCode("482 731"), "482731");
  assert.equal(pairingLib.normalizePairingCode("482-731"), "482731");
  assert.equal(pairingLib.normalizePairingCode("482731"), "482731");
});

test("hashPairingSecret/hashPairingCode: deterministic SHA-256 hex, never the raw value", () => {
  const secretHash = pairingLib.hashPairingSecret("my-secret");
  assert.match(secretHash, /^[0-9a-f]{64}$/);
  assert.equal(secretHash, pairingLib.hashPairingSecret("my-secret"));
  assert.notEqual(secretHash, "my-secret");

  const codeHash = pairingLib.hashPairingCode("482731");
  assert.match(codeHash, /^[0-9a-f]{64}$/);
});

test("digestsMatch: constant-time equality, rejects mismatched length or content", () => {
  const hash = pairingLib.hashPairingCode("482731");
  assert.ok(pairingLib.digestsMatch(hash, hash));
  assert.ok(!pairingLib.digestsMatch(hash, pairingLib.hashPairingCode("999999")));
  assert.ok(!pairingLib.digestsMatch(hash, "ab"));
});

test("pairingSessionExpiry: five minutes from now", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const expiry = pairingLib.pairingSessionExpiry(now);
  assert.equal(Date.parse(expiry) - now.getTime(), 5 * 60 * 1000);
});

test("pairingSessionStatus: null record is expired, redeemed is connected, past expiry is expired, otherwise waiting", () => {
  const now = new Date("2026-01-01T00:10:00.000Z");
  const base = { id: "pcs_1", ownerId: "owner_kcx", secretHash: "x", codeHash: "y", attemptCount: 0, deviceTokenId: null };

  assert.equal(pairingLib.pairingSessionStatus(null, now), "expired");
  assert.equal(
    pairingLib.pairingSessionStatus({ ...base, expiresAt: "2026-01-01T00:20:00.000Z", redeemedAt: "2026-01-01T00:05:00.000Z" }, now),
    "connected",
  );
  assert.equal(
    pairingLib.pairingSessionStatus({ ...base, expiresAt: "2026-01-01T00:05:00.000Z", redeemedAt: null }, now),
    "expired",
  );
  assert.equal(
    pairingLib.pairingSessionStatus({ ...base, expiresAt: "2026-01-01T00:20:00.000Z", redeemedAt: null }, now),
    "waiting",
  );
});

test("pairingSessionRedeemable: false once redeemed, expired, or attempt-limited", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = "2026-01-01T00:05:00.000Z";
  const past = "2025-12-31T23:55:00.000Z";
  const base = { id: "pcs_1", ownerId: "owner_kcx", secretHash: "x", codeHash: "y", deviceTokenId: null };

  assert.ok(pairingLib.pairingSessionRedeemable({ ...base, expiresAt: future, redeemedAt: null, attemptCount: 0 }, now));
  assert.ok(!pairingLib.pairingSessionRedeemable({ ...base, expiresAt: future, redeemedAt: now.toISOString(), attemptCount: 0 }, now));
  assert.ok(!pairingLib.pairingSessionRedeemable({ ...base, expiresAt: past, redeemedAt: null, attemptCount: 0 }, now));
  assert.ok(
    !pairingLib.pairingSessionRedeemable(
      { ...base, expiresAt: future, redeemedAt: null, attemptCount: pairingLib.MAX_CODE_ATTEMPTS },
      now,
    ),
  );
});

test("buildPairingQrPayload: carries protocol/version/origin/session id/secret, nothing more sensitive", () => {
  const payload = pairingLib.buildPairingQrPayload({
    origin: "https://kcxlabs.org",
    sessionId: "pcs_abc",
    secret: "the-secret",
  });
  assert.deepEqual(payload, {
    p: pairingLib.PAIRING_PROTOCOL,
    v: pairingLib.PAIRING_PROTOCOL_VERSION,
    origin: "https://kcxlabs.org",
    sid: "pcs_abc",
    s: "the-secret",
  });
  // No password, no long-lived device token, no Neon/Google credentials — the
  // payload is exactly these five fields.
  assert.deepEqual(Object.keys(payload).sort(), ["origin", "p", "s", "sid", "v"]);
});

// ─── POST /api/snapcal/v1/auth/pair/session ─────────────────────────────────

test("pair/session: wrong method is rejected", NO_HANG, async () => {
  const { default: pairSession } = await import("../dist-electron/routes/auth/pair-session.cjs");
  const { status } = await run(pairSession, { method: "GET", url: "/api/snapcal/v1/auth/pair/session" });
  assert.equal(status, 405);
});

test("pair/session: no bearer token and no session cookie is 401 before any database access", NO_HANG, async () => {
  const { default: pairSession } = await import("../dist-electron/routes/auth/pair-session.cjs");
  const { status, body } = await run(pairSession, { method: "POST", url: "/api/snapcal/v1/auth/pair/session", body: "{}" });
  assert.equal(status, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

// ─── GET /api/snapcal/v1/auth/pair/session/<id> ─────────────────────────────

test("pair/session/<id> status: wrong method is rejected", NO_HANG, async () => {
  const { default: status } = await import("../dist-electron/routes/auth/pair-session-status.cjs");
  const { status: httpStatus } = await run(status, { method: "POST", url: "/api/snapcal/v1/auth/pair/session/pcs_1" });
  assert.equal(httpStatus, 405);
});

test("pair/session/<id> status: no session cookie is 401 before any database access", NO_HANG, async () => {
  const { default: status } = await import("../dist-electron/routes/auth/pair-session-status.cjs");
  const { status: httpStatus, body } = await run(status, { method: "GET", url: "/api/snapcal/v1/auth/pair/session/pcs_1" });
  assert.equal(httpStatus, 401);
  assert.deepEqual(JSON.parse(body), { error: "unauthorized" });
});

// ─── POST /api/snapcal/v1/auth/pair/redeem ──────────────────────────────────
// Intentionally unauthenticated (the Android device has no credential yet) —
// every case here is a validation short-circuit that returns before any
// database access, exactly like auth/pair.ts's own malformed-body test.

test("pair/redeem: wrong method is rejected", NO_HANG, async () => {
  const { default: redeem } = await import("../dist-electron/routes/auth/pair-redeem.cjs");
  const { status } = await run(redeem, { method: "GET", url: "/api/snapcal/v1/auth/pair/redeem" });
  assert.equal(status, 405);
});

test("pair/redeem: missing deviceName is a 400, not a hang", NO_HANG, async () => {
  const { default: redeem } = await import("../dist-electron/routes/auth/pair-redeem.cjs");
  const { status, body } = await run(redeem, {
    method: "POST",
    url: "/api/snapcal/v1/auth/pair/redeem",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ code: "482731" }),
  });
  assert.equal(status, 400);
  assert.deepEqual(JSON.parse(body), { error: "invalid_request" });
});

test("pair/redeem: neither sessionId+secret nor code supplied is a 400", NO_HANG, async () => {
  const { default: redeem } = await import("../dist-electron/routes/auth/pair-redeem.cjs");
  const { status, body } = await run(redeem, {
    method: "POST",
    url: "/api/snapcal/v1/auth/pair/redeem",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ deviceName: "Pixel" }),
  });
  assert.equal(status, 400);
  assert.deepEqual(JSON.parse(body), { error: "invalid_request" });
});

test("pair/redeem: malformed (non-6-digit) fallback code is a 400 before any database access", NO_HANG, async () => {
  const { default: redeem } = await import("../dist-electron/routes/auth/pair-redeem.cjs");
  const { status, body } = await run(redeem, {
    method: "POST",
    url: "/api/snapcal/v1/auth/pair/redeem",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify({ deviceName: "Pixel", code: "12" }),
  });
  assert.equal(status, 400);
  assert.deepEqual(JSON.parse(body), { error: "invalid_request" });
});
