import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveExclusion,
  isSafeArchiveCandidate,
  rankArchiveCandidates,
  planArchiveToFree,
  evaluateRestoreEligibility,
  archiveStateAfterFailedRestore,
  isRestoreComplete,
  evaluateStorageBudget,
  canTransitionArchiveState,
  mayDeleteFromCloud,
  isOriginalOffline,
  isArchiveInFlight,
  resolveSharePageMode,
  toPublicMediaItem,
} from "../dist-electron/media-core.cjs";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const NOW = new Date("2026-08-10T12:00:00.000Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** A safe, ordinary online candidate 20 days old (past 10-day retention). */
const candidate = (overrides = {}) => ({
  id: "m1",
  sizeBytes: 200 * MB,
  uploadedAt: daysAgo(20),
  retentionDays: 10,
  keepOnline: false,
  archiveState: "active",
  localArchiveVerified: false,
  visibility: "unlisted",
  status: "active",
  originalOnline: true,
  featured: false,
  favorite: false,
  originalRetrievable: true,
  ...overrides,
});

// ─── Exclusions (requirements 8 and 9) ───────────────────────────────────────

test("Keep Online media is never selected for automatic archival", () => {
  assert.equal(archiveExclusion(candidate({ keepOnline: true })), "keep_online");
  assert.equal(isSafeArchiveCandidate(candidate({ keepOnline: true })), false);
  // Even under extreme pressure and extreme age.
  const ranked = rankArchiveCandidates([candidate({ keepOnline: true, uploadedAt: daysAgo(3650) })], NOW);
  assert.equal(ranked.length, 0);
});

test("media without a retrievable original is never selected", () => {
  assert.equal(archiveExclusion(candidate({ originalRetrievable: false })), "not_retrievable");
});

test("media already offline is not selected again", () => {
  assert.equal(archiveExclusion(candidate({ originalOnline: false })), "already_offline");
  assert.equal(
    archiveExclusion(candidate({ archiveState: "archived_offline", localArchiveVerified: true })),
    "already_offline",
  );
});

test("an item mid-transfer is left alone", () => {
  for (const state of ["archive_downloading", "cloud_delete_pending", "restoring"]) {
    assert.equal(archiveExclusion(candidate({ archiveState: state })), "in_flight", state);
    assert.equal(isArchiveInFlight(state), true, state);
  }
});

test("pending and deleted records are not archive candidates", () => {
  assert.equal(archiveExclusion(candidate({ status: "pending" })), "not_active");
  assert.equal(archiveExclusion(candidate({ status: "deleted" })), "not_active");
});

test("an item with no bytes to free is skipped", () => {
  assert.equal(archiveExclusion(candidate({ sizeBytes: 0 })), "no_bytes_to_free");
});

test("selection never permits deletion: excluded and included items alike are ungated", () => {
  // Requirement 19: storage pressure must not bypass mayDeleteFromCloud().
  // A freshly selected candidate has no verified local copy, so deletion is
  // still refused even though it was chosen for archiving.
  const chosen = rankArchiveCandidates([candidate()], NOW)[0];
  assert.ok(chosen);
  assert.equal(
    mayDeleteFromCloud({
      uploadedAt: chosen.item.uploadedAt,
      retentionDays: chosen.item.retentionDays,
      keepOnline: chosen.item.keepOnline,
      archiveState: chosen.item.archiveState,
      localArchiveVerified: chosen.item.localArchiveVerified,
      visibility: chosen.item.visibility,
    }),
    false,
  );
});

// ─── Ranking (requirements 10 and 11) ────────────────────────────────────────

test("already locally verified media is preferred, since freeing it costs nothing", () => {
  const verified = candidate({
    id: "verified",
    archiveState: "archived_local",
    localArchiveVerified: true,
    uploadedAt: daysAgo(1),
    sizeBytes: 10 * MB,
  });
  const old = candidate({ id: "old", uploadedAt: daysAgo(300), sizeBytes: 900 * MB });

  const ranked = rankArchiveCandidates([old, verified], NOW);
  assert.equal(ranked[0].item.id, "verified");
  assert.equal(ranked[0].alreadyVerifiedLocally, true);
  assert.equal(ranked[0].tier, 0);
  // Explicitly not "biggest file first".
  assert.equal(ranked[1].item.id, "old");
});

test("media past retention is preferred over media archived early", () => {
  const past = candidate({ id: "past", uploadedAt: daysAgo(30) });
  const fresh = candidate({ id: "fresh", uploadedAt: daysAgo(2) });
  const ranked = rankArchiveCandidates([fresh, past], NOW);
  assert.equal(ranked[0].item.id, "past");
  assert.equal(ranked[0].pastRetention, true);
  assert.equal(ranked[1].pastRetention, false);
});

test("featured and favourite media sorts last within its tier", () => {
  const featured = candidate({ id: "featured", featured: true, uploadedAt: daysAgo(100) });
  const plain = candidate({ id: "plain", uploadedAt: daysAgo(20) });
  const ranked = rankArchiveCandidates([featured, plain], NOW);
  assert.equal(ranked[0].item.id, "plain");
  assert.equal(ranked[1].item.id, "featured");
});

test("within a tier, oldest first, then larger first, then id — fully deterministic", () => {
  const items = [
    candidate({ id: "c", uploadedAt: daysAgo(20), sizeBytes: 100 * MB }),
    candidate({ id: "a", uploadedAt: daysAgo(50), sizeBytes: 100 * MB }),
    candidate({ id: "b", uploadedAt: daysAgo(50), sizeBytes: 500 * MB }),
  ];
  const order = rankArchiveCandidates(items, NOW).map((entry) => entry.item.id);
  assert.deepEqual(order, ["b", "a", "c"]);

  // Same input in a different order produces the same output.
  const shuffled = rankArchiveCandidates([items[2], items[0], items[1]], NOW).map((e) => e.item.id);
  assert.deepEqual(shuffled, order);
});

test("undated media sorts last rather than being assumed oldest", () => {
  const undated = candidate({ id: "undated", uploadedAt: null });
  const dated = candidate({ id: "dated", uploadedAt: daysAgo(5) });
  const ranked = rankArchiveCandidates([undated, dated], NOW);
  assert.equal(ranked[0].item.id, "dated");
});

// ─── Planning ────────────────────────────────────────────────────────────────

test("a plan selects the smallest prefix that frees the required bytes", () => {
  const items = [
    candidate({ id: "a", uploadedAt: daysAgo(50), sizeBytes: 300 * MB }),
    candidate({ id: "b", uploadedAt: daysAgo(40), sizeBytes: 300 * MB }),
    candidate({ id: "c", uploadedAt: daysAgo(30), sizeBytes: 300 * MB }),
  ];
  const plan = planArchiveToFree(items, 500 * MB, NOW);
  assert.equal(plan.sufficient, true);
  assert.equal(plan.selected.length, 2);
  assert.equal(plan.bytesFreed, 600 * MB);
});

test("when nothing can be freed safely the plan is insufficient, not expanded", () => {
  // Everything is Keep Online: the correct answer is "pause", not "delete something".
  const items = [
    candidate({ id: "a", keepOnline: true, sizeBytes: 5 * GB }),
    candidate({ id: "b", keepOnline: true, sizeBytes: 5 * GB }),
  ];
  const plan = planArchiveToFree(items, 1 * GB, NOW);
  assert.equal(plan.sufficient, false);
  assert.equal(plan.selected.length, 0);
  assert.equal(plan.bytesFreed, 0);
  assert.match(plan.reason, /Uploads will stay paused/);
});

test("a partially sufficient plan still reports insufficient", () => {
  const plan = planArchiveToFree([candidate({ sizeBytes: 100 * MB })], 1 * GB, NOW);
  assert.equal(plan.sufficient, false);
  assert.equal(plan.bytesFreed, 100 * MB);
});

test("no space needed produces an empty plan", () => {
  const plan = planArchiveToFree([candidate()], 0, NOW);
  assert.equal(plan.sufficient, true);
  assert.equal(plan.selected.length, 0);
});

// ─── Archived media stays on the website (requirements 12 and 13) ────────────

const archivedItem = {
  id: "internal",
  publicId: "N7hd4KpQ",
  ownerId: "owner",
  originalFilename: "clip.mp4",
  extension: ".mp4",
  mimeType: "video/mp4",
  kind: "video",
  sizeBytes: 200 * MB,
  sha256: "a".repeat(64),
  storageProvider: "r2",
  storageObjectKey: "media/owner/N7hd4KpQ/clip.mp4",
  originalOnline: false,
  thumbnailKey: "thumbs/owner/N7hd4KpQ/poster.jpg",
  thumbnailSizeBytes: 40 * 1024,
  restoreRequestedAt: null,
  restoreFailedReason: null,
  title: "Fortnite Elimination",
  description: "Nice shot",
  tags: ["fortnite"],
  game: "Fortnite",
  eventType: "Elimination",
  durationSeconds: 20,
  width: 1920,
  height: 1080,
  codec: "h264",
  status: "active",
  visibility: "public",
  retentionDays: 10,
  keepOnline: false,
  archiveState: "archived_offline",
  archiveEligibleAt: null,
  archivedAt: daysAgo(1),
  localArchiveVerified: true,
  localArchivePath: "D:\\OldclipsfromKCxlabs\\Fortnite\\2026\\08\\clip.mp4",
  recordedAt: null,
  uploadedAt: daysAgo(15),
  createdAt: daysAgo(15),
  updatedAt: daysAgo(1),
};

test("an archived item keeps its record, publicId, title, and metadata", () => {
  const projected = toPublicMediaItem(archivedItem);
  assert.equal(projected.publicId, "N7hd4KpQ");
  assert.equal(projected.title, "Fortnite Elimination");
  assert.equal(projected.game, "Fortnite");
  assert.equal(projected.eventType, "Elimination");
  assert.equal(projected.visibility, "public");
  assert.equal(projected.uploadedAt, archivedItem.uploadedAt);
});

test("an archived item renders as archived, never as a playable video", () => {
  assert.equal(resolveSharePageMode(toPublicMediaItem(archivedItem)), "archived");
  // The same item while online is playable.
  assert.equal(
    resolveSharePageMode(toPublicMediaItem({ ...archivedItem, originalOnline: true })),
    "playable",
  );
});

test("the archived share payload never exposes the removed original's object key", () => {
  const serialized = JSON.stringify(toPublicMediaItem(archivedItem));
  assert.ok(!serialized.includes("media/owner/N7hd4KpQ/clip.mp4"));
  assert.ok(!serialized.includes("OldclipsfromKCxlabs"));
  assert.ok(!serialized.includes("a".repeat(64)));
  // But it does carry the flag the page needs to render the archived state.
  assert.equal(JSON.parse(serialized).originalOnline, false);
});

test("offline archive states are recognised for accounting and rendering", () => {
  assert.equal(isOriginalOffline("archived_offline"), true);
  assert.equal(isOriginalOffline("restore_requested"), true);
  assert.equal(isOriginalOffline("restore_failed"), true);
  assert.equal(isOriginalOffline("active"), false);
  assert.equal(isOriginalOffline("archived_local"), false);
});

// ─── Restore (requirements 14 to 18) ─────────────────────────────────────────

const manifest = {
  mediaId: "internal",
  publicId: "N7hd4KpQ",
  localPath: "D:\\OldclipsfromKCxlabs\\Fortnite\\2026\\08\\clip.mp4",
  sizeBytes: 200 * MB,
  sha256: "a".repeat(64),
  archivedAt: daysAgo(1),
  verifiedAt: daysAgo(1),
};

const goodProbe = { exists: true, readable: true, sizeBytes: 200 * MB, sha256: "a".repeat(64) };

const roomyBudget = evaluateStorageBudget({
  localTrackedBytes: 1 * GB,
  providerMetrics: null,
  now: NOW,
});

const restoreInput = (overrides = {}) => ({
  media: {
    id: "internal",
    publicId: "N7hd4KpQ",
    sizeBytes: 200 * MB,
    sha256: "a".repeat(64),
    archiveState: "archived_offline",
  },
  manifestEntry: manifest,
  probe: goodProbe,
  budget: roomyBudget,
  ...overrides,
});

test("a verified archived clip with room available may be restored", () => {
  const result = evaluateRestoreEligibility(restoreInput());
  assert.equal(result.allowed, true);
  assert.equal(result.bytesToUpload, 200 * MB);
});

test("restore requires a matching SHA-256", () => {
  const result = evaluateRestoreEligibility(
    restoreInput({ probe: { ...goodProbe, sha256: "b".repeat(64) } }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "hash_mismatch");
  assert.match(result.message, /do not match the original/);
});

test("restore requires a matching size", () => {
  const result = evaluateRestoreEligibility(
    restoreInput({ probe: { ...goodProbe, sizeBytes: 199 * MB } }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "size_mismatch");
});

test("a same-named but different file is refused rather than uploaded", () => {
  // Right path, right size, wrong contents: exactly the substitution risk.
  const result = evaluateRestoreEligibility(
    restoreInput({ probe: { ...goodProbe, sha256: "c".repeat(64) } }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "hash_mismatch");
});

test("an unhashable file is refused, not assumed good", () => {
  const result = evaluateRestoreEligibility(restoreInput({ probe: { ...goodProbe, sha256: null } }));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "hash_not_computed");
});

test("a missing or unreadable local file is refused", () => {
  assert.equal(
    evaluateRestoreEligibility(restoreInput({ probe: { ...goodProbe, exists: false } })).reason,
    "file_missing",
  );
  assert.equal(
    evaluateRestoreEligibility(restoreInput({ probe: { ...goodProbe, readable: false } })).reason,
    "file_unreadable",
  );
  assert.equal(evaluateRestoreEligibility(restoreInput({ probe: null })).reason, "file_missing");
});

test("restore is refused when no manifest entry locates the original", () => {
  assert.equal(
    evaluateRestoreEligibility(restoreInput({ manifestEntry: null })).reason,
    "no_manifest_entry",
  );
});

test("a manifest entry for a different media item is refused", () => {
  const result = evaluateRestoreEligibility(
    restoreInput({ manifestEntry: { ...manifest, mediaId: "someone-else" } }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "record_mismatch");
});

test("restore respects the storage budget (requirement 16)", () => {
  const tight = evaluateStorageBudget({
    localTrackedBytes: 7.95 * GB,
    providerMetrics: null,
    now: NOW,
  });
  const result = evaluateRestoreEligibility(restoreInput({ budget: tight }));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "storage_budget");
  assert.match(result.message, /Archive other clips first/);
});

test("restore is refused while uploads are paused", () => {
  const paused = evaluateStorageBudget({
    localTrackedBytes: 9 * GB,
    providerMetrics: null,
    now: NOW,
  });
  assert.equal(paused.uploadAllowed, false);
  assert.equal(evaluateRestoreEligibility(restoreInput({ budget: paused })).reason, "storage_budget");
});

test("an online item has nothing to restore", () => {
  const result = evaluateRestoreEligibility(
    restoreInput({ media: { ...restoreInput().media, archiveState: "active" } }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not_archived");
});

test("a previously failed restore may be retried", () => {
  const result = evaluateRestoreEligibility(
    restoreInput({ media: { ...restoreInput().media, archiveState: "restore_failed" } }),
  );
  assert.equal(result.allowed, true);
});

test("a failed restore leaves the item offline, never online (requirement 17)", () => {
  assert.equal(archiveStateAfterFailedRestore(), "restore_failed");
  // There is no route from restore_failed to active.
  assert.equal(canTransitionArchiveState("restore_failed", "active"), false);
  assert.equal(canTransitionArchiveState("restore_failed", "archived_offline"), true);
  assert.equal(canTransitionArchiveState("restore_failed", "restoring"), true);
});

test("restore completion requires the full byte count and a finalize timestamp", () => {
  assert.equal(
    isRestoreComplete({ expectedBytes: 200 * MB, uploadedBytes: 200 * MB, finalizedAt: daysAgo(0) }),
    true,
  );
  // Bytes arrived but finalize never ran.
  assert.equal(
    isRestoreComplete({ expectedBytes: 200 * MB, uploadedBytes: 200 * MB, finalizedAt: null }),
    false,
  );
  // Truncated upload.
  assert.equal(
    isRestoreComplete({ expectedBytes: 200 * MB, uploadedBytes: 199 * MB, finalizedAt: daysAgo(0) }),
    false,
  );
});

test("a successful restore preserves the publicId and share URL (requirement 18)", () => {
  // Archive and restore only ever change archiveState/originalOnline. The
  // publicId is not written by either path, so the link keeps resolving.
  const restored = { ...archivedItem, archiveState: "active", originalOnline: true };
  assert.equal(restored.publicId, archivedItem.publicId);
  assert.equal(toPublicMediaItem(restored).publicId, "N7hd4KpQ");
  assert.equal(resolveSharePageMode(toPublicMediaItem(restored)), "playable");
});

// ─── State machine (requirement 22) ──────────────────────────────────────────

test("the archive and restore paths form one machine with legal edges only", () => {
  assert.equal(canTransitionArchiveState("active", "archive_eligible"), true);
  assert.equal(canTransitionArchiveState("archive_downloading", "archived_local"), true);
  assert.equal(canTransitionArchiveState("archived_local", "cloud_delete_pending"), true);
  assert.equal(canTransitionArchiveState("cloud_delete_pending", "archived_offline"), true);
  assert.equal(canTransitionArchiveState("archived_offline", "restoring"), true);
  assert.equal(canTransitionArchiveState("restoring", "active"), true);
});

test("invalid transitions are rejected, including shortcuts to offline", () => {
  // The critical one: an item cannot go offline without verified local archival.
  assert.equal(canTransitionArchiveState("active", "archived_offline"), false);
  assert.equal(canTransitionArchiveState("archive_eligible", "archived_offline"), false);
  assert.equal(canTransitionArchiveState("archive_downloading", "archived_offline"), false);
  assert.equal(canTransitionArchiveState("archived_local", "archived_offline"), false);
  // Restore cannot be skipped either.
  assert.equal(canTransitionArchiveState("archived_offline", "active"), false);
  assert.equal(canTransitionArchiveState("active", "restoring"), false);
});

test("an archived item can be restored or left alone, but not re-archived", () => {
  assert.equal(canTransitionArchiveState("archived_offline", "archive_eligible"), false);
  assert.equal(canTransitionArchiveState("archived_offline", "restore_requested"), true);
});
