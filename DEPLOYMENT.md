# KCx Labs Deployment Notes

This project is prepared for first deployment as a Vite static frontend on Vercel.

## Local Pre-Deployment Checks

Install dependencies:

```powershell
npm.cmd install
```

Run production build:

```powershell
npm.cmd run build
```

## Vercel Project Settings

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

No backend services are required for this homepage deployment.

## Environment variables

None are required. The NEXUS Hybrid Cloud preview ships correct defaults with every variable unset. The
optional `VITE_NEXUS_*` flags are documented in
[docs/nexus-cloud-preview.md](./docs/nexus-cloud-preview.md). Every `VITE_*` value is inlined into the
public bundle, so never place a secret, token, or provider API key in one.

## KCx Kids World (`/kids`)

`public/kids/` holds the Godot Web/PWA export for KCx Kids World, served as a static subtree at
`https://kcxlabs.org/kids/` — it bypasses the React app entirely (Vercel serves an existing static file
before evaluating `rewrites`, and Vite copies `public/` into `dist/` verbatim).

The build artifacts (`index.wasm`, `index.pck`, etc.) are **committed to git**, not generated during the
Vercel build — Vercel's build image has no Godot toolchain, so there is no way to export the game as part
of `npm run build`. The Godot project (`D:\KCxProjects\KCxKidsWorld`) is the source of truth; this repo
only ever holds a synced copy of its `build/web/` export output.

To update the game after a new Godot Web export:

```powershell
npm.cmd run kids:sync
npm.cmd run build
```

`scripts/sync-kids-web-build.mjs` cleans and repopulates only `public/kids/` (never touches the rest of
`public/`), verifies the expected Godot output files exist before and after copying, and excludes stray
`*.import` editor metadata. It fails loudly rather than silently shipping an incomplete export.

`vercel.json` adds, scoped entirely to `/kids/*`: a `/kids` → `/kids/` redirect (directory index requires
the trailing slash), an explicit `application/wasm` Content-Type for `.wasm`, and `no-cache` on the service
worker and manifest so PWA updates propagate. No cross-origin isolation headers are set — the export is
single-threaded (`GODOT_THREADS_ENABLED = false`), so none are required.

## Desktop deployment workflow

The KCxLabs desktop app only checks deployment readiness. It reports branch, uncommitted changes, website build result, and Vercel CLI availability; it never executes a Vercel deployment automatically.

Before using Vercel manually, use the desktop Release Publisher to validate the artifact and generate a preview. Confirm the native publish dialog only after reviewing the target artifact and metadata change. The app copies the artifact with a backup for an existing destination, updates `src/data/publishing-catalog.json`, and leaves deployment under operator control.
