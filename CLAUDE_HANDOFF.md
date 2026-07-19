# KCxLabs desktop publishing platform handoff

## Completed platform baseline

KCxLabs keeps its existing React/Vite website and has an Electron publishing platform. `npm run dev` is reserved for the desktop application; `npm run dev:website` starts the unchanged website-only Vite workflow.

The renderer remains unprivileged: Electron enables context isolation and sandboxing, disables renderer Node integration, and exposes a narrow typed `window.kcxDesktop.getStatus()` bridge.

## Operational boundaries

- The project catalog labels unavailable folders as `missing` and does not scan them.
- Project discovery scans only a user-selected existing root, skips generated folders, and returns review-only candidates. It never auto-registers a project.
- Discovered projects can be selected individually or staged with Add all projects to website. The website change preview lists additions/removals; approval opens a native confirmation and creates a catalog backup before changing metadata.
- The current import phase supports browse/drop project folders, browse/drop ZIP/EXE/MSI release artifacts through a three-step wizard, and browse/drop `.patch`/`.diff` files in a separate patch-import module. All write operations remain previewed and confirmation-gated.
- Release validation computes SHA-256 and size. Publishing requires a native confirmation, creates an overwrite backup, and updates structured website metadata. It never deploys.
- Website preview is a distinct Vite process and supports explicit start/stop plus output capture.
- Theme synchronization uses KCxLabs' canonical `theme-engine/`, previews hashes/status, backs up replaced target files, and has no runtime link to reference projects.
- `public/desktop/KCxPCTransparent.png` is a local desktop-only dashboard backdrop. The public site does not import it.
- `D:\KCxProjects\ThemeSync` and `D:\KCxProjects\theme-engine` are reference-only. They have not been modified or linked.

## Validation required after every phase

Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` when the workspace becomes a Git worktree. Then launch `npm run dev` and verify the Electron dashboard, preload bridge, and renderer console at runtime.
