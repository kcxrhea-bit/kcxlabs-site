/**
 * Shared media models for KCx Media Center.
 *
 * This module is imported by three consumers with different runtimes: the
 * public website bundle, the Electron main process, and the serverless API.
 * It must therefore stay isomorphic — no imports, no `node:*`, no DOM. Keep it
 * to types and plain data so `tsconfig.app.json` (DOM lib, no node types) and
 * the API project can both compile it.
 *
 * Nothing here is a secret and nothing here performs I/O.
 */

// ─── Visibility ──────────────────────────────────────────────────────────────

export const mediaVisibilityValues = ["private", "unlisted", "public"] as const;

/**
 * Who can reach a media item.
 *
 * `private`  — authenticated owner only.
 * `unlisted` — anyone holding the high-entropy share id; never listed publicly.
 * `public`   — anyone, and eligible to appear in /clips.
 */
export type MediaVisibility = (typeof mediaVisibilityValues)[number];

/**
 * Default for every upload. Deliberately not `public`: sharing a link must be a
 * decision, never a side effect of dropping a file into the app.
 */
export const defaultMediaVisibility: MediaVisibility = "unlisted";

/** Only `public` items may appear in listings, feeds, or the sitemap. */
export function isPubliclyListable(visibility: MediaVisibility): boolean {
  return visibility === "public";
}

/** `private` requires an authenticated owner; the other two are link-reachable. */
export function isAnonymouslyReachable(visibility: MediaVisibility): boolean {
  return visibility === "unlisted" || visibility === "public";
}

// ─── Archive lifecycle ───────────────────────────────────────────────────────

export const archiveStateValues = [
  "active",
  "archive_eligible",
  "archive_downloading",
  "archived_local",
  "cloud_delete_pending",
  "archived_offline",
  "archive_failed",
  "restore_requested",
  "restoring",
  "restore_failed",
] as const;

/**
 * Where an item sits in the two-tier lifecycle:
 *
 *   ONLINE (R2 holds the original)  ⇄  ARCHIVED_OFFLINE (the PC holds it)
 *
 * This is ONE state machine, deliberately. The restore path was folded into the
 * existing archive machine rather than added as a second parallel one, so there
 * is exactly one answer to "where is this item right now".
 *
 * `archived_offline` replaced the earlier `cloud_deleted`. The old name implied
 * a terminal, destroyed item; the reality is the opposite — the media record,
 * publicId, share page, and thumbnail all live on, and only the large original
 * has moved to the PC. An `archived_offline` item is fully restorable.
 *
 * Transitions are explicit and recoverable: every non-terminal state can be
 * re-entered after a crash without losing data.
 */
export type ArchiveState = (typeof archiveStateValues)[number];

/**
 * Legal transitions. Anything not listed here is rejected, so a buggy, replayed,
 * or hostile caller cannot walk an item into a state out of order — in
 * particular it cannot reach `archived_offline` (original removed from R2)
 * without passing through verified local archival first.
 *
 * Notable edges and why they exist:
 *   archive_eligible → active     Keep Online was switched on; stand down.
 *   archived_local   → active     Local copy exists but the cloud original was
 *                                 kept; the item is simply safe in both places.
 *   archive_failed   → archive_eligible   A failed download must be retryable,
 *                                 and must never leave the item looking archived.
 *   restore_failed   → archived_offline   A failed restore returns the item to
 *                                 offline, NOT to online. This is what stops a
 *                                 corrupt or missing local file from being
 *                                 presented as a playable clip.
 */
export const allowedArchiveTransitions: Record<ArchiveState, readonly ArchiveState[]> = {
  active: ["archive_eligible"],
  archive_eligible: ["archive_downloading", "active"],
  archive_downloading: ["archived_local", "archive_failed"],
  archived_local: ["cloud_delete_pending", "active"],
  cloud_delete_pending: ["archived_offline", "archive_failed"],
  // Offline but intact: the record and share page are live, the original is on
  // the PC, and restore is the way back.
  archived_offline: ["restore_requested", "restoring"],
  archive_failed: ["archive_eligible", "archive_downloading"],
  // Reserved for the future website-initiated "Request Restore" flow. The
  // desktop picks these up when it next comes online.
  restore_requested: ["restoring", "archived_offline"],
  restoring: ["active", "restore_failed"],
  restore_failed: ["restore_requested", "restoring", "archived_offline"],
};

/**
 * Fails closed. An unrecognised state — a value from an older build, a typo, or
 * a hostile payload — yields `false` rather than throwing, so a bad input can
 * never be mistaken for permission to move an item toward deletion.
 */
export function canTransitionArchiveState(from: ArchiveState, to: ArchiveState): boolean {
  const allowed = allowedArchiveTransitions[from];
  if (allowed === undefined) return false;
  if (!(archiveStateValues as readonly string[]).includes(to)) return false;
  return allowed.includes(to);
}

/**
 * States in which R2 no longer holds the original. Used for accounting (these
 * items contribute only their thumbnail bytes) and for rendering the share page
 * in its archived form instead of a broken player.
 */
export const offlineArchiveStates: readonly ArchiveState[] = [
  "archived_offline",
  "restore_requested",
  "restore_failed",
];

/** True when the large original is not currently in R2. */
export function isOriginalOffline(state: ArchiveState): boolean {
  return offlineArchiveStates.includes(state);
}

/**
 * States where an item must be left completely alone by automatic space
 * reclamation: a transfer is in flight, so its byte accounting and object
 * presence are both momentarily unstable.
 */
export const inFlightArchiveStates: readonly ArchiveState[] = [
  "archive_downloading",
  "cloud_delete_pending",
  "restoring",
];

export function isArchiveInFlight(state: ArchiveState): boolean {
  return inFlightArchiveStates.includes(state);
}

// ─── Upload lifecycle ────────────────────────────────────────────────────────

export const uploadStatusValues = [
  "waiting",
  "hashing",
  "checking_duplicate",
  "authorizing",
  "uploading",
  "finalizing",
  "complete",
  "failed",
  "canceled",
] as const;

/** Client-side queue status. `complete` is set only after the API finalizes. */
export type UploadStatus = (typeof uploadStatusValues)[number];

/**
 * Server-side record status, kept separate from `UploadStatus` on purpose.
 *
 * A row is `pending` from the moment upload is authorized. It becomes `active`
 * only when finalize has confirmed the object exists in storage at the expected
 * size. Bytes landing in the bucket are never sufficient on their own.
 */
export const mediaRecordStatusValues = ["pending", "active", "deleted"] as const;
export type MediaRecordStatus = (typeof mediaRecordStatusValues)[number];

// ─── Media item ──────────────────────────────────────────────────────────────

/** Broad category derived server-side from sniffed content, not the client MIME. */
export const mediaKindValues = ["video", "image", "audio", "document", "archive", "other"] as const;
export type MediaKind = (typeof mediaKindValues)[number];

/**
 * A single stored item. Fields are real columns rather than a JSON blob so the
 * retention, archive, and listing queries can be indexed and reasoned about.
 */
export type MediaItem = {
  /** Internal primary key. Never appears in a share URL. */
  id: string;
  /**
   * High-entropy public identifier used in /c/<publicId>. This is the only
   * protection an `unlisted` item has, so it must never be sequential.
   */
  publicId: string;
  ownerId: string;

  // Source file
  originalFilename: string;
  extension: string;
  /** Server-determined content type. The client's declared type is advisory only. */
  mimeType: string;
  kind: MediaKind;
  sizeBytes: number;
  sha256: string;

  // Storage
  storageProvider: string;
  /**
   * Key of the large original in R2. RETAINED after archival rather than
   * cleared, because restore must put the object back at exactly the same key
   * so the share URL keeps resolving. Presence of a key does not mean the
   * object exists — `originalOnline` is the authority on that.
   */
  storageObjectKey: string;
  /**
   * Whether R2 currently holds the original.
   *
   * This is the single flag the share page, the player, and byte accounting all
   * consult. An archived item has `originalOnline: false` with every other field
   * intact, which is what keeps kcxlabs.org/c/<publicId> working after the video
   * has moved to the PC.
   */
  originalOnline: boolean;
  /** Small poster kept online so archived clips still show a frame. */
  thumbnailKey: string | null;
  /**
   * Thumbnail size, counted separately because it stays in R2 after the
   * original leaves. Archived items therefore still consume a little storage,
   * and the budget must account for it rather than assuming zero.
   */
  thumbnailSizeBytes: number;

  // Restore
  restoreRequestedAt: string | null;
  /** Plain-English reason the last restore attempt failed, for the UI. */
  restoreFailedReason: string | null;

  // Descriptive metadata
  title: string;
  description: string | null;
  tags: string[];
  game: string | null;
  eventType: string | null;

  // Media characteristics (best effort; absent when probing failed)
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;

  // Lifecycle
  status: MediaRecordStatus;
  visibility: MediaVisibility;
  retentionDays: number;
  keepOnline: boolean;
  archiveState: ArchiveState;
  archiveEligibleAt: string | null;
  archivedAt: string | null;
  localArchiveVerified: boolean;
  localArchivePath: string | null;

  // Timestamps (ISO 8601 UTC)
  recordedAt: string | null;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The subset safe to return to an unauthenticated viewer of a share page.
 *
 * Storage keys, local archive paths, owner id, and hashes are deliberately
 * excluded: a share page must not disclose bucket layout or filesystem paths.
 */
export type PublicMediaItem = Pick<
  MediaItem,
  | "publicId"
  | "originalFilename"
  | "mimeType"
  | "kind"
  | "sizeBytes"
  | "title"
  | "description"
  | "tags"
  | "game"
  | "eventType"
  | "durationSeconds"
  | "width"
  | "height"
  | "visibility"
  | "recordedAt"
  | "uploadedAt"
  // Tells the share page whether to render a player or the archived state.
  // Without this the page would point a <video> at an object that is no longer
  // in R2 and show a broken player.
  | "originalOnline"
>;

/**
 * Bytes this item currently occupies in R2.
 *
 * An online item costs its original plus its thumbnail. An archived item costs
 * only the thumbnail — which is the entire point of the two-tier design, and
 * why archiving actually reclaims space.
 *
 * A record that is pending or soft-deleted contributes nothing.
 */
export function onlineBytesFor(
  item: Pick<
    MediaItem,
    "sizeBytes" | "thumbnailSizeBytes" | "originalOnline" | "status" | "thumbnailKey"
  >,
): number {
  if (item.status !== "active") return 0;
  const thumbnail = item.thumbnailKey === null ? 0 : item.thumbnailSizeBytes;
  return (item.originalOnline ? item.sizeBytes : 0) + thumbnail;
}

/** Total R2 bytes across a set of records. The local authoritative estimate. */
export function totalOnlineBytes(
  items: readonly Parameters<typeof onlineBytesFor>[0][],
): number {
  return items.reduce((sum, item) => sum + onlineBytesFor(item), 0);
}

export function toPublicMediaItem(item: MediaItem): PublicMediaItem {
  return {
    publicId: item.publicId,
    originalFilename: item.originalFilename,
    mimeType: item.mimeType,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    title: item.title,
    description: item.description,
    tags: item.tags,
    game: item.game,
    eventType: item.eventType,
    durationSeconds: item.durationSeconds,
    width: item.width,
    height: item.height,
    visibility: item.visibility,
    recordedAt: item.recordedAt,
    uploadedAt: item.uploadedAt,
    originalOnline: item.originalOnline,
  };
}

/**
 * What the share page should render.
 *
 * `archived` is not an error state and must not be presented as one: the clip
 * still exists, it is just on the owner's PC. The page stays fully functional
 * and keeps its poster, title, and metadata.
 */
export type SharePageMode = "playable" | "archived" | "download_only";

export function resolveSharePageMode(item: Pick<PublicMediaItem, "originalOnline" | "kind">): SharePageMode {
  if (!item.originalOnline) return "archived";
  return item.kind === "video" || item.kind === "audio" || item.kind === "image"
    ? "playable"
    : "download_only";
}

// ─── Retention configuration ─────────────────────────────────────────────────

/**
 * Default days an item stays online before it becomes ARCHIVE ELIGIBLE.
 *
 * Eligibility is not deletion. Reaching this age only means the desktop may now
 * download the original for local safekeeping; the cloud copy is removed solely
 * once `mayDeleteFromCloud` is satisfied, which requires a checksum-verified
 * local archive. Shortening this value therefore shortens how soon archiving is
 * *offered*, and changes nothing about the deletion gate.
 */
export const DEFAULT_RETENTION_DAYS = 10;

/** Offered in the Media settings picker. Any other value may still be set. */
export const retentionPresetDays = [3, 7, 10, 14, 30] as const;

export const MIN_RETENTION_DAYS = 1;
/** ~10 years. An upper bound keeps a typo from producing a nonsense date. */
export const MAX_RETENTION_DAYS = 3650;

/**
 * Coerce a user-supplied retention value into a usable number of days.
 *
 * Invalid input (non-numeric, zero, negative) falls back to the default rather
 * than being passed through, because `retention.ts` treats a non-positive value
 * as "never expires" — a silent behaviour change that a typo should not cause.
 * To genuinely keep something forever, use Keep Online, which is explicit.
 */
export function normalizeRetentionDays(value: unknown): number {
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days) || days < MIN_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.floor(days), MAX_RETENTION_DAYS);
}

// ─── Media settings ──────────────────────────────────────────────────────────

/** Desktop-side preferences. Contains no credentials — tokens live in safeStorage. */
export type MediaSettings = {
  defaultVisibility: MediaVisibility;
  retentionDays: number;
  keepOnlineDefault: boolean;
  autoUpload: boolean;
  copyLinkAfterUpload: boolean;
  watchFolders: string[];
  archiveRoot: string;
  notifyOnDetection: boolean;
  notifyOnUpload: boolean;

  /**
   * R2 storage safety thresholds, in bytes. Configurable, but defaulted well
   * below the 10 GB free allowance so headroom is preserved. See
   * `normalizeThresholds` in storage-budget.ts, which refuses unsafe orderings.
   */
  storageWarningBytes: number;
  storagePauseBytes: number;
};

export const defaultMediaSettings: MediaSettings = {
  defaultVisibility: defaultMediaVisibility,
  retentionDays: DEFAULT_RETENTION_DAYS,
  keepOnlineDefault: false,
  // Off by default: automatic upload of whatever appears on disk is a decision
  // the operator opts into, not a default behaviour.
  autoUpload: false,
  copyLinkAfterUpload: true,
  watchFolders: [],
  archiveRoot: "D:\\OldclipsfromKCxlabs",
  notifyOnDetection: true,
  notifyOnUpload: true,
  // 7 GB / 8 GB against a 10 GB free allowance.
  storageWarningBytes: 7 * 1024 * 1024 * 1024,
  storagePauseBytes: 8 * 1024 * 1024 * 1024,
};
