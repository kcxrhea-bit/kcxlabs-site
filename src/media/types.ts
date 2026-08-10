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
  "cloud_deleted",
  "archive_failed",
] as const;

/**
 * Where an item sits in the "bring it back to my PC, then free the cloud copy"
 * lifecycle. Transitions are explicit and recoverable: every non-terminal state
 * can be re-entered after a crash without losing data.
 */
export type ArchiveState = (typeof archiveStateValues)[number];

/**
 * Legal transitions. Anything not listed here is rejected by the API, so a
 * buggy or replayed client cannot walk an item into `cloud_deleted` out of order.
 *
 * Note `archive_failed` returns to `archive_eligible`: a failed download must be
 * retryable, and must never leave the item looking archived.
 */
export const allowedArchiveTransitions: Record<ArchiveState, readonly ArchiveState[]> = {
  active: ["archive_eligible"],
  archive_eligible: ["archive_downloading", "active"],
  archive_downloading: ["archived_local", "archive_failed"],
  archived_local: ["cloud_delete_pending"],
  cloud_delete_pending: ["cloud_deleted", "archive_failed"],
  cloud_deleted: [],
  archive_failed: ["archive_eligible", "archive_downloading"],
};

export function canTransitionArchiveState(from: ArchiveState, to: ArchiveState): boolean {
  return allowedArchiveTransitions[from].includes(to);
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
  storageObjectKey: string;
  thumbnailKey: string | null;

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
>;

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
  };
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
};

export const defaultMediaSettings: MediaSettings = {
  defaultVisibility: defaultMediaVisibility,
  retentionDays: 30,
  keepOnlineDefault: false,
  // Off by default: automatic upload of whatever appears on disk is a decision
  // the operator opts into, not a default behaviour.
  autoUpload: false,
  copyLinkAfterUpload: true,
  watchFolders: [],
  archiveRoot: "D:\\OldclipsfromKCxlabs",
  notifyOnDetection: true,
  notifyOnUpload: true,
};
