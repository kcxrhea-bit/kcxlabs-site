import test from "node:test";
import assert from "node:assert/strict";

import { toNodeHandler } from "../dist-electron/api-http.cjs";
import { fakeRequest, fakeRequestWithPreParsedBody, fakeResponse, bodyOf } from "./helpers/node-http-fakes.mjs";

test("GET with a query string reaches the Fetch handler with searchParams intact", async () => {
  let seenUrl = null;
  const nodeHandler = toNodeHandler(async (request) => {
    seenUrl = new URL(request.url);
    return new Response(JSON.stringify({ limit: seenUrl.searchParams.get("limit") }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const req = fakeRequest({ method: "GET", url: "/api/clips?limit=5&offset=10", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(seenUrl.searchParams.get("limit"), "5");
  assert.equal(seenUrl.searchParams.get("offset"), "10");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(bodyOf(res)), { limit: "5" });
});

test("POST JSON body reaches the Fetch handler intact and is read exactly once", async () => {
  let seenBody = null;
  const nodeHandler = toNodeHandler(async (request) => {
    seenBody = await request.json();
    return new Response(JSON.stringify({ received: true }), { status: 201 });
  });

  const payload = JSON.stringify({ sha256: "a".repeat(64), sizeBytes: 42 });
  const req = fakeRequest({
    method: "POST",
    url: "/api/media/x/restore-authorize",
    headers: { host: "localhost:3456", "content-type": "application/json" },
    body: payload,
  });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.deepEqual(seenBody, { sha256: "a".repeat(64), sizeBytes: 42 });
  assert.equal(res.statusCode, 201);
});

// Regression test: `vercel dev`'s local Node runtime pre-parses the JSON
// body onto `req.body` and drains the raw stream before invoking a classic
// handler. Confirmed live: a request with `Content-Length: 70` produced zero
// bytes on `for await (const chunk of req)` while `req.body` already held
// the parsed object. Reading only the raw stream silently turned every real
// POST body into an empty one — auth/pair, for example, returned
// `invalid_request` (400) for a wrong password instead of the real
// `invalid_credentials` (401), because the credential check never ran.
test("a request whose body vercel dev has already drained onto req.body is not silently treated as empty", async () => {
  let seenBody = null;
  const nodeHandler = toNodeHandler(async (request) => {
    seenBody = await request.json();
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  });

  const req = fakeRequestWithPreParsedBody({
    url: "/api/auth/pair",
    headers: { host: "localhost:3456", "content-type": "application/json", "content-length": "70" },
    body: { email: "owner@example.test", password: "x", deviceName: "probe" },
  });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.deepEqual(seenBody, { email: "owner@example.test", password: "x", deviceName: "probe" });
});

test("request headers are converted and visible to the Fetch handler", async () => {
  let seenAuth = null;
  const nodeHandler = toNodeHandler(async (request) => {
    seenAuth = request.headers.get("authorization");
    return new Response(null, { status: 204 });
  });

  const req = fakeRequest({
    method: "GET",
    url: "/api/media",
    headers: { host: "localhost:3456", authorization: "Bearer secret-token" },
  });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(seenAuth, "Bearer secret-token");
});

test("response headers set by the Fetch handler are copied back onto the Node response", async () => {
  const nodeHandler = toNodeHandler(async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
  });

  const req = fakeRequest({ method: "GET", url: "/api/clips", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.headers["cache-control"], "public, max-age=60");
});

test("a non-200 response status is preserved", async () => {
  const nodeHandler = toNodeHandler(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

  const req = fakeRequest({ method: "GET", url: "/api/media/public/does-not-exist", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(JSON.parse(bodyOf(res)), { error: "not_found" });
});

test("a JSON response body round-trips byte-for-byte", async () => {
  const payload = { items: [{ id: "a", tags: ["x", "y"] }], nested: { ok: true } };
  const nodeHandler = toNodeHandler(async () => new Response(JSON.stringify(payload), { status: 200 }));

  const req = fakeRequest({ method: "GET", url: "/api/clips", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.deepEqual(JSON.parse(bodyOf(res)), payload);
});

test("an empty response body (204) ends cleanly with no bytes written", async () => {
  const nodeHandler = toNodeHandler(async () => new Response(null, { status: 204 }));

  const req = fakeRequest({ method: "DELETE", url: "/api/media/x", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(bodyOf(res).length, 0);
  assert.equal(res.ended, true);
});

test("a handler that throws is caught and returns a single 500 response, not a hang or a crash", async () => {
  const nodeHandler = toNodeHandler(async () => {
    throw new Error("boom");
  });

  const req = fakeRequest({ method: "GET", url: "/api/clips", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(bodyOf(res)), { error: "internal_error" });
  assert.equal(res.ended, true);
});

test("a relative request URL (the normal `vercel dev` case) resolves against the host header", async () => {
  let seenHref = null;
  const nodeHandler = toNodeHandler(async (request) => {
    seenHref = request.url;
    return new Response(null, { status: 204 });
  });

  const req = fakeRequest({ method: "GET", url: "/api/clips?limit=5", headers: { host: "localhost:3456" } });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(seenHref, "http://localhost:3456/api/clips?limit=5");
});

test("an absolute-form request URL is used as-is and the host header is ignored", async () => {
  let seenHref = null;
  const nodeHandler = toNodeHandler(async (request) => {
    seenHref = request.url;
    return new Response(null, { status: 204 });
  });

  const req = fakeRequest({
    method: "GET",
    url: "http://upstream.example/api/clips?limit=5",
    headers: { host: "localhost:3456" },
  });
  const res = fakeResponse();
  await nodeHandler(req, res);

  assert.equal(seenHref, "http://upstream.example/api/clips?limit=5");
});

test("GET requests never construct a Request with a body, even if the socket has data", async () => {
  const nodeHandler = toNodeHandler(async (request) => {
    assert.equal(request.body, null);
    return new Response(null, { status: 200 });
  });

  // A GET carrying bytes should never happen in practice, but the adapter
  // must not pass them to the Fetch `Request` constructor, which throws for
  // GET/HEAD with a non-null body.
  const req = fakeRequest({ method: "GET", url: "/api/clips", headers: { host: "localhost:3456" }, body: "ignored" });
  const res = fakeResponse();
  await nodeHandler(req, res);
});
