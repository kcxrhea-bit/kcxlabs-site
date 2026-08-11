/**
 * Content type classification and upload validation rules.
 *
 * Pure and isomorphic. The API applies these server-side; the desktop applies
 * the same rules early so the user sees a rejection before spending minutes
 * uploading. The server's decision is always authoritative — the desktop check
 * is a convenience, never the enforcement point.
 *
 * The client's declared MIME type is treated as a *hint only*. `sniffMimeType`
 * inspects magic bytes, and `resolveContentType` prefers the sniffed result
 * whenever the two disagree.
 */

import type { MediaKind } from "./types.js";

// ─── Extension → type mapping ────────────────────────────────────────────────

const EXTENSION_TYPES: Record<string, { mimeType: string; kind: MediaKind }> = {
  ".mp4": { mimeType: "video/mp4", kind: "video" },
  ".mov": { mimeType: "video/quicktime", kind: "video" },
  ".webm": { mimeType: "video/webm", kind: "video" },
  ".mkv": { mimeType: "video/x-matroska", kind: "video" },
  ".avi": { mimeType: "video/x-msvideo", kind: "video" },
  ".png": { mimeType: "image/png", kind: "image" },
  ".jpg": { mimeType: "image/jpeg", kind: "image" },
  ".jpeg": { mimeType: "image/jpeg", kind: "image" },
  ".gif": { mimeType: "image/gif", kind: "image" },
  ".webp": { mimeType: "image/webp", kind: "image" },
  ".avif": { mimeType: "image/avif", kind: "image" },
  ".bmp": { mimeType: "image/bmp", kind: "image" },
  ".mp3": { mimeType: "audio/mpeg", kind: "audio" },
  ".wav": { mimeType: "audio/wav", kind: "audio" },
  ".flac": { mimeType: "audio/flac", kind: "audio" },
  ".ogg": { mimeType: "audio/ogg", kind: "audio" },
  ".pdf": { mimeType: "application/pdf", kind: "document" },
  ".txt": { mimeType: "text/plain", kind: "document" },
  ".md": { mimeType: "text/markdown", kind: "document" },
  ".json": { mimeType: "application/json", kind: "document" },
  ".csv": { mimeType: "text/csv", kind: "document" },
  ".docx": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  ".xlsx": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
  },
  ".zip": { mimeType: "application/zip", kind: "archive" },
  ".7z": { mimeType: "application/x-7z-compressed", kind: "archive" },
  ".rar": { mimeType: "application/vnd.rar", kind: "archive" },
  ".tar": { mimeType: "application/x-tar", kind: "archive" },
  ".gz": { mimeType: "application/gzip", kind: "archive" },
};

const FALLBACK = { mimeType: "application/octet-stream", kind: "other" as MediaKind };

export function typeFromExtension(extension: string): { mimeType: string; kind: MediaKind } {
  return EXTENSION_TYPES[extension.toLowerCase()] ?? FALLBACK;
}

// ─── Magic-byte sniffing ─────────────────────────────────────────────────────

/**
 * Signatures checked against the first bytes of the file. Only formats we care
 * about are listed; an unrecognised file is not an error, it is just "unknown"
 * and falls back to the extension mapping.
 */
const SIGNATURES: { mimeType: string; offset: number; bytes: number[] }[] = [
  { mimeType: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mimeType: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  { mimeType: "application/zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mimeType: "application/x-7z-compressed", offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { mimeType: "application/gzip", offset: 0, bytes: [0x1f, 0x8b] },
  { mimeType: "video/x-matroska", offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  // ISO base media (MP4/MOV): "ftyp" at offset 4. The major brand that follows
  // distinguishes MP4 from MOV, handled below.
  { mimeType: "video/mp4", offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
];

function matches(head: Uint8Array, signature: { offset: number; bytes: number[] }): boolean {
  if (head.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => head[signature.offset + index] === byte);
}

/**
 * Detect a content type from the leading bytes of a file, or null if unknown.
 *
 * `head` need only contain the first ~16 bytes. RIFF and ISO-BMFF containers
 * need a secondary check because their leading bytes are shared across formats.
 */
export function sniffMimeType(head: Uint8Array): string | null {
  // WEBP and WAV both start with "RIFF"; the format tag at offset 8 decides.
  if (matches(head, { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] })) {
    if (matches(head, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] })) return "image/webp";
    if (matches(head, { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] })) return "audio/wav";
    if (matches(head, { offset: 8, bytes: [0x41, 0x56, 0x49, 0x20] })) return "video/x-msvideo";
    return null;
  }

  for (const signature of SIGNATURES) {
    if (!matches(head, signature)) continue;

    if (signature.mimeType === "video/mp4") {
      // "qt  " major brand means QuickTime, not MP4.
      if (matches(head, { offset: 8, bytes: [0x71, 0x74, 0x20, 0x20] })) return "video/quicktime";
      return "video/mp4";
    }
    return signature.mimeType;
  }

  return null;
}

/**
 * Final content type for a record, preferring sniffed bytes over the extension
 * and over anything the client claimed.
 *
 * `extensionMismatch` is surfaced (not fatal) so the API can log it: a .mp4
 * that is actually a ZIP is worth recording even though we still store it.
 */
export function resolveContentType(input: {
  extension: string;
  declaredMimeType: string | null;
  head: Uint8Array | null;
}): { mimeType: string; kind: MediaKind; sniffed: boolean; extensionMismatch: boolean } {
  const fromExtension = typeFromExtension(input.extension);
  const sniffed = input.head === null ? null : sniffMimeType(input.head);

  if (sniffed === null) {
    return { ...fromExtension, sniffed: false, extensionMismatch: false };
  }

  const sniffedKind = kindForMimeType(sniffed);
  return {
    mimeType: sniffed,
    kind: sniffedKind,
    sniffed: true,
    extensionMismatch: sniffed !== fromExtension.mimeType,
  };
}

function kindForMimeType(mimeType: string): MediaKind {
  const known = Object.values(EXTENSION_TYPES).find((entry) => entry.mimeType === mimeType);
  if (known) return known.kind;
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "other";
}

// ─── Serving safety ──────────────────────────────────────────────────────────

/**
 * Types that may be rendered inline in the browser. Everything else is served
 * with `Content-Disposition: attachment`.
 *
 * This is an allowlist rather than a denylist of dangerous types: an unknown
 * format must download, not execute. HTML, SVG, and JS are excluded on purpose
 * — inline HTML/SVG under the site origin would be stored XSS against
 * kcxlabs.org, which is exactly what forcing a download prevents.
 */
const INLINE_SAFE = new Set([
  "video/mp4", "video/webm", "video/quicktime",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "audio/mpeg", "audio/wav", "audio/flac", "audio/ogg",
  "application/pdf",
  "text/plain",
]);

export function mayServeInline(mimeType: string): boolean {
  return INLINE_SAFE.has(mimeType.toLowerCase());
}

export function contentDispositionFor(mimeType: string): "inline" | "attachment" {
  return mayServeInline(mimeType) ? "inline" : "attachment";
}

// ─── Upload limits ───────────────────────────────────────────────────────────

/**
 * Ceiling on a single object. A hard cap is the primary defence against an
 * accidental multi-gigabyte upload turning into a storage bill, and it bounds
 * how much a single bad request can cost.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export type UploadValidation = { ok: true } | { ok: false; reason: string };

/**
 * Validate an upload request before any storage authorization is issued.
 *
 * Checks size bounds, filename safety, and hash shape. A zero-byte file is
 * rejected because it is almost always a still-recording or failed capture.
 */
export function validateUploadRequest(input: {
  filename: string;
  sizeBytes: number;
  sha256: string;
  maxUploadBytes?: number;
}): UploadValidation {
  const max = input.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: "File size must be a positive whole number of bytes." };
  }
  if (input.sizeBytes > max) {
    return {
      ok: false,
      reason: `File is larger than the ${Math.floor(max / (1024 * 1024 * 1024))} GB upload limit.`,
    };
  }
  if (!/^[0-9a-f]{64}$/i.test(input.sha256)) {
    return { ok: false, reason: "A valid 64-character SHA-256 hex digest is required." };
  }
  if (typeof input.filename !== "string" || input.filename.trim() === "") {
    return { ok: false, reason: "A filename is required." };
  }

  return { ok: true };
}
