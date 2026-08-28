# SnapCal Hosted Calendar — Architecture (Phase 7A: Cloud Foundation)

SnapCal is the hosted, always-online calendar backend behind KsnapCalx
(Windows desktop), KsnapCalxBuddy (Android), and the SnapCal web calendar at
`https://kcxlabs.org/snapcal`. This document covers **Phase 7A only**: the
database schema and API. Phase 7B (web calendar UI), 7C (Windows sync), 7D
(Android sync), and 7E (realtime/offline hardening) build on top of this and
are documented separately as they land.

## Why this exists

Before Phase 7, KsnapCalx's calendar lived only in a local SQLite database on
one Windows PC (see KsnapCalx's `docs/architecture.md`). That is a real
calendar, but it requires the PC to be on for KsnapCalxBuddy (Android) to see
anything, since Phase 6 only added a *local* pairing API bound to
`127.0.0.1`/LAN. SnapCal makes the **hosted service** — not any one device —
the authoritative shared calendar:

```
KsnapCalx Windows ──────┐
                        │
KsnapCalxBuddy Android ─┼──> SnapCal API (Vercel) ──> Neon Postgres
                        │
SnapCal Web ────────────┘
```

Every client talks to the cloud directly. The PC can be off; Android and the
website keep working. Android can be off; the PC and website keep working.
**No client depends on another client being reachable.** The Phase 6 local
API remains useful for local-only Buddy features (e.g. LAN scan upload while
both devices happen to be on the same network) but is explicitly not the
sync authority — see "Phase 6 vs Phase 7" below.

## Reused infrastructure

This is additive to the existing KCx Labs Media Center backend, not a new
service:

- **Same Neon connection** (`server/media-api/_lib/db.ts`'s `createDb`/`Db`)
  — SnapCal's data layer (`server/snapcal-api/_lib/db.ts`) imports it rather
  than opening a second connection path.
- **Same single-owner auth system** (`owners`/`device_tokens` tables,
  `requireDevice()` in `server/media-api/_lib/http.ts`) — a KsnapCalx
  Windows install and a KsnapCalxBuddy Android install each pair via the
  existing `POST /api/auth/pair` (email + password → a bearer device token,
  revocable via `POST /api/auth/revoke`), exactly like the desktop media app
  already does. See "Authentication" below for why reusing this — rather
  than inventing a second credential system — was judged safe.
- **Same single Vercel Function** (`api/router.ts`) — SnapCal's four routes
  are registered there, so this stays one Vercel Function total (Hobby
  plan's 12-function cap), not two.
- **Same config/secret-hygiene rules** (`server/media-api/_lib/config.ts`) —
  SnapCal introduced **zero new environment variables**. It reuses
  `DATABASE_URL`, `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SESSION_SECRET`.

## Database schema

`db/migrations/002_snapcal_init.sql`, applied additively after
`001_media_init.sql` (never edited — migrations are append-only once
applied, per this repo's established convention).

### `snapcal_calendars`

| column | type | notes |
|---|---|---|
| `id` | `TEXT` PK | app-generated (`cal_<uuid>`) |
| `owner_id` | `TEXT` | FK → `owners(id)` |
| `name` | `TEXT` | |
| `color` | `TEXT` | hex color, default `#8b5cf6` (matches KsnapCalx desktop's default) |
| `revision` | `BIGINT` | see "Sync protocol" |
| `deleted_at` | `TIMESTAMPTZ` | tombstone |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

### `snapcal_events`

Mirrors KsnapCalx desktop's local `CalendarEvent` fields (see the KsnapCalx
repo's `packages/calendar-core`) so nothing the desktop already does is
silently discarded when an event round-trips through the cloud:

| column | type | notes |
|---|---|---|
| `id` | `TEXT` PK | app-generated (`evt_<uuid>`) — the **stable server event ID** |
| `calendar_id` | `TEXT` | FK → `snapcal_calendars(id)` |
| `owner_id` | `TEXT` | FK → `owners(id)`, denormalized for fast/scoped queries |
| `title` | `TEXT` | required |
| `description`, `location` | `TEXT`, nullable | |
| `start_at`, `end_at` | `TIMESTAMPTZ` | absolute UTC instants; `CHECK (end_at >= start_at)` |
| `all_day` | `BOOLEAN` | |
| `timezone` | `TEXT` | IANA name the event was authored in — see "Timezone-safe representation" |
| `category_id` | `TEXT`, nullable | preserves KsnapCalx's category feature |
| `reminder_offset_minutes` | `INTEGER`, nullable | preserves KsnapCalx's reminders |
| `recurrence_frequency`/`interval`/`until_date`/`occurrence_count` | nullable | preserves KsnapCalx's recurrence |
| `client_mutation_id` | `TEXT`, nullable | see "Idempotent writes" |
| `revision` | `BIGINT` | see "Sync protocol" |
| `deleted_at` | `TIMESTAMPTZ`, nullable | tombstone, see "Deletion" |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

**Timezone-safe representation**: `start_at`/`end_at` are always absolute
UTC instants (unambiguous, comparable, indexable), and `timezone` separately
records the IANA zone the event was authored in, so a client can always
recover the original wall-clock time — not just a UTC instant that's already
lost which "10:00 AM" it was.

Extensibility for category/recurrence/reminders is deliberate: these are
real typed columns (matching KsnapCalx's own `005_calendar_hardening`
migration and this repo's own "no JSON blobs" convention for indexable
data), not squeezed into an existing generic field.

## API

Base path: **`/api/snapcal/v1`** — versioned so a client can detect
incompatibility before relying on anything else.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness + version. |
| GET | `/calendars` | device token | The owner's calendars (auto-provisions a default one). |
| GET | `/events?calendarId=` | device token | Full listing (excludes tombstones). |
| GET | `/events?calendarId=&sinceRevision=N` | device token | **Incremental pull** — everything past revision N, tombstones included. |
| POST | `/events` | device token | Create (body includes `calendarId`). |
| GET | `/events/:id?calendarId=` | device token | Retrieve one event. |
| PATCH | `/events/:id` | device token | Update (`calendarId`, `expectedRevision`, changed fields). |
| DELETE | `/events/:id` | device token | Tombstone (`calendarId`, `expectedRevision`). |

Error envelope: `{ "error": { "code": "...", "message": "..." } }` (same
shape KsnapCalx's own local Phase 6 API already uses, for consistency
across the two APIs a client implementer has to learn). Status codes: `200`,
`201`, `400`, `401`, `404`, `405`, `409` (see "Conflict semantics"), `500`.

There is intentionally **no calendar-wide "download everything" endpoint
beyond the first full `GET /events`** — every subsequent sync uses
`sinceRevision`, never a full re-fetch.

## Authentication

Two roles exist in principle, though this app has exactly one human owner
today:

- **Human/web authentication** — the browser at `kcxlabs.org/snapcal` will
  authenticate as the site's existing admin/owner. Phase 7A does not add a
  new browser-session mechanism: it reuses `signSession`/`verifySignedSession`
  in `server/media-api/_lib/auth.ts`, already built for exactly this ("used
  only for the browser admin session cookie") but not yet wired to any
  route. Phase 7B wires the SnapCal web UI to this cookie flow.
- **Native client/device authorization** — KsnapCalx (Windows) and
  KsnapCalxBuddy (Android) each authenticate as a *device*, via the
  **existing** `POST /api/auth/pair` → bearer token → `Authorization: Bearer
  <token>` on every SnapCal request, verified by the **existing**
  `requireDevice()` (SHA-256 token hash lookup, revocation/expiry checked on
  every request, `last_used_at` touched).

**Why reusing the existing device-token system was judged safe** (per the
requirement to explicitly evaluate this rather than assume it): this is
already an internet-facing (not LAN-only), server-issued, individually
revocable, SHA-256-hashed, 180-day-expiring credential — built for exactly
this purpose (a native client authenticating to this Vercel deployment) and
already used by the desktop media app the same way. It is a **completely
separate system** from KsnapCalx's own Phase 6 *local* LAN pairing tokens
(those are generated and verified entirely inside the Windows app's own
`node:http` server for `127.0.0.1`/LAN use — see KsnapCalx's
`docs/buddy-api-v1.md` — and never reach this repo or Neon at all). No
Phase 6 credential is reused as an internet credential; a fresh pairing
against **this** service is required.

Authorization is calendar-scoped in the sense the system currently has: a
single owner (`owner_kcx`) owns every calendar and event, and `owner_id` is
checked on every SnapCal query — a device token can never see or mutate
another owner's data, and (once a second owner exists) rows are already
partitioned by `owner_id` so multi-owner requires no data migration, mirroring
`001_media_init.sql`'s original owners design.

Every protected route fails closed: missing/malformed/unknown/expired/revoked
tokens all return `401` before any database write is attempted.

## Sync protocol

**Stable server IDs.** `snapcal_events.id` is generated once at creation
(`evt_<uuid>`) and never changes — a client's local cache keys off it.

**Monotonic revision.** `snapcal_revision_seq` is one Postgres sequence
shared by both tables. Every insert and every update (including
tombstoning) is assigned `nextval('snapcal_revision_seq')`. A client
persists the single highest revision number it has seen and passes it back
as `sinceRevision` on its next pull — one number is enough to resume sync
from any point, across both calendars and events.

**Incremental pull**: `GET /events?calendarId=&sinceRevision=N` is the
entire read side of sync. It returns every row (active or tombstoned) with
`revision > N`, ordered by revision, capped at 2000 rows per call so a huge
backlog is paginated by repeatedly advancing the cursor rather than risking
an unbounded response.

**Idempotent writes / duplicate-retry safety.** A client generates a
`clientMutationId` once per logical "create this event" action and resends
the *same* value if the request needs to be retried (timeout, dropped
connection, etc.). `snapcal_events` has a partial unique index on
`(calendar_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL`;
`POST /events` uses `ON CONFLICT ... DO NOTHING` and, on conflict, returns
the **already-created** event with `duplicate: true` instead of erroring or
creating a second row — the same "duplicate is a non-destructive success,
not an error" pattern KsnapCalx's own local scan-upload API already uses.

**Tombstones, not deletes.** `DELETE /events/:id` sets `deleted_at` and
bumps `revision`; the row is retained. A client that was offline during a
deletion learns about it on its next `sinceRevision` pull instead of the
event silently vanishing from a query it never re-runs from scratch. (Long-
term tombstone retention/pruning is explicitly deferred to Phase 7E.)

## Conflict semantics

**Chosen strategy: optimistic concurrency via `expectedRevision`, last-write-
wins only when there is no conflict.** Every `PATCH`/`DELETE` must include
`expectedRevision` — the revision the client last observed for that event.
The database update is a compare-and-set:

```sql
UPDATE snapcal_events SET ... , revision = nextval(...)
WHERE id = $1 AND revision = $expectedRevision AND deleted_at IS NULL
```

- If the row's current revision still matches, the write succeeds and a new
  revision is assigned.
- If it doesn't match (someone else — another device, or the same device
  from a stale cache — changed it first), **the write is refused**: `PATCH`
  returns `409 REVISION_CONFLICT` with the current server row in the
  response body; the client decides what to do (show the user both
  versions, retry with the new revision and their intended change reapplied,
  or discard their edit). The server never silently picks a winner.
- Deleting an already-tombstoned event is treated as an idempotent success
  (not a conflict) — retrying a delete you already know succeeded should not
  itself become an error.
- A row that doesn't exist at all (wrong id, or never synced to this
  device) returns `404`, distinct from `409`.

This is deliberately a **simple, understandable strategy** — compare-and-set
plus "loser sees a conflict and decides" — rather than a CRDT or automatic
per-field merge. A more automatic merge strategy is a candidate for Phase 7E
*if* real usage shows plain conflicts are too disruptive, but is not
justified before there is a second real client to conflict with anything.

## Deferred to later subphases

- **7B**: the actual `kcxlabs.org/snapcal` web calendar UI, and wiring the
  browser session-cookie login this document reserves for it.
- **7C**: KsnapCalx Windows sync engine (local SQLite as offline cache,
  push/pull against this API, migrating existing local events).
- **7D**: KsnapCalxBuddy Android sync (mirrors 7C's responsibilities on
  Android; Android must not depend on the Windows PC being on).
- **7E**: realtime delivery (so an online client doesn't need a manual
  refresh to see another online client's change) and additional offline
  hardening (exponential backoff, clock-skew handling, tombstone retention
  policy, partial-sync-failure recovery).

## Phase 6 (local) vs Phase 7 (cloud) — which API does what

| | Phase 6 local API (KsnapCalx) | Phase 7 SnapCal API (this doc) |
|---|---|---|
| Authority | None — a local convenience, not a sync source of truth | **Authoritative** shared calendar |
| Reachable when PC is off | No | Yes |
| Binding | `127.0.0.1` or LAN, opt-in | Public internet (Vercel) |
| Auth | Its own local pairing codes + device tokens, verified entirely inside the Windows app | KCx Labs' existing owner/device-token system, verified against Neon |
| Purpose | LAN scan-photo upload from a paired Buddy phone while both devices are on the same network | Calendar CRUD + sync for every client, everywhere |
| Calendar sync | **Not implemented** (explicitly out of scope — see KsnapCalx's `docs/buddy-api-v1.md`) | This is its entire purpose |

The two are independent and both remain useful: Phase 6 for local-only scan
intake, Phase 7 for the actual shared calendar.

## Threat model (Phase 7A)

| Threat | Defense |
|---|---|
| Unauthenticated internet request | Every route but `/health` calls `requireDevice()` first; fails closed with `401`. |
| Stolen/leaked device token | Revocable via the existing `POST /api/auth/revoke`; only a SHA-256 hash is stored, so a database disclosure alone isn't a usable credential. |
| Cross-owner data access | Every query filters by `owner_id` derived from the verified token, never from client-supplied input. |
| Cross-calendar data access | `calendar_id` is always checked alongside `owner_id` in the same query — a token for one owner can't be pointed at another owner's calendar id to read/write it (the `WHERE owner_id = ... AND calendar_id = ...` combination fails to match if they don't actually belong together). |
| Oversized/malformed request body | `readJson()` already used by every route rejects non-JSON/non-object bodies; field-level validation (`server/snapcal-api/_lib/validate.ts`) rejects wrong types and truncates overlong strings before they reach a query. |
| Duplicate event from a retried request | `client_mutation_id` + partial unique index — see "Idempotent writes." |
| Silent data loss from a race | `expectedRevision` compare-and-set — see "Conflict semantics." |
| Browser CORS abuse | This API is not intended as a general browser API for arbitrary origins; the existing `androidCorsHeaders()` allowance in `_lib/http.ts` is scoped to the packaged Android app's exact origin only. The SnapCal web page itself is same-origin (`kcxlabs.org` calling `kcxlabs.org/api/...`), so no additional CORS grant was needed for it. |
| Privileged credentials reaching the browser | Unchanged from the existing architecture: `DATABASE_URL` etc. are read only in `server/media-api/_lib/config.ts`, never `VITE_`-prefixed, never referenced from `src/`. SnapCal introduces no new secret. |

**Known limitation, disclosed rather than hidden**: because `requireDevice()`
calls the full `loadAppConfig()` (which also validates R2 configuration),
a SnapCal-only deployment would still require R2 environment variables to be
present, even though SnapCal itself never uses R2. This is a real coupling,
acceptable today because this Vercel project already serves the Media
Center (which does need R2) — a future split into fully independent
services would need `loadAppConfig()` broken into truly independent
per-domain loaders. Not addressed in Phase 7A to avoid a speculative
refactor of working, unrelated code.
