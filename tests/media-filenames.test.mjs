import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeFilename,
  sanitizePathSegment,
  extractExtension,
  buildArchiveSegments,
  withCollisionSuffix,
  isInsideRoot,
  buildStorageKey,
  buildThumbnailKey,
  parseClipFilename,
  suggestTitle,
} from "../dist-electron/media-core.cjs";

const ARCHIVE_ROOT = "D:\\OldclipsfromKCxlabs";

// ─── Filename safety (requirement 7) ─────────────────────────────────────────

test("an ordinary filename passes through unchanged", () => {
  const name = "Fortnite 2026.08.08 - 19.11.25.55.Elimination.DVR.mp4";
  assert.equal(sanitizeFilename(name), name);
});

test("directory separators are stripped, keeping only the final segment", () => {
  assert.equal(sanitizeFilename("../../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("..\\..\\Windows\\System32\\evil.exe"), "evil.exe");
  assert.equal(sanitizeFilename("C:\\Users\\right\\secret.txt"), "secret.txt");
});

test("traversal-only names degrade to the fallback instead of becoming empty", () => {
  assert.equal(sanitizeFilename(".."), "file");
  assert.equal(sanitizeFilename("."), "file");
  assert.equal(sanitizeFilename("...."), "file");
  assert.equal(sanitizeFilename(""), "file");
  assert.equal(sanitizeFilename("   "), "file");
});

test("characters Windows rejects are replaced rather than dropped silently", () => {
  assert.equal(sanitizeFilename('a<b>c:d"e|f?g*h.mp4'), "a_b_c_d_e_f_g_h.mp4");
  assert.equal(sanitizeFilename("clip\u0000name.mp4"), "clip_name.mp4");
});

test("Windows reserved device names are neutralised but still usable", () => {
  assert.equal(sanitizeFilename("CON.mp4"), "_CON.mp4");
  assert.equal(sanitizeFilename("nul.txt"), "_nul.txt");
  // Not reserved — must not be mangled.
  assert.equal(sanitizeFilename("console.mp4"), "console.mp4");
});

test("trailing dots and spaces are removed, since Windows strips them anyway", () => {
  assert.equal(sanitizeFilename("clip.mp4..."), "clip.mp4");
  assert.equal(sanitizeFilename("clip.mp4   "), "clip.mp4");
});

test("an over-long name is truncated but keeps its extension", () => {
  const result = sanitizeFilename(`${"x".repeat(400)}.mp4`);
  assert.ok(result.length <= 120, `length was ${result.length}`);
  assert.ok(result.endsWith(".mp4"));
});

test("extensions are extracted lower-cased, and absent extensions yield empty", () => {
  assert.equal(extractExtension("Clip.MP4"), ".mp4");
  assert.equal(extractExtension("archive.tar.GZ"), ".gz");
  assert.equal(extractExtension("noextension"), "");
  assert.equal(extractExtension(".hidden"), "");
  assert.equal(extractExtension("trailingdot."), "");
});

// ─── Path traversal (requirements 8 and 21) ──────────────────────────────────

test("archive segments are sanitised, so crafted metadata cannot inject a path", () => {
  const segments = buildArchiveSegments({
    game: "../../Windows/System32",
    recordedAt: "2026-08-08T19:11:25.000Z",
    uploadedAt: null,
    originalFilename: "../../../evil.mp4",
  });

  for (const segment of segments) {
    assert.ok(!segment.includes("\\"), `segment contained a backslash: ${segment}`);
    assert.ok(!segment.includes("/"), `segment contained a slash: ${segment}`);
    assert.notEqual(segment, "..");
  }
  assert.equal(segments.at(-1), "evil.mp4");
});

test("archive segments group by game, year and month", () => {
  assert.deepEqual(
    buildArchiveSegments({
      game: "Fortnite",
      recordedAt: "2026-08-08T19:11:25.000Z",
      uploadedAt: null,
      originalFilename: "clip.mp4",
    }),
    ["Fortnite", "2026", "08", "clip.mp4"],
  );
});

test("missing game or date still produces a deterministic, safe location", () => {
  assert.deepEqual(
    buildArchiveSegments({ game: null, recordedAt: null, uploadedAt: null, originalFilename: "x.bin" }),
    ["Unsorted", "Undated", "x.bin"],
  );
  // Falls back from recordedAt to uploadedAt.
  assert.deepEqual(
    buildArchiveSegments({
      game: null,
      recordedAt: null,
      uploadedAt: "2026-02-03T00:00:00.000Z",
      originalFilename: "x.bin",
    }),
    ["Unsorted", "2026", "02", "x.bin"],
  );
});

test("the final archive path cannot escape the archive root", () => {
  const hostile = [
    { game: "..", recordedAt: null, uploadedAt: null, originalFilename: "..\\..\\evil.mp4" },
    { game: "../..", recordedAt: null, uploadedAt: null, originalFilename: "/etc/passwd" },
    { game: "C:\\Windows", recordedAt: null, uploadedAt: null, originalFilename: "D:\\other\\x.mp4" },
  ];

  for (const input of hostile) {
    const full = [ARCHIVE_ROOT, ...buildArchiveSegments(input)].join("\\");
    assert.ok(isInsideRoot(ARCHIVE_ROOT, full), `escaped the root: ${full}`);
  }
});

test("containment checking rejects traversal and sibling-prefix directories", () => {
  assert.equal(isInsideRoot(ARCHIVE_ROOT, "D:\\OldclipsfromKCxlabs\\Fortnite\\a.mp4"), true);
  assert.equal(isInsideRoot(ARCHIVE_ROOT, ARCHIVE_ROOT), true);
  // Sibling directory sharing a prefix must not count as contained.
  assert.equal(isInsideRoot(ARCHIVE_ROOT, "D:\\OldclipsfromKCxlabsOther\\a.mp4"), false);
  assert.equal(isInsideRoot(ARCHIVE_ROOT, "D:\\Windows\\a.mp4"), false);
  assert.equal(isInsideRoot(ARCHIVE_ROOT, "D:\\OldclipsfromKCxlabs\\..\\Windows\\a.mp4"), false);
  // Separator style and casing must not defeat the check.
  assert.equal(isInsideRoot(ARCHIVE_ROOT, "d:/oldclipsfromkcxlabs/Fortnite/a.mp4"), true);
});

test("collision suffixes are deterministic so a retried archive job repeats them", () => {
  assert.equal(withCollisionSuffix("clip.mp4", 1), "clip.mp4");
  assert.equal(withCollisionSuffix("clip.mp4", 2), "clip (2).mp4");
  assert.equal(withCollisionSuffix("clip.mp4", 3), "clip (3).mp4");
  assert.equal(withCollisionSuffix("noext", 2), "noext (2)");
  // Same input, same output — no randomness.
  assert.equal(withCollisionSuffix("clip.mp4", 2), withCollisionSuffix("clip.mp4", 2));
});

// ─── Storage keys ────────────────────────────────────────────────────────────

test("storage keys are namespaced by owner and item, and resist crafted filenames", () => {
  assert.equal(
    buildStorageKey("owner1", "N7hd4KpQ", "clip.mp4"),
    "media/owner1/N7hd4KpQ/clip.mp4",
  );
  const crafted = buildStorageKey("owner1", "N7hd4KpQ", "../../other/owner2/steal.mp4");
  assert.equal(crafted, "media/owner1/N7hd4KpQ/steal.mp4");
  assert.ok(crafted.startsWith("media/owner1/N7hd4KpQ/"));
});

test("thumbnail keys never collide with the original object key", () => {
  const original = buildStorageKey("owner1", "abc", "poster.jpg");
  const thumb = buildThumbnailKey("owner1", "abc");
  assert.notEqual(original, thumb);
  assert.ok(thumb.startsWith("thumbs/"));
});

test("path segments never come back empty, which would collapse a directory level", () => {
  assert.equal(sanitizePathSegment(""), "Unsorted");
  assert.equal(sanitizePathSegment(".."), "Unsorted");
  assert.equal(sanitizePathSegment("/"), "Unsorted");
});

// ─── NVIDIA filename parsing ─────────────────────────────────────────────────

test("NVIDIA clip names yield game, event and timestamp", () => {
  const parsed = parseClipFilename("Fortnite 2026.08.08 - 19.11.25.55.Elimination.DVR.mp4");
  assert.equal(parsed.game, "Fortnite");
  assert.equal(parsed.eventType, "Elimination");
  assert.ok(parsed.recordedAt !== null);
  // Parsed as local wall-clock time, so compare the local components.
  const date = new Date(parsed.recordedAt);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 7);
  assert.equal(date.getDate(), 8);
  assert.equal(date.getHours(), 19);
});

test("each documented NVIDIA event variant is recognised", () => {
  const cases = [
    ["Fortnite 2026.08.08 - 19.15.28.56.Eliminated.DVR.mp4", "Eliminated"],
    ["Fortnite 2026.08.08 - 19.11.25.55.Elimination.DVR.mp4", "Elimination"],
    ["Fortnite 2026.08.08 - 19.06.24.52.Down.DVR.mp4", "Down"],
  ];
  for (const [filename, expected] of cases) {
    assert.equal(parseClipFilename(filename).eventType, expected, filename);
  }
});

test("parsing is conservative: unknown names yield nulls rather than guesses", () => {
  const parsed = parseClipFilename("random-screenshot.png");
  assert.equal(parsed.game, null);
  assert.equal(parsed.eventType, null);
  assert.equal(parsed.recordedAt, null);
});

test("an impossible date is rejected instead of rolling over into a wrong month", () => {
  const parsed = parseClipFilename("Fortnite 2026.13.45 - 99.99.99.mp4");
  assert.equal(parsed.recordedAt, null);
});

test("a non-NVIDIA game name with spaces still parses", () => {
  const parsed = parseClipFilename("Rocket League 2026.03.01 - 10.00.00.12.Win.DVR.mp4");
  assert.equal(parsed.game, "Rocket League");
  assert.equal(parsed.eventType, "Win");
});

test("titles are suggested from parsed metadata, falling back to the filename stem", () => {
  assert.equal(
    suggestTitle("x.mp4", { game: "Fortnite", eventType: "Elimination", recordedAt: null }),
    "Fortnite Elimination",
  );
  assert.equal(suggestTitle("x.mp4", { game: "Fortnite", eventType: null, recordedAt: null }), "Fortnite");
  assert.equal(
    suggestTitle("my holiday video.mp4", { game: null, eventType: null, recordedAt: null }),
    "my holiday video",
  );
});
