# KCx NEXUS Hybrid Cloud — website preview

Phase 1 of the NEXUS Hybrid Cloud website foundation. This document covers what the preview is, what
it deliberately is not, and what a future backend phase will have to supply.

## 1. Purpose

Publish an accurate public description of KCx NEXUS and establish typed frontend boundaries for future
cloud work, without shipping any cloud functionality.

The governing rule is truthfulness. Local Mode is real and may be described as available. Cloud Mode and
Hybrid Mode are not implemented and are described only as in development or planned. No page fabricates
devices, projects, usage, sync events, sessions, billing, uptime, or account state.

## 2. Local Mode — what actually works

Physically validated end to end on a real Android device against gateway build
`20260719-project-path-validation-03`:

- Android companion application
- Secure one-time pairing
- Authenticated private Mirror Gateway
- KCxLocalAI integration
- Approved-project filtering with a path-validated registry
- Project-aware chat, Android → gateway → KCxLocalAI → Android
- No crash or ANR during final validation

Local Mode requires the user's PC and gateway to be running. Model execution and project files stay on
the user's machine.

## 3. Routes added

| Route | Page | Notes |
|---|---|---|
| `/nexus` | `src/components/pages/NexusCloudPage.tsx` | Product page: hero, modes, architecture, privacy, roadmap |
| `/nexus/portal` | `src/components/pages/NexusCloudPortalPage.tsx` | Portal preview, not a live console |

The former `/nexus-cloud` and `/nexus-cloud/portal` paths are permanent (308) redirects to the canonical
routes, declared in `vercel.json` ahead of the SPA catch-all. They are not duplicate pages.

Routing stays dependency-free. `src/routes.ts` resolves a pathname to a `PublicRoute`; `src/App.tsx`
renders the matching page. Unknown paths still fall back to the homepage, and the `window.kcxDesktop`
Electron switch remains the first branch in `App.tsx`.

### Required `vercel.json` change

`vite.config.ts` sets `base: "./"`, so the built `index.html` references assets **relatively**
(`./assets/index-*.js`). Electron depends on this: `electron/main.ts` loads the bundle through
`loadFile()` over `file://`, where an absolute `/assets/...` path would resolve to the filesystem root
and break the desktop app.

That relative base breaks two-segment web routes. At `/nexus/portal`, the SPA rewrite serves
`index.html`, and the browser resolves `./assets/index-*.js` against `/nexus/`, requesting
`/nexus/assets/index-*.js`. That path does not exist, so the catch-all rewrite returns
`index.html` with `content-type: text/html` for a script request — the browser refuses to execute it and
the page renders blank. (`/beta` is unaffected: one segment deep, assets still resolve against `/`.)

One rewrite was added ahead of the catch-all to map those nested asset requests back to the real files:

```json
{ "source": "/nexus/assets/(.*)", "destination": "/assets/$1" }
```

Verified by serving `dist/` through a simulation of Vercel's rule order: without the rule the script
request returns `text/html`; with it, `text/javascript` and the real bundle. The SPA catch-all is
unchanged and remains last.

**Any future route nested two or more segments deep needs the same treatment**, or a switch to
`base: "/"` combined with a custom protocol handler in Electron. That larger change was out of scope here.

## 4. Frontend module architecture

```
src/cloud/
  types.ts     typed models, no logic
  config.ts    VITE_* parsing with safe defaults
  service.ts   synchronous status provider, no network
  index.ts     public surface
src/data/nexus-cloud.ts          typed page content
src/components/nexus-cloud/      StatusBadge, ModeCard, ArchitectureDiagram, CapabilityList, RoadmapList
src/components/pages/            NexusCloudPage, NexusCloudPortalPage
src/routes.ts                    pathname resolver
```

`service.ts` is deliberately **synchronous**. There is no backend, so a promise-based API would imply a
network round trip that never happens. When a real backend exists, add an async provider alongside it
rather than making the current function pretend to be remote.

## 5. Typed models

`NexusCloudStatus` (`disabled` | `preview` | `private-beta` | `available`), `NexusExecutionMode`
(`local` | `cloud` | `automatic`), `NexusFeatureState` (`verified` | `in-development` | `planned` |
`future`), `NexusCloudFeature`, `NexusCloudConfig`, `NexusCloudServiceStatus`.

`verified` is reserved for capabilities physically validated on real hardware.

## 6. Feature flags and 7. safe defaults

All variables are optional. A build with none set produces:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_NEXUS_CLOUD_STATUS` | `preview` | Unknown values fall back to `preview`, never `available` |
| `VITE_NEXUS_CLOUD_PREVIEW` | `true` | Product page visible |
| `VITE_NEXUS_CLOUD_PORTAL` | `true` | Portal preview visible |
| `VITE_NEXUS_CLOUD_CHAT` | `false` | Cloud chat |
| `VITE_NEXUS_CLOUD_SYNC` | `false` | Project sync |
| `VITE_NEXUS_DEVICE_SYNC` | `false` | Device sync |
| `VITE_NEXUS_CLOUD_API_BASE_URL` | unset | Future cloud API origin |

Two safety properties are enforced in `config.ts`:

- **Cloud capabilities need two independent conditions.** Chat, sync, and device sync require an explicit
  opt-in *and* a status of `private-beta` or `available`. A `preview` build cannot enable them by accident.
- **The API base URL rejects private networks.** Only an absolute `https` origin on a public host is
  accepted. Plain `http`, `localhost`, loopback, `10.x`, `192.168.x`, `172.16–31.x`, and `.local` are all
  rejected, so this value can never be pointed at the LAN Mirror Gateway. Browser code therefore cannot be
  configured to call the private gateway.

Invalid values fail safe rather than throwing. No cloud variable is required for a successful build.

## 8. `VITE_*` variables are public

Vite inlines every `VITE_*` value into the client bundle at build time. They are readable by any visitor
via view-source or devtools. **Never put a secret, token, credential, or provider API key in one.** The
declared list lives in `src/vite-env.d.ts`, which carries the same warning.

## 9. Explicitly not implemented

No cloud backend, API endpoint, or Vercel Function. No accounts, authentication, or device registration.
No cloud chat, inference, or provider calls. No project or device synchronization. No cloud memory. No
billing. No email capture or beta signup form. No public tunnel or remote access to the local gateway.

The portal preview reads configuration state only; it never contacts anything.

## 10–14. Future backend requirements

When a cloud phase begins:

- **Backend.** A real API is needed; `VITE_NEXUS_CLOUD_API_BASE_URL` is only a placeholder. Vercel Hobby
  has no always-on server, so expect serverless functions or an external host.
- **Authentication.** Accounts and device registration must exist before any per-user cloud state. Tokens
  belong in server-side storage or an httpOnly cookie, never in a `VITE_*` variable or the Android APK.
- **Rate limiting.** Any inference endpoint needs per-account and per-device limits plus abuse controls.
  Hobby provides none of this.
- **AI provider cost controls.** Provider calls must originate server-side with budget caps, per-account
  quotas, model selection limits, and alerting. Never call a provider from frontend JavaScript — the key
  would be public.
- **Database and storage.** Accounts, devices, and any opt-in project snapshots need a managed database.
  Snapshots must stay explicit and per-project, with retention and deletion controls. Nothing is uploaded
  automatically.

## 15. Privacy and security boundaries

Local projects are not uploaded automatically. Project sync will be opt-in. Cloud Mode cannot read files
that exist only on an offline PC. Local filesystem paths are not exposed publicly. Provider secrets are
not placed in the Android application. Local Mode stays usable with no cloud subscription or connection.
The private gateway is not exposed to the public internet.

These are design commitments, not claims about certification, encryption standards, or regulatory status.

`src/data/publishing-catalog.json` contains absolute local Windows paths and is Electron-only. It is not
imported by any website code, and a test enforces that. Do not import it into `src/` outside `src/desktop/`.

## 16. Vercel Hobby constraints

No always-on compute, limited serverless execution time, no team-level protections, and non-commercial
terms. A production cloud backend will likely require a paid plan or separate hosting. Nothing in this
phase depends on any of it — the output is fully static.

## 17–18. Deployment preparation and the manual requirement

Build settings are unchanged: framework Vite, root `./`, build `npm run build`, output `dist`, Node 24.x.
No new environment variable is required; leaving all of them unset yields the intended preview.

**Deployment is manual and operator-run.** Production deploys directly from GitHub, so pushing is
deploying. At the time of writing this repository has **no git remote configured** and sits on branch
`master`; it is unconfirmed whether Vercel builds from `main` or `master`. Confirm the remote URL and the
production branch before any push. Claude does not push or deploy.

## 19. Rollback

1. **Fastest:** promote the previous deployment in the Vercel dashboard. Instant, no rebuild.
2. **Source:** revert the commit and let the operator push, which triggers a fresh production build.
3. **Disable without reverting:** rebuild with `VITE_NEXUS_CLOUD_PREVIEW=false` and
   `VITE_NEXUS_CLOUD_PORTAL=false`. The routes then fall through to existing behaviour.

## 20. Warning — never expose the LAN gateway

The Mirror Gateway is authenticated but designed for a private network. **It must never be exposed
directly to the public internet**, whether by port forwarding, a reverse proxy, or a tunnel such as
ngrok or cloudflared. Cloud access must arrive through a purpose-built cloud API with its own
authentication and rate limiting — not by making the local gateway reachable.

A test asserts that no browser-facing source references the gateway ports, and `config.ts` structurally
rejects private-network API URLs.
