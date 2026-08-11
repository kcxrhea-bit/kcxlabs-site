import type { IncomingMessage, ServerResponse } from "node:http";

import pair from "../server/media-api/routes/auth/pair";
import revoke from "../server/media-api/routes/auth/revoke";
import clips from "../server/media-api/routes/clips";
import mediaIndex from "../server/media-api/routes/media/index";
import checkHash from "../server/media-api/routes/media/check-hash";
import uploadAuthorize from "../server/media-api/routes/media/upload-authorize";
import finalize from "../server/media-api/routes/media/finalize";
import mediaItem from "../server/media-api/routes/media/[id]";
import mediaPublic from "../server/media-api/routes/media/public/[publicId]";
import restoreAuthorize from "../server/media-api/routes/media/[id]/restore-authorize";
import restoreFinalize from "../server/media-api/routes/media/[id]/restore-finalize";
import archiveJobs from "../server/media-api/routes/archive/jobs";
import archiveStart from "../server/media-api/routes/archive/[id]/start";
import archiveComplete from "../server/media-api/routes/archive/[id]/complete";
import archiveFail from "../server/media-api/routes/archive/[id]/fail";
import archiveDownloadAuthorize from "../server/media-api/routes/archive/[id]/download-authorize";
import archiveRemoveCloudOriginal from "../server/media-api/routes/archive/[id]/remove-cloud-original";

/**
 * Single Vercel Function fronting the entire Media Center API, to stay under the Hobby plan's
 * 12-function cap (there are 17 distinct routes). Every imported module is the original,
 * untouched route logic from `server/media-api/routes/*` — only relocated out of `api/` so
 * Vercel's function discovery no longer counts each one separately; each still ends in the same
 * `export default toNodeHandler(handler)` it always did. This file's only job is picking which
 * one gets the request.
 *
 * This project is plain Vite + Vercel Functions, not Next.js: a bracket-named catch-all file
 * (`api/[...path].ts`) is a Next.js routing convention and is not honored by Vercel's generic
 * Functions runtime, so a request like `/api/media/check-hash` never actually reached that file —
 * Vercel returned NOT_FOUND before invoking any function. This file is instead a normal, statically
 * named function (`api/router.ts`), reached via an explicit rewrite in `vercel.json`:
 * `/api/:path*` -> `/api/router?__kcx_path=:path*`. See `reconstructOriginalUrl` below for how the
 * original public URL is restored before any route logic runs.
 */

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const KCX_PATH_QUERY_KEY = "__kcx_path";

/** Mirrors `resolveIncomingUrl` in `_lib/http.ts`: absolute in production, relative under `vercel dev`. */
function parseIncomingUrl(req: IncomingMessage): URL {
  const raw = req.url ?? "/";
  try {
    return new URL(raw);
  } catch {
    return new URL(raw, `http://${req.headers.host ?? "localhost"}`);
  }
}

function pathnameOf(req: IncomingMessage): string {
  return parseIncomingUrl(req).pathname;
}

/**
 * Reverses the `/api/:path* -> /api/router?__kcx_path=:path*` rewrite in `vercel.json`, so every
 * downstream route handler — which all parse `req.url`/`request.url` themselves, never a
 * Vercel-injected route param — sees exactly the original public URL it always did, e.g.
 * `/api/media/abc123/restore-authorize?foo=bar`, never `/api/router?__kcx_path=...&foo=bar`.
 *
 * Mutates `req.url` in place — same `req` object, only this one string property changes — so
 * object identity, headers, method, and the (untouched, unread) body stream are unaffected.
 * `__kcx_path` is deleted before the remaining query string is reserialized, so it never reaches
 * downstream logic; every other original query parameter is preserved.
 *
 * A request with no `__kcx_path` (a direct invocation that bypassed the rewrite — `vercel dev`,
 * or a test) leaves `req.url` untouched, so `resolveRoute` falls back to reading the path as-is.
 */
function reconstructOriginalUrl(req: IncomingMessage): void {
  const url = parseIncomingUrl(req);
  const kcxPath = url.searchParams.get(KCX_PATH_QUERY_KEY);
  if (kcxPath === null) return;

  url.searchParams.delete(KCX_PATH_QUERY_KEY);
  const query = url.searchParams.toString();
  const pathname = `/api/${kcxPath.replace(/^\/+/, "")}`;
  req.url = query ? `${pathname}?${query}` : pathname;
}

function segmentsOf(pathname: string): string[] {
  const raw = pathname.split("/").filter(Boolean);
  return raw[0] === "api" ? raw.slice(1) : raw;
}

// Static paths, keyed by their segments joined with "/". Checked before the dynamic patterns
// below, mirroring Vercel's own file-based precedence where a literal file always wins over a
// same-shape `[param]` file — e.g. "media/check-hash" must never be captured as `media/[id]`.
const exactRoutes: Record<string, NodeHandler> = {
  "auth/pair": pair,
  "auth/revoke": revoke,
  "clips": clips,
  "media": mediaIndex,
  "media/check-hash": checkHash,
  "media/upload-authorize": uploadAuthorize,
  "media/finalize": finalize,
  "archive/jobs": archiveJobs,
};

function matchDynamic(segments: string[]): NodeHandler | null {
  if (segments.length === 2 && segments[0] === "media") return mediaItem; // /media/<id>
  if (segments.length === 3 && segments[0] === "media" && segments[1] === "public") return mediaPublic; // /media/public/<publicId>
  if (segments.length === 3 && segments[0] === "media" && segments[2] === "restore-authorize") return restoreAuthorize; // /media/<id>/restore-authorize
  if (segments.length === 3 && segments[0] === "media" && segments[2] === "restore-finalize") return restoreFinalize; // /media/<id>/restore-finalize
  if (segments.length === 3 && segments[0] === "archive" && segments[2] === "start") return archiveStart; // /archive/<id>/start
  if (segments.length === 3 && segments[0] === "archive" && segments[2] === "complete") return archiveComplete; // /archive/<id>/complete
  if (segments.length === 3 && segments[0] === "archive" && segments[2] === "fail") return archiveFail; // /archive/<id>/fail
  if (segments.length === 3 && segments[0] === "archive" && segments[2] === "download-authorize") return archiveDownloadAuthorize; // /archive/<id>/download-authorize
  if (segments.length === 3 && segments[0] === "archive" && segments[2] === "remove-cloud-original") return archiveRemoveCloudOriginal; // /archive/<id>/remove-cloud-original
  return null;
}

/** Exported for tests: pure routing decision, no I/O. */
export function resolveRoute(pathname: string): NodeHandler | null {
  const segments = segmentsOf(pathname);
  return exactRoutes[segments.join("/")] ?? matchDynamic(segments);
}

/**
 * The Vercel entrypoint. `req.url` is first reconstructed back to the original public URL (see
 * `reconstructOriginalUrl`), then `req`/`res` are forwarded untouched to the selected route's own
 * `toNodeHandler`-wrapped handler, so method handling, auth, body parsing, query strings, and
 * response headers all remain exactly what that route already does on its own — this function
 * never reads the body and only inspects `req.url`/`req.headers.host`, which does not consume
 * the request stream.
 */
export default async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  reconstructOriginalUrl(req);
  const handler = resolveRoute(pathnameOf(req));
  if (!handler) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  await handler(req, res);
}
