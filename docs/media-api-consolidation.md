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

`api/` now holds exactly one file: **`api/[...path].ts`**, a catch-all Vercel Function. It imports
all 17 route modules and picks the right one by inspecting the request pathname — nothing else. It
never reads the request body, never touches `Authorization`, and never re-implements auth,
validation, or storage logic; it forwards the original `(req, res)` to the selected route's own
`toNodeHandler`-wrapped handler untouched, so that route's existing method handling, `requireDevice`
auth, body parsing, and response headers behave exactly as they did as a standalone function.

Static paths (`/api/auth/pair`, `/api/media/check-hash`, …) are matched before the dynamic
`/api/media/<id>`-shaped patterns, mirroring Vercel's own precedence where a literal file always
wins over a same-shape `[param]` file — this is what keeps `/api/media/check-hash` from ever being
captured as `media/[id]` with `id = "check-hash"`.

## Why this is safe

- **No external URL changed.** The route table in `api/[...path].ts` reproduces the exact same 17
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
  location; added a check that `api/` contains only `[...path].ts`.
- `tests/api-dispatch-routing.test.mjs` — new. Proves `resolveRoute()` maps every one of the 17
  URLs to a distinct, real handler, that unknown paths and wrong methods are still rejected
  correctly, and that query strings, request bodies, the `Authorization` header, and dynamic id
  segments all survive dispatch into the real route logic.
