import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateArchiveEligibleAt,
  isArchiveEligible,
  mayDeleteFromCloud,
  describeDeletionBlock,
  verifyArchiveCopy,
  daysUntilArchiveEligible,
  canTransitionArchiveState,
  DEFAULT_RETENTION_DAYS,
} from "../dist-electron/media-core.cjs";

const DAY = 86_400_000;
const uploadedAt = "2026-01-01T00:00:00.000Z";

/**
 * Baseline: an item at the default retention with no local copy yet.
 *
 * Retention length is read from DEFAULT_RETENTION_DAYS rather than hard-coded,
 * so changing the default cannot silently invalidate these assertions. The
 * safety tests below deliberately do not depend on the number at all.
 */
function item(overrides = {}) {
  return {
    uploadedAt,
    retentionDays: DEFAULT_RETENTION_DAYS,
    keepOnline: false,
    archiveState: "active",
    localArchiveVerified: false,
    visibility: "unlisted",
    ...overrides,
  };
}

const at = (days) => new Date(Date.parse(uploadedAt) + days * DAY);

// ─── Archive eligibility (requirement 14) ────────────────────────────────────

test("the default retention is 10 days", () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 10);
});

test("archive eligibility is exactly retentionDays after upload", () => {
  // Default (10 days) from 2026-01-01.
  assert.equal(calculateArchiveEligibleAt(item()), "2026-01-11T00:00:00.000Z");
  // An explicit custom retention is honoured rather than overridden.
  assert.equal(
    calculateArchiveEligibleAt(item({ retentionDays: 30 })),
    "2026-01-31T00:00:00.000Z",
  );
  assert.equal(calculateArchiveEligibleAt(item({ retentionDays: 3 })), "2026-01-04T00:00:00.000Z");
});

test("an item is not archive eligible before its retention age", () => {
  assert.equal(isArchiveEligible(item(), at(9)), false);
  assert.equal(isArchiveEligible(item(), at(9.99)), false);
});

test("an item becomes archive eligible at and after its retention age", () => {
  assert.equal(isArchiveEligible(item(), at(10)), true);
  assert.equal(isArchiveEligible(item(), at(400)), true);
});

test("a custom retention shifts eligibility without affecting anything else", () => {
  for (const days of [3, 7, 10, 14, 30]) {
    const custom = item({ retentionDays: days });
    assert.equal(isArchiveEligible(custom, at(days - 0.01)), false, `${days}d: too early`);
    assert.equal(isArchiveEligible(custom, at(days)), true, `${days}d: due`);
    // Eligibility never implies deletion, at any retention length.
    assert.equal(mayDeleteFromCloud(custom), false, `${days}d: must not be deletable`);
  }
});

test("days until eligibility counts down and goes negative when overdue", () => {
  assert.equal(daysUntilArchiveEligible(item(), at(0)), 10);
  assert.equal(daysUntilArchiveEligible(item(), at(11)), -1);
});

test("a non-positive or malformed retention never expires, rather than expiring instantly", () => {
  // Fail safe: a corrupt retention value must not make everything deletable.
  assert.equal(calculateArchiveEligibleAt(item({ retentionDays: 0 })), null);
  assert.equal(calculateArchiveEligibleAt(item({ retentionDays: -5 })), null);
  assert.equal(calculateArchiveEligibleAt(item({ retentionDays: Number.NaN })), null);
  assert.equal(isArchiveEligible(item({ retentionDays: 0 }), at(10_000)), false);
});

test("an item that never finished uploading is never archive eligible", () => {
  assert.equal(isArchiveEligible(item({ uploadedAt: null }), at(999)), false);
});

// ─── Keep Online (requirement 15) ────────────────────────────────────────────

test("Keep Online prevents archive eligibility no matter how old the item is", () => {
  const kept = item({ keepOnline: true });
  assert.equal(calculateArchiveEligibleAt(kept), null);
  assert.equal(isArchiveEligible(kept, at(3650)), false);
});

test("Keep Online blocks automatic cloud deletion even with a verified local copy", () => {
  const kept = item({
    keepOnline: true,
    localArchiveVerified: true,
    archiveState: "archived_local",
  });
  assert.equal(mayDeleteFromCloud(kept), false);
  assert.match(describeDeletionBlock(kept), /Keep Online/);
});

// ─── The core invariant (requirements 19 and 20) ─────────────────────────────

test("cloud deletion is refused before a verified local archive exists", () => {
  assert.equal(mayDeleteFromCloud(item()), false);
  assert.equal(mayDeleteFromCloud(item({ archiveState: "archive_eligible" })), false);
  assert.equal(mayDeleteFromCloud(item({ archiveState: "archive_downloading" })), false);
});

test("a download that finished but failed verification does not permit deletion", () => {
  // archived_local reached, but localArchiveVerified was never set: refuse.
  const unverified = item({ archiveState: "archived_local", localArchiveVerified: false });
  assert.equal(mayDeleteFromCloud(unverified), false);
  assert.match(describeDeletionBlock(unverified), /verified local archive/);
});

test("cloud deletion is permitted only once local archival is complete and verified", () => {
  const archived = item({ archiveState: "archived_local", localArchiveVerified: true });
  assert.equal(mayDeleteFromCloud(archived), true);
  assert.equal(describeDeletionBlock(archived), null);

  const pending = item({ archiveState: "cloud_delete_pending", localArchiveVerified: true });
  assert.equal(mayDeleteFromCloud(pending), true);
});

test("a PC offline at day 10 causes nothing destructive", () => {
  // The item becomes eligible exactly on schedule, and stays fully intact
  // because no desktop ever downloaded or verified it.
  const stale = item({ archiveState: "archive_eligible" });
  assert.equal(isArchiveEligible(stale, at(10)), true);
  assert.equal(mayDeleteFromCloud(stale), false);
  assert.match(describeDeletionBlock(stale), /verified local archive/);
});

test("an offline desktop never causes cloud deletion, however long it stays offline", () => {
  // The PC is off: the item ages far past retention but is never downloaded,
  // so localArchiveVerified stays false and deletion stays refused. Forever.
  for (const days of [11, 31, 60, 180, 365, 3650]) {
    const stale = item({ archiveState: "archive_eligible" });
    assert.equal(isArchiveEligible(stale, at(days)), true, `eligible at day ${days}`);
    assert.equal(mayDeleteFromCloud(stale), false, `still undeletable at day ${days}`);
  }
});

// ─── Verification (requirements 17 and 18) ───────────────────────────────────

const expected = { sizeBytes: 1000, sha256: "a".repeat(64) };

test("verification passes only when both size and checksum match", () => {
  const result = verifyArchiveCopy(expected, { sizeBytes: 1000, sha256: "a".repeat(64) });
  assert.equal(result.verified, true);
  assert.equal(result.reason, null);
});

test("a size mismatch fails verification", () => {
  const result = verifyArchiveCopy(expected, { sizeBytes: 999, sha256: "a".repeat(64) });
  assert.equal(result.verified, false);
  assert.equal(result.sizeMatches, false);
  assert.match(result.reason, /Size mismatch/);
});

test("a checksum mismatch fails verification even when the size is right", () => {
  // The truncation-at-95% case: right length, wrong bytes.
  const result = verifyArchiveCopy(expected, { sizeBytes: 1000, sha256: "b".repeat(64) });
  assert.equal(result.verified, false);
  assert.equal(result.hashMatches, false);
  assert.match(result.reason, /Checksum mismatch/);
});

test("checksum comparison ignores hex casing but rejects malformed digests", () => {
  assert.equal(
    verifyArchiveCopy({ sizeBytes: 1, sha256: "A".repeat(64) }, { sizeBytes: 1, sha256: "a".repeat(64) })
      .verified,
    true,
  );
  assert.equal(
    verifyArchiveCopy({ sizeBytes: 1, sha256: "a".repeat(64) }, { sizeBytes: 1, sha256: "a".repeat(10) })
      .verified,
    false,
  );
});

// ─── State machine ───────────────────────────────────────────────────────────

test("archive state transitions are restricted to the declared machine", () => {
  assert.equal(canTransitionArchiveState("active", "archive_eligible"), true);
  assert.equal(canTransitionArchiveState("archive_downloading", "archived_local"), true);
  assert.equal(canTransitionArchiveState("archived_local", "cloud_delete_pending"), true);

  // A replayed or malicious client must not jump straight to deletion.
  assert.equal(canTransitionArchiveState("active", "cloud_deleted"), false);
  assert.equal(canTransitionArchiveState("archive_eligible", "archived_local"), false);
  assert.equal(canTransitionArchiveState("archive_downloading", "cloud_deleted"), false);
});

test("a failed archive returns to eligible so it can be retried, not to archived", () => {
  assert.equal(canTransitionArchiveState("archive_downloading", "archive_failed"), true);
  assert.equal(canTransitionArchiveState("archive_failed", "archive_eligible"), true);
  assert.equal(canTransitionArchiveState("archive_failed", "archived_local"), false);
  // Deletion is terminal.
  assert.deepEqual(canTransitionArchiveState("cloud_deleted", "active"), false);
});
