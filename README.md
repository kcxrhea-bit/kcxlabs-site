# KCx Labs Homepage

KCx Labs is a founder-built AI-assisted software ecosystem focused on connected mobile systems, desktop creator tools, local-first runtime intelligence, and companion robotics research.

This repository contains the official KCx Labs website and its Electron-based desktop publishing platform. The public website remains a Vite static frontend; Electron adds desktop-only publishing capabilities without giving the website renderer Node access.

## Tech Stack

- React
- Vite
- TypeScript
- Tailwind CSS
- Framer Motion
- lucide-react
- Electron (desktop shell)

## Current Scope

- Public website: existing homepage, `/beta` route, and the KCx NEXUS Hybrid Cloud preview at
  `/nexus` and `/nexus/portal` (the former `/nexus-cloud` paths redirect there). NEXUS Local Mode works
  today on your own private network via the Android client; reaching NEXUS over the public internet is not
  available. See [docs/nexus-cloud-preview.md](./docs/nexus-cloud-preview.md).
- Desktop: isolated Electron shell, typed preload bridge, project catalog, release validator/publisher, website build/preview, deployment readiness, theme sync, activity, and settings surfaces
- Projects: select a trusted root folder and scan its subfolders for common project manifests. Scan results are review-only until explicitly loaded and registered.
- Website candidates: choose individual discovered projects or use **Add all projects to website**. Both routes show additions/removals first and require **Approve website changes** plus a native confirmation before metadata is changed.
- Import workflow: browse or drag project folders, ZIP/EXE/MSI release artifacts, and `.patch`/`.diff` files. Release publishing is a guided three-step preview-and-confirm workflow; patch import remains separate.
- Artifacts: open registered project folders, create staged ZIPs for the release workflow, or run project-defined executable packaging scripts.
- Releases require a native confirmation before a file is copied or website metadata changes. Deployment is never automatic.

## Core Ecosystem Systems

- KCxMode
- KCx Messenger
- KCx Studio Companion
- KCx Valhalla
- KCx Cortex
- Robotics / Companion AI systems

## Local Development

Install dependencies:

```powershell
npm.cmd install
```

Start the desktop application:

```powershell
npm.cmd run dev
```

Start the website only:

```powershell
npm.cmd run dev:website
```

Create production build:

```powershell
npm.cmd run build
```

Compile Electron main and preload processes:

```powershell
npm.cmd run build:electron
```

Run validation:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Preview production build locally:

```powershell
npm.cmd run preview
```

## Deployment Target

Primary deployment target: **Vercel**

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment settings.

## Using the desktop app

See [USER_GUIDE.md](./USER_GUIDE.md) for the complete desktop workflow, including project scanning, website-change approval, release previews, website preview, deployment readiness, and theme sync.

## Contact

- jason@kcxlabs.org
