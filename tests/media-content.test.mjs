import test from "node:test";
import assert from "node:assert/strict";

import {
  typeFromExtension,
  sniffMimeType,
  resolveContentType,
  mayServeInline,
  contentDispositionFor,
  validateUploadRequest,
  isPubliclyListable,
  isAnonymouslyReachable,
  defaultMediaVisibility,
  defaultMediaSettings,
  toPublicMediaItem,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "../dist-electron/media-core.cjs";

const bytes = (...values) => Uint8Array.from(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const MP4 = bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0);

// ─── Content sniffing ────────────────────────────────────────────────────────

test("magic bytes identify the common capture formats", () => {
  assert.equal(sniffMimeType(PNG), "image/png");
  assert.equal(sniffMimeType(MP4), "video/mp4");
  assert.equal(sniffMimeType(ZIP), "application/zip");
  assert.equal(sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(sniffMimeType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "image/gif");
});

test("RIFF containers are disambiguated by their format tag", () => {
  const riff = (tag) => bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, ...tag);
  assert.equal(sniffMimeType(riff([0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffMimeType(riff([0x57, 0x41, 0x56, 0x45])), "audio/wav");
  assert.equal(sniffMimeType(riff([0x41, 0x56, 0x49, 0x20])), "video/x-msvideo");
});

test("an ISO container with the QuickTime brand is not reported as MP4", () => {
  const mov = bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20);
  assert.equal(sniffMimeType(mov), "video/quicktime");
});

test("unrecognised and truncated input sniffs to null rather than guessing", () => {
  assert.equal(sniffMimeType(bytes(0x00, 0x01, 0x02, 0x03)), null);
  assert.equal(sniffMimeType(bytes(0x89)), null);
  assert.equal(sniffMimeType(new Uint8Array(0)), null);
});

test("sniffed bytes win over the extension, and the mismatch is reported", () => {
  // A ZIP wearing a .mp4 extension: stored, but classified by its real content.
  const resolved = resolveContentType({
    extension: ".mp4",
    declaredMimeType: "video/mp4",
    head: ZIP,
  });
  assert.equal(resolved.mimeType, "application/zip");
  assert.equal(resolved.kind, "archive");
  assert.equal(resolved.sniffed, true);
  assert.equal(resolved.extensionMismatch, true);
});

test("a client-declared MIME type never overrides sniffed content", () => {
  const resolved = resolveContentType({
    extension: ".png",
    declaredMimeType: "text/html",
    head: PNG,
  });
  assert.equal(resolved.mimeType, "image/png");
});

test("unsniffable content falls back to the extension mapping", () => {
  const resolved = resolveContentType({ extension: ".mkv", declaredMimeType: null, head: null });
  assert.equal(resolved.mimeType, "video/x-matroska");
  assert.equal(resolved.kind, "video");
  assert.equal(resolved.sniffed, false);
});

test("an unknown extension classifies as an opaque binary, not as media", () => {
  assert.deepEqual(typeFromExtension(".qqq"), {
    mimeType: "application/octet-stream",
    kind: "other",
  });
});

// ─── Serving safety ──────────────────────────────────────────────────────────

test("browser-safe media may render inline", () => {
  for (const type of ["video/mp4", "image/png", "image/gif", "application/pdf"]) {
    assert.equal(mayServeInline(type), true, type);
    assert.equal(contentDispositionFor(type), "inline", type);
  }
});

test("active content types are forced to download, preventing stored XSS on the origin", () => {
  for (const type of [
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "application/x-msdownload",
    "application/zip",
    "application/octet-stream",
  ]) {
    assert.equal(mayServeInline(type), false, type);
    assert.equal(contentDispositionFor(type), "attachment", type);
  }
});

// ─── Upload validation ───────────────────────────────────────────────────────

const validRequest = {
  filename: "clip.mp4",
  sizeBytes: 150 * 1024 * 1024,
  sha256: "a".repeat(64),
};

test("a well-formed upload request is accepted", () => {
  assert.deepEqual(validateUploadRequest(validRequest), { ok: true });
});

test("a zero-byte or negative file is rejected as a failed capture", () => {
  assert.equal(validateUploadRequest({ ...validRequest, sizeBytes: 0 }).ok, false);
  assert.equal(validateUploadRequest({ ...validRequest, sizeBytes: -1 }).ok, false);
  assert.equal(validateUploadRequest({ ...validRequest, sizeBytes: 1.5 }).ok, false);
});

test("a file beyond the size ceiling is rejected before any storage authorization", () => {
  const result = validateUploadRequest({
    ...validRequest,
    sizeBytes: DEFAULT_MAX_UPLOAD_BYTES + 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /upload limit/);
});

test("the size ceiling is configurable per deployment", () => {
  const result = validateUploadRequest({ ...validRequest, maxUploadBytes: 1024 });
  assert.equal(result.ok, false);
});

test("a malformed or missing SHA-256 is rejected, since dedupe and archive depend on it", () => {
  assert.equal(validateUploadRequest({ ...validRequest, sha256: "" }).ok, false);
  assert.equal(validateUploadRequest({ ...validRequest, sha256: "abc" }).ok, false);
  assert.equal(validateUploadRequest({ ...validRequest, sha256: "z".repeat(64) }).ok, false);
  // Upper-case hex is valid.
  assert.equal(validateUploadRequest({ ...validRequest, sha256: "A".repeat(64) }).ok, true);
});

test("an empty filename is rejected", () => {
  assert.equal(validateUploadRequest({ ...validRequest, filename: "   " }).ok, false);
});

// ─── Visibility (requirements 3, 4, 5, 6) ────────────────────────────────────

test("uploads default to unlisted, so sharing is always a deliberate act", () => {
  assert.equal(defaultMediaVisibility, "unlisted");
  assert.equal(defaultMediaSettings.defaultVisibility, "unlisted");
  assert.equal(defaultMediaSettings.autoUpload, false);
  assert.equal(defaultMediaSettings.retentionDays, 30);
});

test("only public media is listable; private and unlisted are excluded from listings", () => {
  assert.equal(isPubliclyListable("public"), true);
  assert.equal(isPubliclyListable("unlisted"), false);
  assert.equal(isPubliclyListable("private"), false);
});

test("unlisted and public are link-reachable; private requires the owner", () => {
  assert.equal(isAnonymouslyReachable("unlisted"), true);
  assert.equal(isAnonymouslyReachable("public"), true);
  assert.equal(isAnonymouslyReachable("private"), false);
});

test("the public projection discloses no storage keys, hashes, paths, or owner", () => {
  const item = {
    id: "internal-uuid",
    publicId: "N7hd4KpQ",
    ownerId: "owner-secret",
    originalFilename: "clip.mp4",
    extension: ".mp4",
    mimeType: "video/mp4",
    kind: "video",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    storageProvider: "r2",
    storageObjectKey: "media/owner-secret/N7hd4KpQ/clip.mp4",
    thumbnailKey: "thumbs/owner-secret/N7hd4KpQ/poster.jpg",
    title: "Clip",
    description: null,
    tags: [],
    game: "Fortnite",
    eventType: "Elimination",
    durationSeconds: 20,
    width: 1920,
    height: 1080,
    codec: "h264",
    status: "active",
    visibility: "unlisted",
    retentionDays: 30,
    keepOnline: false,
    archiveState: "active",
    archiveEligibleAt: null,
    archivedAt: null,
    localArchiveVerified: false,
    localArchivePath: "D:\\OldclipsfromKCxlabs\\Fortnite\\2026\\08\\clip.mp4",
    recordedAt: null,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const projected = toPublicMediaItem(item);
  const serialized = JSON.stringify(projected);

  for (const leak of [
    "internal-uuid",
    "owner-secret",
    "a".repeat(64),
    "OldclipsfromKCxlabs",
    "thumbs/",
    "media/owner-secret",
  ]) {
    assert.ok(!serialized.includes(leak), `public projection leaked: ${leak}`);
  }
  assert.equal(projected.publicId, "N7hd4KpQ");
  assert.equal(projected.title, "Clip");
});
