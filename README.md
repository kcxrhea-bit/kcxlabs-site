# KCx Labs Homepage

KCx Labs is a founder-built AI-assisted software ecosystem focused on connected mobile systems, desktop creator tools, local-first runtime intelligence, and companion robotics research.

This repository contains the official KCx Labs website and the beginning of its desktop publishing platform. The public website remains a Vite static frontend; Electron adds desktop-only publishing capabilities without giving the website renderer Node access.

## Tech Stack

- React
- Vite
- TypeScript
- Tailwind CSS
- Framer Motion
- lucide-react
- Electron (desktop shell)

## Current Scope

- Public website: existing homepage and `/beta` route
- Desktop: Phase 1 Electron dashboard shell with an isolated, typed preload bridge
- Publishing, release metadata, website preview, deployment, and theme synchronization are phased work and are not yet operational

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

Preview production build locally:

```powershell
npm.cmd run preview
```

## Deployment Target

Primary deployment target: **Vercel**

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment settings.

## Contact

- jason@kcxlabs.org
