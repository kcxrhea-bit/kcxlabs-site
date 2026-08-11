/** Server-only HTTP primitives shared by every Media API handler. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { bearerToken, hashDeviceToken, verifyDeviceTokenRecord } from "./auth.js";
import { authRepository, createDb } from "./db.js";
import { loadAppConfig, redactSecrets, type AppConfig } from "./config.js";

export type ApiContext = { config: AppConfig; ownerId: string };

/**
 * Vercel's production edge network always hands handlers an absolute
 * `request.url`, but the local `vercel dev` Node runtime hands over a
 * relative path — `new URL()` throws "Invalid URL" on that. Parsing against
 * a host-derived base works in both cases since an absolute `request.url`
 * ignores the base entirely.
 */
export function requestUrl(request: Request): URL {
  return new URL(request.url, `http://${request.headers.get("host") ?? "localhost"}`);
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function requireMethod(request: Request, method: string): Response | null {
  return request.method === method ? null : json(405, { error: "method_not_allowed" }, { Allow: method });
}

export async function requireDevice(request: Request): Promise<ApiContext | Response> {
  const config = loadAppConfig();
  const token = bearerToken(request.headers.get("authorization"));
  if (token === null) return json(401, { error: "unauthorized" });

  const auth = authRepository(createDb(config.database));
  const verified = verifyDeviceTokenRecord(await auth.deviceTokenByHash(hashDeviceToken(token)), new Date());
  if (!verified.valid) return json(401, { error: "unauthorized" });
  await auth.touchDeviceToken(verified.record.id);
  return { config, ownerId: verified.record.ownerId };
}

export function isResponse(value: ApiContext | Response): value is Response {
  return value instanceof Response;
}

/** Keep provider errors useful without ever reflecting a configured credential. */
export function internalError(error: unknown, config: AppConfig): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactSecrets(message));
  return json(500, { error: "internal_error" });
}

// ─── Local `vercel dev` compatibility shim ──────────────────────────────────
//
// Every route handler in `api/` is written once, as a Fetch API handler
// (`(request: Request) => Promise<Response>`). That is the correct, portable
// shape and it is what runs in production.
//
// `vercel dev` (confirmed on CLI 58.9.1, the current latest release) never
// resolves that shape locally: a minimal handler with zero I/O — no database,
// no imports beyond globals — hung indefinitely and never returned a
// response, proven with a throwaway diagnostic route and `curl` timeouts. An
// identical handler rewritten with the classic Node `(req, res)` signature
// returned instantly. Vercel's Node runtime has supported that classic
// signature since before Web API handlers existed, in both `vercel dev` and
// production, so wrapping for classic invocation fixes local dev without
// touching a single handler's logic.
//
// `toNodeHandler` is that wrapper. Each route's default export becomes
// `toNodeHandler(handler)` instead of `handler` itself — the Fetch handler
// above remains the one and only place the route is implemented.

export type FetchHandler = (request: Request) => Promise<Response>;

async function readNodeRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method ?? "GET").toUpperCase();
  // A body on GET/HEAD is rejected by the Fetch `Request` constructor, and
  // these methods never carry one in this API.
  if (method === "GET" || method === "HEAD") return undefined;

  // `vercel dev`'s local Node runtime pre-parses the body onto `req.body` and
  // drains the underlying stream before invoking a classic (req, res)
  // handler — confirmed by instrumentation: `for await (const chunk of req)`
  // sees zero bytes even though `req.body` already holds the parsed JSON.
  // Every route in this API only ever calls `request.json()` on the
  // resulting Fetch `Request`, never raw text or bytes, so re-serializing an
  // already-parsed body is lossless here.
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (Buffer.isBuffer(preParsed)) return preParsed;
    if (typeof preParsed === "string") return preParsed.length > 0 ? Buffer.from(preParsed) : undefined;
    return Buffer.from(JSON.stringify(preParsed));
  }

  // No pre-parsed body (production, and every environment this adapter's
  // own tests run under): read the raw stream exactly once.
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function nodeHeadersToWebHeaders(headers: IncomingMessage["headers"]): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) webHeaders.append(key, entry);
    } else {
      webHeaders.set(key, value);
    }
  }
  return webHeaders;
}

/**
 * The common case is an origin-form target (`/api/clips?limit=5`), which
 * needs a host-derived base to parse. A request line already in absolute
 * form (`http://host/api/clips`) parses directly and the base is unused.
 */
function resolveIncomingUrl(req: IncomingMessage): URL {
  const raw = req.url ?? "/";
  try {
    return new URL(raw);
  } catch {
    return new URL(raw, `http://${req.headers.host ?? "localhost"}`);
  }
}

/** Reads the Node request body exactly once and hands back an equivalent Web `Request`. */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = resolveIncomingUrl(req);
  const method = (req.method ?? "GET").toUpperCase();
  const headers = nodeHeadersToWebHeaders(req.headers);
  const body = await readNodeRequestBody(req);
  return new Request(url.href, { method, headers, body });
}

/** Binary-safe: reads the Web `Response` body as bytes rather than assuming text/JSON. */
async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Wraps a Fetch-style route handler so `vercel dev`'s classic Node
 * `(req, res)` invocation can execute it locally. See the module comment
 * above for why this exists. Production behavior of `fetchHandler` is
 * unchanged — this only adapts how it is invoked and how its response is
 * written back.
 */
export function toNodeHandler(fetchHandler: FetchHandler) {
  return async function nodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let request: Request;
    try {
      request = await toWebRequest(req);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "invalid_request" }));
      return;
    }

    let response: Response;
    try {
      response = await fetchHandler(request);
    } catch (error) {
      console.error(error instanceof Error ? redactSecrets(error.message) : "handler_error");
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "internal_error" }));
      return;
    }

    await writeWebResponse(response, res);
  };
}
