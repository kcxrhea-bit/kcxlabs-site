/**
 * Restore eligibility: bringing an archived original back from the PC into R2.
 *
 * Pure and isomorphic. The desktop performs the actual file reads and upload;
 * this module decides whether it is allowed to, and every check is expressed as
 * data so it can be tested without a filesystem or a bucket.
 *
 * A restore is an upload, so it is subject to the storage budget exactly like a
 * new clip. It is also a *verification* operation: the whole point of the local
 * archive is that the bytes on the PC are provably the same bytes that were in
 * R2, so a restore that cannot prove that must not happen.
 *
 * The publicId and share URL never change across archive → restore. That is the
 * central promise of the two-tier design: a link you sent someone keeps working.
 */

import type { ArchiveState } from "./types";
import { canTransitionArchiveState } from "./types";
import type { StorageBudget } from "./storage-budget";

// ─── Local archive manifest ──────────────────────────────────────────────────

/**
 * One entry in the on-disk archive manifest.
 *
 * Lookup is by `mediaId`, never by filename: filenames collide, get renamed,
 * and carry collision suffixes. The manifest is the authority on where a
 * specific media item's original actually lives.
 */
export type ArchiveManifestEntry = {
  mediaId: string;
  /** Carried for human inspection and to cross-check the share URL. */
  publicId: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
  archivedAt: string;
  /** When the copy was last checksum-verified. */
  verifiedAt: string | null;
};

/** What the desktop observed on disk for a manifest entry, right now. */
export type LocalFileProbe = {
  exists: boolean;
  readable: boolean;
  sizeBytes: number;
  /** Freshly computed digest, or null when hashing was not performed/failed. */
  sha256: string | null;
};

// ─── Eligibility ─────────────────────────────────────────────────────────────

export const restoreBlockReasons = [
  "not_archived",
  "invalid_transition",
  "no_manifest_entry",
  "file_missing",
  "file_unreadable",
  "size_mismatch",
  "hash_not_computed",
  "hash_mismatch",
  "record_mismatch",
  "storage_budget",
] as const;

export type RestoreBlockReason = (typeof restoreBlockReasons)[number];

/**
 * Messages are written for the operator, not for a log file: each one says what
 * happened and what to do about it.
 */
export const restoreBlockMessage: Record<RestoreBlockReason, string> = {
  not_archived: "This clip is not archived offline, so there is nothing to restore.",
  invalid_transition: "This clip is busy with another transfer. Wait for it to finish, then retry.",
  no_manifest_entry:
    "KCxLabs has no local archive record for this clip, so it cannot find the original file.",
  file_missing: "The archived file is missing from your PC. It may have been moved or deleted.",
  file_unreadable:
    "The archived file could not be read. Check that the drive is connected and the file is not in use.",
  size_mismatch:
    "The archived file is the wrong size, so it is not the original. Restore has been stopped.",
  hash_not_computed: "The archived file could not be checksummed, so its contents cannot be trusted.",
  hash_mismatch:
    "The archived file's contents do not match the original. Restore has been stopped to avoid " +
    "publishing the wrong file.",
  record_mismatch: "The archive record does not match this clip. Restore has been stopped.",
  storage_budget:
    "Restoring this clip would push R2 storage past the safety ceiling. Archive other clips first.",
};

export type RestoreEligibility =
  | { allowed: true; bytesToUpload: number }
  | { allowed: false; reason: RestoreBlockReason; message: string };

export type RestoreEligibilityInput = {
  media: {
    id: string;
    publicId: string;
    sizeBytes: number;
    sha256: string;
    archiveState: ArchiveState;
  };
  manifestEntry: ArchiveManifestEntry | null;
  probe: LocalFileProbe | null;
  budget: StorageBudget;
};

/**
 * Decide whether a restore may begin.
 *
 * Checks run cheapest-first, but every one of them is mandatory: there is no
 * ordering in which a size or checksum failure can be skipped. A failure here
 * leaves the item archived offline — it is never marked online, and a different
 * file with a matching name is never substituted.
 *
 * The budget check is evaluated against the *original's* size, because that is
 * exactly what is about to be written back into R2.
 */
export function evaluateRestoreEligibility(input: RestoreEligibilityInput): RestoreEligibility {
  const { media, manifestEntry, probe, budget } = input;

  const block = (reason: RestoreBlockReason): RestoreEligibility => ({
    allowed: false,
    reason,
    message: restoreBlockMessage[reason],
  });

  // The item must actually be offline, and the machine must permit the move.
  if (media.archiveState !== "archived_offline" && media.archiveState !== "restore_requested") {
    if (media.archiveState === "restore_failed") {
      // A previous failure is retryable.
    } else {
      return block("not_archived");
    }
  }
  if (!canTransitionArchiveState(media.archiveState, "restoring")) {
    return block("invalid_transition");
  }

  if (manifestEntry === null) return block("no_manifest_entry");
  // A manifest entry pointing at a different media item must never be used.
  if (manifestEntry.mediaId !== media.id) return block("record_mismatch");

  if (probe === null || !probe.exists) return block("file_missing");
  if (!probe.readable) return block("file_unreadable");

  // Size must match the media record, which is the authority — not the
  // manifest, which could itself have been edited.
  if (probe.sizeBytes !== media.sizeBytes) return block("size_mismatch");

  if (probe.sha256 === null) return block("hash_not_computed");
  if (probe.sha256.toLowerCase() !== media.sha256.toLowerCase()) return block("hash_mismatch");

  // A restore is an upload: it must fit under the safety ceiling like any other.
  if (media.sizeBytes + budget.currentOnlineBytes >= budget.pauseThresholdBytes) {
    return block("storage_budget");
  }
  if (!budget.uploadAllowed && budget.status === "uploads_paused") {
    return block("storage_budget");
  }

  return { allowed: true, bytesToUpload: media.sizeBytes };
}

/**
 * State an item moves to when a restore attempt fails.
 *
 * Always `restore_failed`, from which the only routes are retrying or returning
 * to `archived_offline`. There is no path from a failed restore to `active`,
 * which is what guarantees a clip whose local copy is missing or corrupt is
 * never presented as playable.
 */
export function archiveStateAfterFailedRestore(): ArchiveState {
  return "restore_failed";
}

/**
 * Whether a restore has genuinely completed.
 *
 * Requires the uploaded byte count to match the record exactly. Bytes arriving
 * in the bucket are not sufficient on their own — this mirrors the rule already
 * applied to first-time uploads.
 */
export function isRestoreComplete(input: {
  expectedBytes: number;
  uploadedBytes: number;
  finalizedAt: string | null;
}): boolean {
  return (
    input.finalizedAt !== null &&
    input.uploadedBytes === input.expectedBytes &&
    input.expectedBytes > 0
  );
}
