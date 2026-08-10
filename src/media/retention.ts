/**
 * Retention and archive decision logic.
 *
 * This module is deliberately pure: no I/O, no clock access, no imports beyond
 * types. Every decision takes `now` as an argument. That makes the safety
 * invariants directly testable, which matters more here than anywhere else in
 * the system because the failure mode is permanent data loss.
 *
 * THE INVARIANT, stated once:
 *
 *   Automatic retention logic must never delete the only known copy.
 *
 * Concretely, `mayDeleteFromCloud` returns true only when a local archive has
 * been downloaded, byte-length checked, and SHA-256 verified, and the item is
 * not marked Keep Online. An offline PC simply means the item stays in the
 * cloud — indefinitely. There is no timeout that overrides this.
 */

import type { ArchiveState, MediaItem, MediaVisibility } from "./types";

const MS_PER_DAY = 86_400_000;

/** The fields retention actually depends on. Narrow input keeps tests honest. */
export type RetentionInput = {
  uploadedAt: string | null;
  retentionDays: number;
  keepOnline: boolean;
  archiveState: ArchiveState;
  localArchiveVerified: boolean;
  visibility: MediaVisibility;
};

export function toRetentionInput(item: MediaItem): RetentionInput {
  return {
    uploadedAt: item.uploadedAt,
    retentionDays: item.retentionDays,
    keepOnline: item.keepOnline,
    archiveState: item.archiveState,
    localArchiveVerified: item.localArchiveVerified,
    visibility: item.visibility,
  };
}

/**
 * When an item becomes eligible for archival, or null if it never will be.
 *
 * Returns null for Keep Online items and for anything not yet uploaded. A
 * `retentionDays` of 0 or less is treated as "never expire" rather than
 * "expire immediately", so a corrupt or unset value fails safe.
 */
export function calculateArchiveEligibleAt(input: RetentionInput): string | null {
  if (input.keepOnline) return null;
  if (input.uploadedAt === null) return null;
  if (!Number.isFinite(input.retentionDays) || input.retentionDays <= 0) return null;

  const uploadedMs = Date.parse(input.uploadedAt);
  if (Number.isNaN(uploadedMs)) return null;

  return new Date(uploadedMs + input.retentionDays * MS_PER_DAY).toISOString();
}

/**
 * Whether the item has reached its retention age and should be offered to the
 * desktop as an archive job.
 *
 * Eligibility is *not* deletion. It only means "the desktop may now download
 * this for local safekeeping". Nothing is removed as a result of this returning
 * true.
 */
export function isArchiveEligible(input: RetentionInput, now: Date): boolean {
  if (input.keepOnline) return false;
  // Already moving through, or past, the archive pipeline.
  if (input.archiveState !== "active" && input.archiveState !== "archive_eligible") return false;

  const eligibleAt = calculateArchiveEligibleAt(input);
  if (eligibleAt === null) return false;

  return now.getTime() >= Date.parse(eligibleAt);
}

/**
 * THE GATE. Whether automatic retention may remove the cloud object.
 *
 * Every condition is required:
 *   - not Keep Online
 *   - a local archive exists AND was checksum-verified
 *   - the archive state agrees that local archival completed
 *
 * `localArchiveVerified` is set only by the archive completion path after both
 * a byte-length match and a SHA-256 match. A size-only or hash-only check is
 * not enough, and a download that merely finished is not enough.
 *
 * This function is the ONLY place automatic cloud deletion is authorized.
 * Manual owner-initiated deletion is a separate, explicitly confirmed path and
 * intentionally does not consult this function.
 */
export function mayDeleteFromCloud(input: RetentionInput): boolean {
  if (input.keepOnline) return false;
  if (!input.localArchiveVerified) return false;
  return input.archiveState === "archived_local" || input.archiveState === "cloud_delete_pending";
}

/**
 * Human-readable reason automatic deletion is currently blocked, for the
 * Library UI and diagnostics. Returns null when deletion is permitted.
 */
export function describeDeletionBlock(input: RetentionInput): string | null {
  if (input.keepOnline) return "Keep Online is enabled for this item.";
  if (!input.localArchiveVerified) return "No verified local archive copy exists yet.";
  if (input.archiveState !== "archived_local" && input.archiveState !== "cloud_delete_pending") {
    return `Archive state is ${input.archiveState}; local archival has not completed.`;
  }
  return null;
}

/** Whole days an item has been online. Used for the Library "age" column. */
export function ageInDays(input: RetentionInput, now: Date): number | null {
  if (input.uploadedAt === null) return null;
  const uploadedMs = Date.parse(input.uploadedAt);
  if (Number.isNaN(uploadedMs)) return null;
  return Math.floor((now.getTime() - uploadedMs) / MS_PER_DAY);
}

/** Days remaining before archive eligibility; negative once overdue. */
export function daysUntilArchiveEligible(input: RetentionInput, now: Date): number | null {
  const eligibleAt = calculateArchiveEligibleAt(input);
  if (eligibleAt === null) return null;
  return Math.ceil((Date.parse(eligibleAt) - now.getTime()) / MS_PER_DAY);
}

/**
 * Result of verifying a downloaded archive copy against the stored record.
 *
 * Both checks must pass. They are reported separately so a mismatch can be
 * logged precisely (a size mismatch usually means a truncated download; a hash
 * mismatch means corruption).
 */
export type ArchiveVerification = {
  verified: boolean;
  sizeMatches: boolean;
  hashMatches: boolean;
  reason: string | null;
};

export function verifyArchiveCopy(
  expected: { sizeBytes: number; sha256: string },
  actual: { sizeBytes: number; sha256: string },
): ArchiveVerification {
  const sizeMatches = expected.sizeBytes === actual.sizeBytes;
  // Case-insensitive because hex casing varies between tools; length is fixed.
  const hashMatches =
    expected.sha256.toLowerCase() === actual.sha256.toLowerCase() && actual.sha256.length === 64;

  let reason: string | null = null;
  if (!sizeMatches) {
    reason = `Size mismatch: expected ${expected.sizeBytes} bytes, got ${actual.sizeBytes}.`;
  } else if (!hashMatches) {
    reason = "Checksum mismatch: the downloaded copy does not match the stored SHA-256.";
  }

  return { verified: sizeMatches && hashMatches, sizeMatches, hashMatches, reason };
}
