# Media Center API — single-function consolidation

Vercel's Hobby plan caps a deployment at 12 Serverless Functions. The Media Center backend has 17
distinct routes, each previously its own file directly under `api/` (Vercel's function-discovery
directory), which made every deployment fail with:

> No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.

## What changed

Route **implementation** moved out of `api/` into `server/media-api/`:

- `server/media-api/_lib/` — the same shared helpers (`auth.ts`, `db.ts`, `http.ts`, `r2.ts`,
  `budget.ts`, `metrics.ts`, `config.ts`, `ids.ts`, `index.ts`), unmodified except for relative
  import paths.
- `server/media-api/routes/` — the same 17 route files, unmodified except for relative import
  paths. Every file still ends in `export default toNodeHandler(handler)`, exactly as before.

`api/` now holds exactly one file: **`api/router.ts`**, a catch-all Vercel Function. It imports
all 17 route modules and picks the right one by inspecting the request pathname — nothing else. It
never reads the request body, never touches `Authorization`, and never re-implements auth,
validation, or storage logic; it forwards the original `(req, res)` to the selected route's own
`toNodeHandler`-wrapped handler untouched, so that route's existing method handling, `requireDevice`
auth, body parsing, and response headers behave exactly as they did as a standalone function.

Static paths (`/api/auth/pair`, `/api/media/check-hash`, …) are matched before the dynamic
`/api/media/<id>`-shaped patterns, mirroring Vercel's own precedence where a literal file always
wins over a same-shape `[param]` file — this is what keeps `/api/media/check-hash` from ever being
captured as `media/[id]` with `id = "check-hash"`.

### `api/[...path].ts` didn't actually work — how `router.ts` reaches every URL

The first version of this consolidation named the file `api/[...path].ts`, a Next.js catch-all
convention. On Vercel Preview it built successfully and was reported as exactly one function
(`λ api/[...path]`) — but every real request, e.g. `POST /api/media/check-hash`, came back
`NOT_FOUND` without ever invoking the function. This project is plain Vite + Vercel Functions, not
Next.js, and Vercel's generic Functions runtime does not treat a bracket-catch-all filename as a
wildcard route the way the Next.js adapter does.

The fix: the file is `api/router.ts` (an ordinary, statically named function), and `vercel.json`
adds an explicit rewrite, placed before the SPA catch-all:

```json
{ "source": "/api/:path*", "destination": "/api/router?__kcx_path=:path*" }
```

Vercel resolves this by invoking `api/router.ts` with `req.url` looking like
`/api/router?__kcx_path=media/check-hash` (plus any of the request's own original query
parameters, which Vercel auto-appends). Every downstream route handler parses `req.url`/
`request.url` itself, so `router.ts` reconstructs the original public URL — `/api/media/check-hash`
— **before** calling `resolveRoute` or the selected handler:

- `reconstructOriginalUrl` reads `__kcx_path` out of the query string, deletes it, and rebuilds
  `req.url` as `/api/<kcx_path>?<remaining original query params>`.
- It mutates `req.url` in place on the same `req` object — object identity, headers, method, and
  the (untouched) body stream are unaffected.
- If `__kcx_path` is absent (a direct invocation that bypassed the rewrite — `vercel dev`, or a
  test), `req.url` is left exactly as-is, so the dispatcher's behavior is unchanged for that case.

## Why this is safe

- **No external URL changed.** The route table in `api/router.ts` reproduces the exact same 17
  paths the file-based routing produced.
- **No auth was touched.** `requireDevice`, owner credential checks, and device tokens still live
  entirely inside the moved (unmodified) route files.
- **No credential reaches the browser.** `server/media-api/_lib` is still server-only code, never
  imported from `src/` outside `src/media` (the isomorphic, credential-free core), and Vite never
  bundles it — confirmed by the existing `no absolute Windows project paths` / `no provider API key
  names appear in public runtime configuration` tests, which still pass unchanged.
- **`_lib` was never counted as a function** even before this change — Vercel excludes
  underscore-prefixed paths from function discovery — so moving it was for clarity and colocation
  with the routes it serves, not a requirement of the 12-function limit.

## Testing

- `tests/media-api-routes.test.mjs` — updated to read from the new `server/media-api/routes`
  location; checks that `api/` contains only `router.ts`.
- `tests/api-dispatch-routing.test.mjs` — proves `resolveRoute()` maps every one of the 17 URLs to
  a distinct, real handler; that unknown paths and wrong methods are still rejected correctly;
  that query strings, request bodies, the `Authorization` header, and dynamic id segments all
  survive dispatch; and — for the `__kcx_path` rewrite specifically — that the reconstructed
  `req.url` matches the original public URL exactly, that `__kcx_path` never reaches downstream
  logic, and that a direct (non-rewritten) invocation is unaffected. It also asserts the
  `vercel.json` rewrite itself is shaped correctly and ordered before the SPA catch-all.
