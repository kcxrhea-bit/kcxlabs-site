/**
 * Unit tests for the Cloud Vision OAuth + annotate client
 * (server/snapcal-api/_lib/googleVisionAuth.ts, googleVision.ts), compiled
 * to dist-electron/lib/google-vision-{auth,}.cjs by scripts/build-electron.mjs.
 *
 * Every test injects a fake `fetch` — no real network call, no real
 * credential, ever. The service-account key used here is a throwaway RSA
 * key generated only for this test file (see TEST_PRIVATE_KEY), never a
 * real credential.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
void publicKey; // unused, generated only because the pair API requires requesting both

const TEST_CONFIG = {
  clientEmail: "test-ocr@ksnapcalx-vision-ocr.iam.gserviceaccount.com",
  privateKey,
  projectId: "ksnapcalx-vision-ocr",
};

const { getGoogleVisionAccessToken, resetGoogleVisionAuthCacheForTests } = await import(
  "../dist-electron/lib/google-vision-auth.cjs"
);
const { recognizeDocumentText, resetGoogleVisionAuthCacheForTests: resetAnnotateModuleCache } = await import(
  "../dist-electron/lib/google-vision.cjs"
);

// Two independent esbuild bundles each inline their own copy of
// googleVisionAuth.ts's module-level token cache — both must be reset.
test.beforeEach(() => {
  resetGoogleVisionAuthCacheForTests();
  resetAnnotateModuleCache();
});

function fakeFetchSequence(responses) {
  let call = 0;
  return async (...args) => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (typeof next === "function") return next(...args);
    return next;
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("getGoogleVisionAccessToken: mints a token via the JWT-bearer grant and caches it", async () => {
  let capturedBody = null;
  const fetchImpl = fakeFetchSequence([
    async (url, init) => {
      capturedBody = init.body;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      return jsonResponse(200, { access_token: "fake-access-token", expires_in: 3600 });
    },
  ]);

  const result = await getGoogleVisionAccessToken(TEST_CONFIG, fetchImpl);
  assert.deepEqual(result, { ok: true, accessToken: "fake-access-token" });

  const params = new URLSearchParams(capturedBody);
  assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const assertion = params.get("assertion");
  assert.ok(assertion, "assertion JWT must be present");
  const [, claimSetB64] = assertion.split(".");
  const claims = JSON.parse(Buffer.from(claimSetB64, "base64url").toString("utf8"));
  assert.equal(claims.iss, TEST_CONFIG.clientEmail);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");

  // Second call must reuse the cached token, not mint a second one.
  let secondCallHappened = false;
  const second = await getGoogleVisionAccessToken(TEST_CONFIG, async () => {
    secondCallHappened = true;
    return jsonResponse(200, { access_token: "should-not-be-used", expires_in: 3600 });
  });
  assert.equal(secondCallHappened, false, "cached token must be reused without a second token request");
  assert.equal(second.accessToken, "fake-access-token");
});

test("getGoogleVisionAccessToken: an unauthorized token endpoint response is classified, not thrown", async () => {
  const fetchImpl = fakeFetchSequence([
    async () => jsonResponse(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." }),
  ]);
  const result = await getGoogleVisionAccessToken(TEST_CONFIG, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unauthorized");
  assert.equal(result.status, 400);
});

test("getGoogleVisionAccessToken: a network failure is classified as 'network', not thrown", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  const result = await getGoogleVisionAccessToken(TEST_CONFIG, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "network");
});

test("getGoogleVisionAccessToken: a malformed private key is a credential_error, never a thrown exception", async () => {
  const brokenConfig = { ...TEST_CONFIG, privateKey: "not a real PEM key" };
  const result = await getGoogleVisionAccessToken(brokenConfig, async () => jsonResponse(200, {}));
  assert.equal(result.ok, false);
  assert.equal(result.kind, "credential_error");
});

test("recognizeDocumentText: requests ONLY DOCUMENT_TEXT_DETECTION and returns the raw text", async () => {
  let annotateRequestBody = null;
  const fetchImpl = fakeFetchSequence([
    async () => jsonResponse(200, { access_token: "tok", expires_in: 3600 }),
    async (url, init) => {
      assert.equal(url, "https://vision.googleapis.com/v1/images:annotate");
      annotateRequestBody = JSON.parse(init.body);
      return jsonResponse(200, {
        responses: [{ fullTextAnnotation: { text: "Jane Doe\nDr. Smith\n2026-03-05\n10:30 AM" } }],
      });
    },
  ]);

  const result = await recognizeDocumentText(TEST_CONFIG, Buffer.from("fake-jpeg-bytes"), fetchImpl);
  assert.deepEqual(result, { ok: true, rawText: "Jane Doe\nDr. Smith\n2026-03-05\n10:30 AM" });

  assert.deepEqual(annotateRequestBody.requests[0].features, [{ type: "DOCUMENT_TEXT_DETECTION" }]);
  assert.equal(annotateRequestBody.requests.length, 1);
});

test("recognizeDocumentText: a 403 PERMISSION_DENIED from Vision is classified distinctly, not as a generic server error", async () => {
  const fetchImpl = fakeFetchSequence([
    async () => jsonResponse(200, { access_token: "tok", expires_in: 3600 }),
    async () =>
      jsonResponse(403, {
        error: {
          code: 403,
          message: "Cloud Vision API has not been used in project ksnapcalx-vision-ocr before or it is disabled, or the caller does not have permission.",
          status: "PERMISSION_DENIED",
        },
      }),
  ]);

  const result = await recognizeDocumentText(TEST_CONFIG, Buffer.from("fake-jpeg-bytes"), fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "permission_denied");
  assert.equal(result.status, 403);
  assert.match(result.message, /permission|disabled|has not been used/i);
});

test("recognizeDocumentText: a per-image error inside a 200 batch response is still classified as an error, not returned as empty text", async () => {
  const fetchImpl = fakeFetchSequence([
    async () => jsonResponse(200, { access_token: "tok", expires_in: 3600 }),
    async () =>
      jsonResponse(200, {
        responses: [{ error: { code: 7, message: "Permission denied on resource.", status: "PERMISSION_DENIED" } }],
      }),
  ]);

  const result = await recognizeDocumentText(TEST_CONFIG, Buffer.from("fake-jpeg-bytes"), fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "permission_denied");
});

test("recognizeDocumentText: an auth failure short-circuits before any annotate call is made", async () => {
  let annotateCalled = false;
  const fetchImpl = fakeFetchSequence([
    async () => jsonResponse(401, { error: "invalid_client" }),
    async () => {
      annotateCalled = true;
      return jsonResponse(200, { responses: [{}] });
    },
  ]);

  const result = await recognizeDocumentText(TEST_CONFIG, Buffer.from("fake-jpeg-bytes"), fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(annotateCalled, false, "annotate must not be called when token minting failed");
});
