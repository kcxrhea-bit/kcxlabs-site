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

## Desktop deployment workflow

The KCxLabs desktop app only checks deployment readiness. It reports branch, uncommitted changes, website build result, and Vercel CLI availability; it never executes a Vercel deployment automatically.

Before using Vercel manually, use the desktop Release Publisher to validate the artifact and generate a preview. Confirm the native publish dialog only after reviewing the target artifact and metadata change. The app copies the artifact with a backup for an existing destination, updates `src/data/publishing-catalog.json`, and leaves deployment under operator control.
