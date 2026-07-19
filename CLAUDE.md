# CLAUDE.md — KCxLabs website

Guidance for Claude Code in this repository. See [README.md](./README.md) for the product overview,
[USER_GUIDE.md](./USER_GUIDE.md) for the desktop workflow, and [CLAUDE_HANDOFF.md](./CLAUDE_HANDOFF.md)
for the Electron platform baseline. This file covers rules, not features — do not duplicate those docs here.

## 1. Purpose and architecture

One repository, two build targets sharing `src/`:

- **Public website** — React 19 + Vite 6 + TypeScript, static, no backend. This is what ships to Vercel.
- **Desktop shell** — Electron publishing platform (`electron/`, `src/desktop/`). Desktop-only; never deployed.

`src/App.tsx` branches on `window.kcxDesktop`: when the preload bridge is present it renders `DesktopApp`,
otherwise the public site. The renderer stays unprivileged (context isolation on, sandboxed, no Node
integration, one typed bridge). Do not widen that bridge to serve website features.

Layout: `src/components/{layout,sections,pages,ui}`, data in `src/data/`, tokens in `src/styles/theme.ts`,
Electron main/preload/services in `electron/`, node:test suites in `tests/`, canonical theme in `theme-engine/`.

## 2. Deployment facts (confirmed — do not change)

| | |
|---|---|
| GitHub repo | `kcxrhea-bit/kcxlabs-site` |
| Vercel project | `kcxlabs-site` |
| Production domain | `kcxlabs.org` |
| Framework preset | Vite |
| Root directory | `./` |
| Build command | `npm run build` (`tsc -b && vite build`) |
| Output directory | `dist` |
| Node.js | 24.x |
| Plan | Hobby |
| Production trigger | Git push to GitHub — Vercel builds automatically |

`vercel.json` rewrites all paths to `/index.html` (SPA fallback). `vite.config.ts` sets `base: "./"`.
Both are load-bearing for routing — changing either breaks deep links such as `/beta`.

Because production deploys straight from Git, **a push is a deploy.** Treat it as such.

## 3. Routing and component conventions

Routing is deliberately dependency-free: no React Router. `App.tsx` reads `window.location.pathname`,
strips a trailing slash, and compares it. Homepage sections are stacked children of `AppShell`;
standalone pages live in `src/components/pages/`.

- Named exports, `PascalCase` function components, one component per file.
- Props typed with a local `type XProps = { ... }`; `import type` for type-only imports.
- Homepage nav is anchor-based (`#home`, `#ecosystem`, …) from `src/data/navigation.ts`.
- Icons come from `lucide-react` only.
- Content lives in typed arrays/objects in `src/data/`, not inline in JSX.
- Every section: `<section id="…" className="section-shell">`, with a `SectionHeader` where a heading fits.

## 4. Styling and visual language

Tailwind CSS v4 via `@tailwindcss/vite` — configured in CSS, not a `tailwind.config.js`. Design tokens are
`@theme` custom properties in `src/index.css`, mirrored for TS consumers in `src/styles/theme.ts`.

Palette: `kcx-black` `#050506`, `kcx-forge` `#121214`, `kcx-orange` `#ff7a1a`, `kcx-red` `#e33117`,
`kcx-steel` `#e7edf2`, `kcx-ash` `#8e9197`, `kcx-cyan` `#37d5ff`.

The look is a dark forged-metal console: sharp corners (panels are unrounded by default), 1px translucent
white borders, layered gradient + inset-highlight panel backgrounds, orange for primary/active and cyan for
secondary/system signals, uppercase micro-labels with wide `tracking-[0.16em]`–`[0.28em]`.

Reuse the existing composite classes rather than inventing new ones: `section-shell`, `system-panel`,
`studio-panel`, `future-card`, `project-preview-card`, `micro-panel`, `button-primary`, `button-secondary`,
`icon-chip`, `telemetry-line`, `focus-ring`. Add a new class to `index.css` only when nothing fits.

Accessibility is already established and must be preserved: skip link, `focus-ring` / `:focus-visible`
outlines, `aria-label` on nav and icon-only controls, `scroll-margin-top` for the fixed header,
44px minimum touch targets. Framer Motion is available — keep motion subtle.

## 5. Adding pages and features

New page: create it in `src/components/pages/`, add the pathname branch in `App.tsx`, wrap in `AppShell`,
add a nav entry in `src/data/navigation.ts` only if it should be publicly discoverable. The SPA rewrite
already handles the server side — no `vercel.json` change is needed for a new route.

New section: create it in `src/components/sections/`, mount it in the `App.tsx` homepage fragment in visual
order, give it a stable `id` if it is a nav target, and put its copy in `src/data/`.

Keep the dependency surface as-is. Do not add a router, state manager, CSS framework, or UI kit.
Match the status vocabulary already in `src/data/projects.ts`: `Active Build`, `In Development`,
`Planned Layer`, `Research / Prototype`.

## 6. Security

- **Never put secrets in `VITE_*` variables.** Anything Vite inlines at build time ships in the public
  bundle and is readable by any visitor. This site needs no secrets — it is a static frontend with no backend.
  `VITE_DEV_SERVER_URL` (used by `scripts/dev-electron.mjs`) is a local dev URL and the only expected one.
- **Never expose KCxLocalAI tokens, gateway credentials, or endpoints** in source, config, docs, or committed data.
- **Never expose local filesystem paths** (`D:\KCxProjects\…`, user profile paths, machine names) in website
  source, rendered copy, or docs. Note: `src/data/publishing-catalog.json` is tracked and currently holds ~34
  absolute local paths. It is read only by the Electron main process and tests — **no website code imports it,
  so it does not reach the deployed bundle.** Do not import it from `src/` outside `src/desktop/`, and do not
  add new local paths to it. See §Conflicts below.
- **Never add a public tunnel to ports 8788 or 8790** — no ngrok/cloudflared/localtunnel, no proxy or rewrite
  in `vercel.json` pointing at them. These stay loopback-only.
- Keep external links `target="_blank" rel="noopener noreferrer"`. Never commit `.env*` (already gitignored).

## 7. Scope boundaries

- Do not modify **KCxLocalAI** or **KCxNexusMirror**, in this repo or on disk. Reference only.
- `D:\KCxProjects\ThemeSync` and `D:\KCxProjects\theme-engine` remain reference-only and unlinked.
- Do not migrate frameworks (no Next.js, Remix, Astro, Vue) or swap the build tool.
- Do not change Vercel project linkage, the production domain, DNS, SSL, or the Git integration.
- Do not edit `vercel.json`, `vite.config.ts` `base`, or the build/output settings without an explicit request.
- Website work does not touch `electron/` and desktop work does not change public-site rendering.

## 8. Git safety

- Run `git status` before editing and report anything already dirty rather than absorbing it into your change.
- **Never push and never deploy automatically.** Pushing to GitHub triggers a production deploy to
  `kcxlabs.org`. Commits are fine when asked; pushing is the operator's call.
- Never run `git reset --hard`, `git clean`, force-push, history rewrites, or recursive deletes.
- Current state: branch `master`, **no remote configured** (see §Conflicts).
- `.claude/settings.json` encodes these rules as permissions. Preserve it; extend rather than replace.

## 9. Required validation

Run all four before reporting work complete, from the repo root (PowerShell — use `npm.cmd` if `npm` fails):

```powershell
npm run typecheck   # tsc -b + electron tsconfig --noEmit
npm test            # builds electron, then node --test tests/*.test.mjs
npm run build       # tsc -b && vite build
git diff --check    # whitespace errors and conflict markers
```

Report real results. If a command fails, say so and paste the output — never describe unrun checks as passing.
For desktop changes also launch `npm run dev` and verify the dashboard, preload bridge, and renderer console.

## 10. Reporting

Close every task with: files created; files modified; routes added; validation results (all four commands,
actual output); anything intentionally left incomplete; and deployment + rollback instructions.

Deployment is manual and operator-run: commit, then the operator pushes to `kcxrhea-bit/kcxlabs-site`, and
Vercel builds production automatically. Rollback: promote the previous deployment in the Vercel dashboard
(instant, no rebuild), or revert the commit and let the operator push. Never perform either yourself.

## 11. Hybrid Cloud truthfulness

The site must not overstate what exists. This is non-negotiable, including in marketing copy.

- **Local Mode** may be described as available.
- **Hybrid Mode** and **Cloud Mode** must be described as *planned* or *preview* — never as live, shipping,
  or available.
- Never build fake dashboards, device lists, usage meters, sync indicators, telemetry, or cloud activity.
  No mock data presented as real, no placeholder counters that imply live systems.
- Never claim cloud AI is operational unless it is actually implemented and verified in this repository.
- Use the existing status vocabulary (`Planned Layer`, `In Development`, `Research / Prototype`) and keep
  unbuilt routes as non-navigable teasers, the way `FuturePreviewSection` already does.

## Conflicts / unclear areas

Flagged during setup, not changed — these need an operator decision:

1. **No git remote is configured** (`git remote -v` is empty) although production is documented as deploying
   from `kcxrhea-bit/kcxlabs-site`. Pushing will require adding the remote first. Confirm the URL before doing so.
2. **Local branch is `master`; Vercel production is typically wired to `main`.** Verify which branch triggers
   production before any push.
3. **`src/data/publishing-catalog.json` contains ~34 absolute `D:\KCxProjects\KCxLocalAI\…` paths** and is
   git-tracked. Not currently a public leak (no website import), but it is a disclosure risk if the repo is
   public or if that file is ever imported into `src/`. Worth scrubbing to relative paths or slugs.
4. **No `lint` script exists** in `package.json` despite lint being a standard gate. `typecheck` covers types only.
5. **`engines` / Node version is not pinned** in `package.json` while Vercel is set to Node 24.x. Consider
   pinning so local and CI builds match.
