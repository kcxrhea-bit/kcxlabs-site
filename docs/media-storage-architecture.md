# KCx Media Center — storage, archive, and restore architecture

Design notes for the two-tier media system. Nothing in this document describes a
working cloud integration: at the time of writing **no R2 bucket and no Neon
database exist**, and no code in this repository has ever contacted either
service. Sections describing Cloudflare are a *plan*, not a report.

## 1. The two tiers

| Tier | Where the original lives | Share page | Costs storage |
|---|---|---|---|
| **ONLINE** | Cloudflare R2 | Video player | Original + thumbnail |
| **ARCHIVED_OFFLINE** | `D:\OldclipsfromKCxlabs` on the PC | Poster + "archived" notice | Thumbnail only |

R2 is **bounded hot storage**. The PC is the long-term archive. Media moves
between tiers in both directions, and the `publicId` never changes — so
`https://kcxlabs.org/c/<publicId>` keeps working across archive and restore.
That URL stability is the central promise of the design.

Archiving is not deletion of a *record*. When the original leaves R2, everything
else stays: `MediaItem`, `publicId`, title, description, game, event type, tags,
dates, visibility, favourite/featured, collections, thumbnail, and archive
metadata. A PUBLIC archived clip still appears on `/clips`.

## 2. State machine

One machine spans both tiers — deliberately not two. `src/media/types.ts` holds
the single definition; `allowedArchiveTransitions` is the only authority.

```
                    ┌──────────────────────── active ◄──────────────────┐
                    │                            │                      │
                    │                            ▼                      │
                    │                    archive_eligible               │
                    │                            │                      │
                    │                            ▼                      │
                    └──── archived_local ◄─ archive_downloading ─► archive_failed
                                 │                                      │
                                 ▼                                      │
                        cloud_delete_pending ──────────────────────────┘
                                 │
                                 ▼
                         archived_offline ◄──────┐
                            │        │           │
                            ▼        ▼           │
                  restore_requested  restoring ──┴──► restore_failed
                                        │
                                        ▼
                                     active
```

`archived_offline` replaced the earlier `cloud_deleted`. The old name implied a
destroyed item; the reality is relocation, and the item is fully restorable.

Two edges matter more than the rest:

- **Nothing reaches `archived_offline` without passing through
  `archived_local`**, which requires a checksum-verified local copy.
- **`restore_failed` cannot reach `active`.** A missing or corrupt local file
  can never be presented as a playable clip.

`canTransitionArchiveState()` fails closed: unknown states return `false`.

## 3. Storage budget

`src/media/storage-budget.ts`. Pure, so every branch is testable without
credentials.

| Band | Range | Behaviour |
|---|---|---|
| `normal` | < 7 GB | Uploads proceed |
| `archive_recommended` | 7 GB – < 8 GB | Uploads proceed, archiving surfaced in the UI |
| `uploads_paused` | ≥ 8 GB | Uploads refused |

A stricter **6 GB ceiling applies to automatic uploads only** whenever provider
metrics are stale or unavailable — see *Failure modes and degraded mode* below.

R2 Standard's free allowance is 10 GB. **We plan against 8 GB**, reserving ~2 GB
of headroom, because our view of the bucket is never perfectly exact or fresh:
provider metrics lag, failed multipart uploads can leave parts behind, and
billing is measured over time rather than at an instant. Reacting at 9.9 GB
would be reacting too late.

**The incoming file is counted before the upload starts.** At 7.9 GB used, a
400 MB clip is refused up front rather than discovered to be over the line
afterwards.

### Three numbers that are not interchangeable

1. **Local estimate** — `totalOnlineBytes()` over our own records. Always
   available, instantly current, authoritative about what we *intended*. Blind
   to objects we do not know about.
2. **Provider-reported bytes** — `payloadSize + metadataSize` from Cloudflare.
   A point-in-time measurement of what is physically in the bucket. Can lag,
   can be unavailable.
3. **Billable usage (GB-month)** — what Cloudflare actually charges on. An
   integral of stored bytes over time, **not** a snapshot. Deleting 3 GB today
   does not undo GB-month already accrued this month.

**The budget plans against the larger of (1) and (2).** We deliberately do not
compute or display (3) as a number, because we cannot derive it reliably. The UI
carries `BillingNote.storageMetric` instead.

The `source` field (`cloudflare_api` / `cloudflare_api_stale` / `local_estimate`)
travels all the way to the UI, so a local estimate is never labelled as an
official Cloudflare measurement. Its label literally reads "not an official
Cloudflare measurement".

### Failure modes and degraded mode

When Cloudflare's measurement is stale (older than 1 hour) or unavailable, the
budget enters **degraded mode**. Only the local estimate is left, and it is
structurally blind to objects KCxLabs did not create — orphaned multipart parts,
files uploaded by another tool, thumbnails left by a failed cleanup. That blind
spot is unbounded, so a stricter ceiling applies.

| Situation | Status | Automatic uploads | Manual uploads |
|---|---|---|---|
| Fresh reading | `normal` / `archive_recommended` / `uploads_paused` | Normal 7 / 8 GB bands | Normal, no warning |
| Stale or missing, projected **local** < 6 GB | `metrics_stale` / `metrics_unavailable` | Allowed | Allowed **with a warning** |
| Stale or missing, projected **local** ≥ 6 GB | `metrics_stale` / `metrics_unavailable` | **Paused** until fresh metrics | Allowed with a stronger warning |
| Projected max(local, provider) ≥ 8 GB | `uploads_paused` | Paused | Paused |

Key details:

- The **6 GB degraded ceiling is measured against the local figure**, since that
  is the number whose blind spot we are compensating for. The 8 GB hard ceiling
  is still measured against `max(local, provider)`, so a large stale provider
  reading still pauses everything.
- Automatic uploads pause because they are **unattended**. Manual uploads are the
  owner making a deliberate choice, so they proceed — but never silently:
  `manualUploadWarning` is non-null throughout degraded mode.
- `autoUploadAllowed` is guaranteed never to be more permissive than
  `uploadAllowed`; this is asserted in tests.
- Automatic uploads resume on their own once Cloudflare reports current usage.
  No manual reset is needed.

Losing Cloudflare visibility never becomes a route to exceeding a ceiling.

Thresholds are configurable via `MediaSettings` (`storageWarningBytes`,
`storagePauseBytes`, `storageDegradedBytes`), and `normalizeThresholds()` refuses
unsafe orderings — including a degraded ceiling above the hard ceiling, which
would defeat its purpose.

## 4. Cloudflare integration plan — NOT YET IMPLEMENTED

**Intended API:** the Cloudflare **GraphQL Analytics API**, dataset
`r2StorageAdaptiveGroups`, at `https://api.cloudflare.com/client/v4/graphql`.

Per Cloudflare's documentation this dataset exposes, under `max`:

- `payloadSize` — size of the objects in the bucket
- `metadataSize` — size of object metadata
- `objectCount` — number of objects
- `uploadCount` — pending multipart uploads

Grouped by `bucketName` and `datetime`, filtered by `accountTag` (the account
ID), with roughly 31 days of retention.

- **Token permissions:** an API token with **Account Analytics: Read**. Storage
  reads and writes use a *separate* R2 token scoped to the single bucket. The
  analytics token needs no bucket access, and neither token is an account-wide
  admin token.
- **No dashboard scraping, no browser automation, no Cloudflare login inside
  KCxLabs.** Tokens are server-side environment variables only, never `VITE_*`.
- **Caching:** readings land in the `storage_metrics` table, which records
  `measured_at` (when Cloudflare measured) separately from `fetched_at` (when we
  asked). Staleness is computed from `measured_at`.
- **Operation counts:** `r2OperationsAdaptiveGroups` is the corresponding
  dataset for Class A/B operations. Storage is the immediate concern, so this is
  documented but not a v1 requirement. `operationClassByAction` records which
  action consumes which class (uploads, multipart parts, completes, list, and
  delete are Class A; downloads and metadata reads are Class B).

**Unverified.** These field names come from Cloudflare's published schema docs,
not from a call we have made. The exact query must be confirmed against a real
account before anything depends on it.

## 5. Archive candidate selection

`src/media/archive-candidates.ts`. **Selection is not deletion.** This module
only decides what the desktop should download and verify next.

Absolute exclusions, checked before any ranking, so no amount of storage
pressure can promote an excluded item:

- Keep Online
- not an active record (pending / deleted)
- original already offline
- a transfer in flight (`archive_downloading`, `cloud_delete_pending`, `restoring`)
- original not retrievable
- nothing to free

Ranking tiers, lowest first:

0. **Already verified locally** — freeing costs nothing and risks nothing
1. **Past retention** — archiving was already the intended outcome
2. **Archived early** — only because space is needed

Then: non-pinned before featured/favourite → oldest first → larger first → id.
Ordering is fully deterministic; identical input always produces identical
output. It is explicitly **not** "delete the biggest file".

If the plan cannot free enough, `sufficient: false` is returned and **uploads
pause**. The caller must not extend the plan with excluded items and must not
delete anything unverified to make up the difference.

## 6. Retention

Default 10 days. Reaching it means **archive-preferred**, not "delete now". The
second, independent reason to become archive-preferred is storage pressure.
Keep Online bypasses both.

## 7. Restore

`src/media/restore.ts`. A restore is both an upload and a verification.

Every check is mandatory; there is no ordering in which size or checksum can be
skipped:

1. item is offline and the transition is legal
2. a manifest entry exists **and its `mediaId` matches** — lookup is by media ID,
   never by filename
3. the local file exists and is readable
4. **size matches the media record**
5. **SHA-256 matches the media record**
6. the restore fits under the safety ceiling

Any failure → `restore_failed`, from which the only routes are retry or back to
`archived_offline`. The item is never marked online, and a different file with a
matching name is never substituted.

The **media record**, not the manifest, is the authority on expected size and
hash — the manifest itself could have been edited.

## 8. Local archive manifest

Keyed by `mediaId`, holding `publicId`, `localPath`, `sizeBytes`, `sha256`,
`archivedAt`, `verifiedAt`. Filenames collide, get renamed, and carry collision
suffixes, so they are never the lookup key. Mirrored server-side in the
`archive_manifest` table so the backend knows which objects have a verified
local copy.

## 9. Database safety

Migration `001` (still unapplied) enforces the invariant in the schema, not only
in code:

- `media_cloud_delete_requires_local_archive` — an item cannot be in
  `cloud_delete_pending`, `archived_offline`, `restore_requested`, or
  `restore_failed` unless `local_archive_verified = TRUE`.
- `media_offline_original_requires_local_archive` — an active item with
  `original_online = FALSE` must have a verified local copy.

Together these make "the only copy was deleted" **unrepresentable**. Storage
pressure cannot bypass them, because pressure never writes a state — it only
changes which item is worked on next.

## 10. Cost posture

Target: **$0/month whenever practical.** The app fails safe — when uncertain
whether an automatic upload is within budget, it pauses.

Standard storage only. We do **not** move objects to Infrequent Access, and we
do **not** configure any Cloudflare lifecycle rule that deletes objects on a
timer — that would bypass local verification entirely. The application controls
archival and deletion.

**Honest limitation:** these are application-side safeguards. Cloudflare does
not offer a configurable hard spend cap, so KCxLabs cannot guarantee the account
is never billed. `BillingNote.notAGuarantee` states this in the UI.

## 11. Usage UI (planned)

```
R2 STORAGE
6.4 GB / 10 GB free allowance
Safety ceiling: 8 GB
Status: Normal
Headroom to safety ceiling: 1.6 GB
Provider metrics updated: 2 minutes ago
```

When metrics are unavailable, the panel must read *"KCxLabs local estimate — not
an official Cloudflare measurement"* and must not present the figure as
Cloudflare's.

Statuses: `normal`, `archive_recommended`, `uploads_paused`, `metrics_stale`,
`metrics_unavailable`.

## 12. Sources

- [R2 metrics and analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/)
- [Cloudflare GraphQL Analytics API schema](https://pages.johnspurlock.com/graphql-schema-docs/cloudflare.html)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing)
