# KCxLabs desktop publishing platform handoff

## Phase 1 complete target

KCxLabs keeps its existing React/Vite website and now has an Electron shell. `npm run dev` is reserved for the desktop application; `npm run dev:website` starts the unchanged website-only Vite workflow.

The renderer remains unprivileged: Electron enables context isolation and sandboxing, disables renderer Node integration, and exposes a narrow typed `window.kcxDesktop.getStatus()` bridge.

## Intentional Phase 1 boundary

- The current desktop dashboard is a shell/status view, not a publishing implementation.
- No release metadata, project catalog, preview process, deployment action, or theme sync action exists yet.
- `public/desktop/KCxPCTransparent.png` is a local desktop-only dashboard backdrop. The public site does not import it.
- `D:\KCxProjects\ThemeSync` and `D:\KCxProjects\theme-engine` are reference-only. They have not been modified or linked.

## Next phase

Phase 2 should introduce a validated local project catalog, structured website product/release metadata, atomic persistence, activity records, and a preview-only release publish plan before any files are copied.

## Validation required after every phase

Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` when the workspace becomes a Git worktree. Then launch `npm run dev` and verify the Electron dashboard, preload bridge, and renderer console at runtime.
