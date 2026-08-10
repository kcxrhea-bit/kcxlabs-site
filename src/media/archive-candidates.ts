/**
 * Deterministic selection of media to archive when space must be freed.
 *
 * Pure and isomorphic, so the ordering can be asserted exactly in tests.
 *
 * The hard rule this module obeys: SELECTION IS NOT DELETION. Everything here
 * decides only which items the desktop should *download and verify next*. The
 * cloud original is removed later, and only by the existing
 * `mayDeleteFromCloud()` gate after a checksum-verified local copy exists.
 * Storage pressure changes the order of work; it never changes the conditions
 * for deletion. If nothing can be safely archived, the correct outcome is
 * paused uploads — never a shortcut.
 */

import type { ArchiveState, MediaVisibility } from "./types";
import { isArchiveInFlight, isOriginalOffline } from "./types";
import { isArchiveEligible, type RetentionInput } from "./retention";

/** Everything candidate selection needs to know about one item. */
export type ArchiveCandidateInput = {
  id: string;
  sizeBytes: number;
  uploadedAt: string | null;
  retentionDays: number;
  keepOnline: boolean;
  archiveState: ArchiveState;
  localArchiveVerified: boolean;
  visibility: MediaVisibility;
  status: "pending" | "active" | "deleted";
  originalOnline: boolean;
  featured: boolean;
  favorite: boolean;
  /** False when the object is known-missing or the record is inconsistent. */
  originalRetrievable: boolean;
};

export const archiveExclusionReasons = [
  "keep_online",
  "not_active",
  "already_offline",
  "in_flight",
  "not_retrievable",
  "no_bytes_to_free",
] as const;

export type ArchiveExclusionReason = (typeof archiveExclusionReasons)[number];

export const archiveExclusionLabel: Record<ArchiveExclusionReason, string> = {
  keep_online: "Keep Online is enabled.",
  not_active: "The item is not an active media record.",
  already_offline: "The original is already archived offline.",
  in_flight: "A transfer is currently in progress for this item.",
  not_retrievable: "The original cannot be retrieved, so it cannot be archived safely.",
  no_bytes_to_free: "Archiving this item would not free any storage.",
};

/**
 * Why an item must never be picked automatically, or null if it is safe to pick.
 *
 * Exclusions are absolute and are checked before any ranking, so no amount of
 * storage pressure can promote an excluded item.
 */
export function archiveExclusion(item: ArchiveCandidateInput): ArchiveExclusionReason | null {
  // Keep Online is an explicit operator decision and outranks storage pressure.
  if (item.keepOnline) return "keep_online";
  if (item.status !== "active") return "not_active";
  if (isOriginalOffline(item.archiveState) || !item.originalOnline) return "already_offline";
  // Mid-transfer: byte accounting and object presence are both unstable.
  if (isArchiveInFlight(item.archiveState)) return "in_flight";
  if (item.archiveState === "archive_failed" && !item.originalRetrievable) return "not_retrievable";
  if (!item.originalRetrievable) return "not_retrievable";
  if (item.sizeBytes <= 0) return "no_bytes_to_free";
  return null;
}

export function isSafeArchiveCandidate(item: ArchiveCandidateInput): boolean {
  return archiveExclusion(item) === null;
}

function toRetention(item: ArchiveCandidateInput): RetentionInput {
  return {
    uploadedAt: item.uploadedAt,
    retentionDays: item.retentionDays,
    keepOnline: item.keepOnline,
    archiveState: item.archiveState,
    localArchiveVerified: item.localArchiveVerified,
    visibility: item.visibility,
  };
}

export type RankedArchiveCandidate = {
  item: ArchiveCandidateInput;
  /** Bytes reclaimed once this item's original leaves R2. */
  bytesFreed: number;
  /** Lower sorts first. Exposed so the UI can explain the ordering. */
  tier: number;
  tierLabel: string;
  /** True when this item already has a verified local copy. */
  alreadyVerifiedLocally: boolean;
  pastRetention: boolean;
};

/**
 * Priority tiers, lowest first. Ordering is by *safety and cost of work*, not
 * by size — deliberately. Picking the largest file first would repeatedly
 * choose recent, still-interesting clips and would ignore the fact that some
 * items are already safe on the PC and can be freed with no download at all.
 */
const TIER = {
  /** Already downloaded and checksum-verified: freeing costs nothing and risks nothing. */
  VERIFIED_LOCAL: 0,
  /** Past its retention age: archiving was already the intended outcome. */
  PAST_RETENTION: 1,
  /** Everything else safe, archived early only because space is needed. */
  EARLY: 2,
} as const;

const TIER_LABEL: Record<number, string> = {
  [TIER.VERIFIED_LOCAL]: "Already saved on your PC — safe to free immediately",
  [TIER.PAST_RETENTION]: "Past its retention age",
  [TIER.EARLY]: "Archived early to free space",
};

/**
 * Rank every safe candidate. Excluded items are omitted entirely.
 *
 * Ordering, applied in sequence:
 *   1. tier (verified-local, then past-retention, then early)
 *   2. not featured/favourite before featured/favourite
 *   3. oldest upload first
 *   4. larger first, so fewer items are disturbed to free the same space
 *   5. id, purely to make ties deterministic across runs
 */
export function rankArchiveCandidates(
  items: readonly ArchiveCandidateInput[],
  now: Date,
): RankedArchiveCandidate[] {
  const ranked: RankedArchiveCandidate[] = [];

  for (const item of items) {
    if (!isSafeArchiveCandidate(item)) continue;

    const retention = toRetention(item);
    const pastRetention = isArchiveEligible(retention, now);
    const alreadyVerifiedLocally =
      item.localArchiveVerified && item.archiveState === "archived_local";

    const tier = alreadyVerifiedLocally
      ? TIER.VERIFIED_LOCAL
      : pastRetention
        ? TIER.PAST_RETENTION
        : TIER.EARLY;

    ranked.push({
      item,
      bytesFreed: item.sizeBytes,
      tier,
      tierLabel: TIER_LABEL[tier],
      alreadyVerifiedLocally,
      pastRetention,
    });
  }

  const pinned = (candidate: RankedArchiveCandidate) =>
    candidate.item.featured || candidate.item.favorite ? 1 : 0;
  const uploadedMs = (candidate: RankedArchiveCandidate) => {
    const parsed = candidate.item.uploadedAt === null ? Number.NaN : Date.parse(candidate.item.uploadedAt);
    // Undated items sort last rather than first: never guess that an item with
    // no timestamp is the oldest.
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };

  return ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      pinned(a) - pinned(b) ||
      uploadedMs(a) - uploadedMs(b) ||
      b.bytesFreed - a.bytesFreed ||
      (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
  );
}

export type ArchivePlan = {
  /** Items to archive, in the order they should be processed. */
  selected: RankedArchiveCandidate[];
  bytesFreed: number;
  bytesRequired: number;
  /** Whether the plan frees enough. When false, uploads must pause. */
  sufficient: boolean;
  reason: string;
};

/**
 * Choose the smallest prefix of the ranked list that frees `bytesRequired`.
 *
 * When the total safely-archivable bytes are insufficient, the plan is returned
 * with `sufficient: false` and every safe candidate included. The caller must
 * then PAUSE UPLOADS. It must not extend the plan with excluded items, and it
 * must not delete anything unverified to make up the difference.
 */
export function planArchiveToFree(
  items: readonly ArchiveCandidateInput[],
  bytesRequired: number,
  now: Date,
): ArchivePlan {
  const ranked = rankArchiveCandidates(items, now);

  if (bytesRequired <= 0) {
    return {
      selected: [],
      bytesFreed: 0,
      bytesRequired: 0,
      sufficient: true,
      reason: "No space needs to be freed.",
    };
  }

  const selected: RankedArchiveCandidate[] = [];
  let bytesFreed = 0;

  for (const candidate of ranked) {
    if (bytesFreed >= bytesRequired) break;
    selected.push(candidate);
    bytesFreed += candidate.bytesFreed;
  }

  const sufficient = bytesFreed >= bytesRequired;

  return {
    selected,
    bytesFreed,
    bytesRequired,
    sufficient,
    reason: sufficient
      ? `Archiving ${selected.length} item${selected.length === 1 ? "" : "s"} will free enough space.`
      : `Not enough media can be archived safely. Uploads will stay paused until more items ` +
        `become archivable or Keep Online is switched off for some clips.`,
  };
}
