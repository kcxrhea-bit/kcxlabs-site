import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  hashPassword,
  verifyPassword,
  hashDeviceToken,
  tokenHashesMatch,
  bearerToken,
  verifyDeviceTokenRecord,
  deviceTokenExpiry,
  signSession,
  verifySignedSession,
  generatePublicId,
  generateDeviceToken,
  describeConfig,
  redactSecrets,
  ConfigError,
  loadDatabaseConfig,
  loadR2Config,
  loadAnalyticsConfig,
  loadLimitsConfig,
} from "../dist-electron/api-core.cjs";

// ─── Password hashing ────────────────────────────────────────────────────────

test("a password verifies against its own scrypt hash and nothing else", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.match(hash, /^scrypt\$32768\$8\$1\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword("correct-horse-battery-staple", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password hashes differently each time, so salts are per-hash", async () => {
  const a = await hashPassword("same-password-twice");
  const b = await hashPassword("same-password-twice");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password-twice", a), true);
  assert.equal(await verifyPassword("same-password-twice", b), true);
});

test("a malformed stored hash fails closed instead of throwing", async () => {
  for (const bad of ["", "not-a-hash", "scrypt$1$2$3", "bcrypt$1$2$3$4$5", "scrypt$x$y$z$aa$bb"]) {
    assert.equal(await verifyPassword("anything", bad), false, `input: ${bad}`);
  }
});

test("the plaintext password never appears in the stored hash", async () => {
  const hash = await hashPassword("SuperSecretPassword123");
  assert.ok(!hash.includes("SuperSecretPassword123"));
});

// ─── Device tokens ───────────────────────────────────────────────────────────

test("device tokens are high entropy and never repeat", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateDeviceToken()));
  assert.equal(tokens.size, 200);
  // 32 bytes base64url ≈ 43 characters.
  assert.ok(generateDeviceToken().length >= 42);
});

test("only the token hash is suitable for storage, and it is not reversible", () => {
  const token = generateDeviceToken();
  const hash = hashDeviceToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(token));
  // Deterministic, so lookup by hash works.
  assert.equal(hashDeviceToken(token), hash);
  assert.notEqual(hashDeviceToken(generateDeviceToken()), hash);
});

test("token hash comparison rejects mismatches and malformed input", () => {
  const hash = hashDeviceToken("abc");
  assert.equal(tokenHashesMatch(hash, hash), true);
  assert.equal(tokenHashesMatch(hash, hashDeviceToken("abd")), false);
  assert.equal(tokenHashesMatch(hash, "short"), false);
  assert.equal(tokenHashesMatch("", ""), true);
});

test("bearer tokens are parsed, and anything else yields null", () => {
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("bearer abc123"), "abc123");
  assert.equal(bearerToken("Basic abc123"), null);
  assert.equal(bearerToken("abc123"), null);
  assert.equal(bearerToken("Bearer   "), null);
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken(undefined), null);
});

const NOW = new Date("2026-08-10T12:00:00.000Z");
const validRecord = {
  id: "dev_1",
  ownerId: "owner_1",
  deviceName: "Desktop",
  expiresAt: null,
  revokedAt: null,
};

test("a valid unexpired token is accepted", () => {
  const result = verifyDeviceTokenRecord(validRecord, NOW);
  assert.equal(result.valid, true);
  assert.equal(result.record.ownerId, "owner_1");
});

test("an unknown token is rejected", () => {
  assert.deepEqual(verifyDeviceTokenRecord(null, NOW), { valid: false, reason: "unknown" });
});

test("a revoked token is rejected even if it has not expired", () => {
  const result = verifyDeviceTokenRecord(
    { ...validRecord, revokedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" },
    NOW,
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "revoked");
});

test("an expired token is rejected", () => {
  const result = verifyDeviceTokenRecord(
    { ...validRecord, expiresAt: "2026-08-09T00:00:00.000Z" },
    NOW,
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});

test("an unparseable expiry is treated as expired, never as no-expiry", () => {
  const result = verifyDeviceTokenRecord({ ...validRecord, expiresAt: "garbage" }, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});

test("issued tokens expire by default rather than living forever", () => {
  const expiry = deviceTokenExpiry(NOW);
  assert.ok(Date.parse(expiry) > NOW.getTime());
  assert.equal(verifyDeviceTokenRecord({ ...validRecord, expiresAt: expiry }, NOW).valid, true);
});

// ─── Session signing ─────────────────────────────────────────────────────────

test("a signed session round-trips and rejects tampering", () => {
  const secret = "s".repeat(48);
  const signed = signSession("owner_1", secret);
  assert.equal(verifySignedSession(signed, secret), "owner_1");
  // Wrong secret.
  assert.equal(verifySignedSession(signed, "t".repeat(48)), null);
  // Tampered payload.
  assert.equal(verifySignedSession(signed.replace("owner_1", "owner_2"), secret), null);
  assert.equal(verifySignedSession("nosignature", secret), null);
});

// ─── Public ids ──────────────────────────────────────────────────────────────

test("public ids are high entropy, unique, and URL safe", () => {
  const ids = new Set(Array.from({ length: 2000 }, () => generatePublicId()));
  assert.equal(ids.size, 2000, "collision in 2000 generated ids");
  for (const id of [...ids].slice(0, 50)) {
    assert.equal(id.length, 16);
    assert.match(id, /^[0-9A-Za-z]{16}$/);
  }
});

test("public ids are not sequential or time ordered", () => {
  const a = generatePublicId();
  const b = generatePublicId();
  assert.notEqual(a, b);
  // No shared prefix implying a counter or timestamp.
  assert.notEqual(a.slice(0, 6), b.slice(0, 6));
});

// ─── Config loading and secret hygiene ───────────────────────────────────────

test("missing variables are named in the error, and no values are included", () => {
  try {
    loadDatabaseConfig({});
    assert.fail("expected a ConfigError");
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /DATABASE_URL/);
    assert.deepEqual(error.missing, ["DATABASE_URL"]);
  }
});

test("a malformed DATABASE_URL is rejected without echoing it", () => {
  try {
    loadDatabaseConfig({ DATABASE_URL: "mysql://user:hunter2@host/db" });
    assert.fail("expected a ConfigError");
  } catch (error) {
    assert.match(error.message, /DATABASE_URL/);
    assert.ok(!error.message.includes("hunter2"), "the error leaked the credential");
  }
});

test("R2 config derives the S3 endpoint and normalises the public host", () => {
  const config = loadR2Config({
    R2_ACCOUNT_ID: "acct123",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_PUBLIC_HOST: "https://media.kcxlabs.org/",
  });
  assert.equal(config.endpoint, "https://acct123.r2.cloudflarestorage.com");
  assert.equal(config.bucket, "kcxlabs-media");
  assert.equal(config.publicHost, "media.kcxlabs.org");
});

test("missing R2 credentials are all named at once", () => {
  try {
    loadR2Config({ R2_ACCOUNT_ID: "acct" });
    assert.fail("expected a ConfigError");
  } catch (error) {
    assert.deepEqual(error.missing, ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
  }
});

test("analytics config is optional, so a missing token degrades rather than breaks", () => {
  assert.equal(loadAnalyticsConfig({ R2_ACCOUNT_ID: "acct" }), null);
  assert.equal(loadAnalyticsConfig({ CLOUDFLARE_ANALYTICS_TOKEN: "tok" }), null);
  assert.deepEqual(loadAnalyticsConfig({ R2_ACCOUNT_ID: "acct", CLOUDFLARE_ANALYTICS_TOKEN: "tok" }), {
    apiToken: "tok",
    accountId: "acct",
  });
});

test("a malformed limit falls back to the safe default rather than to unlimited", () => {
  const limits = loadLimitsConfig({ MAX_UPLOAD_BYTES: "not-a-number" });
  assert.equal(limits.maxUploadBytes, 5 * 1024 * 1024 * 1024);
  assert.equal(loadLimitsConfig({ MAX_UPLOAD_BYTES: "-1" }).maxUploadBytes, 5 * 1024 * 1024 * 1024);
});

test("the uploads kill switch requires an explicit false to stay off", () => {
  assert.equal(loadLimitsConfig({}).uploadsDisabled, false);
  assert.equal(loadLimitsConfig({ UPLOADS_DISABLED: "true" }).uploadsDisabled, true);
  assert.equal(loadLimitsConfig({ UPLOADS_DISABLED: "false" }).uploadsDisabled, false);
});

test("the config report exposes presence and length, never values", () => {
  const report = describeConfig({
    DATABASE_URL: "postgres://user:hunter2@host/db",
    R2_SECRET_ACCESS_KEY: "super-secret-value",
  });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("hunter2"), "report leaked a credential");
  assert.ok(!serialized.includes("super-secret-value"), "report leaked a credential");

  const dbEntry = report.find((entry) => entry.key === "DATABASE_URL");
  assert.equal(dbEntry.present, true);
  assert.equal(dbEntry.secret, true);
  assert.equal(dbEntry.length, "postgres://user:hunter2@host/db".length);
});

test("redactSecrets removes configured secret values from arbitrary text", () => {
  const env = { R2_SECRET_ACCESS_KEY: "abcdef1234567890", SESSION_SECRET: "s".repeat(40) };
  const message = `Request failed using key abcdef1234567890 and ${"s".repeat(40)}`;
  const redacted = redactSecrets(message, env);
  assert.ok(!redacted.includes("abcdef1234567890"));
  assert.ok(!redacted.includes("s".repeat(40)));
  assert.match(redacted, /\[redacted:R2_SECRET_ACCESS_KEY\]/);
});

// ─── Repository and routing safety ───────────────────────────────────────────

test("the SPA catch-all rewrite excludes /api so functions are reachable", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const catchAll = vercel.rewrites.find((rule) => rule.destination === "/index.html");
  assert.ok(catchAll, "the SPA catch-all rewrite is missing");

  // Approximates Vercel's matching well enough to catch a regression in the
  // pattern. Real behaviour is confirmed against a deployment.
  const pattern = new RegExp(`^${catchAll.source}$`);
  for (const path of ["/beta", "/resume", "/c/N7hd4KpQ", "/clips", "/"]) {
    assert.ok(pattern.test(path), `SPA route stopped matching: ${path}`);
  }
  for (const path of ["/api/media", "/api/auth/pair", "/api/clips"]) {
    assert.ok(!pattern.test(path), `API route was swallowed by the SPA rewrite: ${path}`);
  }
});

test("the database layer binds parameters and never interpolates values into SQL", () => {
  const source = readFileSync(new URL("../server/media-api/_lib/db.ts", import.meta.url), "utf8");
  // A `${...}` inside a db`` template is a bound parameter; string concatenation
  // into a query would not be. Guard against the latter creeping in.
  assert.ok(!/db\.query\(\s*[`"'].*\$\{/s.test(source), "found interpolation into a raw query string");
  assert.ok(!/db`[^`]*'\s*\+/s.test(source), "found string concatenation inside a SQL template");
});
