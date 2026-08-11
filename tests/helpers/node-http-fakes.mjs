import { Readable } from "node:stream";

/**
 * Minimal Node IncomingMessage stand-in: a real Readable so `for await (const
 * chunk of req)` in the adapter (api/_lib/http.ts) behaves exactly as it does
 * for a real `vercel dev` request, plus the handful of properties it reads.
 */
export function fakeRequest({ method = "GET", url = "/", headers = {}, body = null } = {}) {
  const req = new Readable({
    read() {
      if (body !== null) {
        this.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
      }
      this.push(null);
    },
  });
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

/**
 * `vercel dev`'s local Node runtime pre-parses the JSON body onto `req.body`
 * and drains the underlying stream before invoking a classic (req, res)
 * handler — confirmed live: `for await (const chunk of req)` sees zero bytes
 * even though `req.body` already holds the parsed value. This produces that
 * exact shape: an already-drained stream plus a `.body` property, so a test
 * can catch an adapter that only reads the raw stream and silently drops the
 * request body in this specific, real environment.
 */
export function fakeRequestWithPreParsedBody({ method = "POST", url = "/", headers = {}, body } = {}) {
  const req = new Readable({
    read() {
      this.push(null); // Already drained, exactly like the real runtime.
    },
  });
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.body = body;
  return req;
}

/** Minimal ServerResponse stand-in: captures what the adapter writes, once. */
export function fakeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    ended: false,
    chunks: [],
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      if (res.ended) throw new Error("response already ended — double-send");
      res.ended = true;
      if (chunk !== undefined) res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
  };
  return res;
}

export function bodyOf(res) {
  return Buffer.concat(res.chunks).toString("utf8");
}
