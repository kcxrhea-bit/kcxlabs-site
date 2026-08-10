/**
 * Filename safety, archive path construction, and NVIDIA clip name parsing.
 *
 * Pure and isomorphic (no `node:path`) so the same rules can be unit-tested and
 * applied identically in the API and in the Electron archive service. The
 * Electron side additionally re-checks containment with `path.resolve` as a
 * belt-and-braces measure — this module is the first line, not the only one.
 *
 * Threat model: `originalFilename`, `game`, and `eventType` are attacker- or
 * accident-influenced strings that end up in a filesystem path under
 * D:\OldclipsfromKCxlabs. They must never be able to escape that root.
 */

// ─── Filename sanitisation ───────────────────────────────────────────────────

/** Characters Windows forbids in a filename, plus control characters. */
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Windows reserved device names. Creating "CON.mp4" fails or behaves oddly, so
 * these are prefixed rather than rejected — the upload must still succeed.
 */
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** Leaves room for the archive root, subdirectories, and a collision suffix. */
const MAX_FILENAME_LENGTH = 120;

/**
 * Reduce an arbitrary string to a single safe path segment.
 *
 * Strips directory separators and traversal, collapses whitespace, removes
 * characters Windows rejects, and guarantees a non-empty result. Never throws:
 * an unusable name degrades to a placeholder so an upload is never blocked by
 * a weird filename.
 */
export function sanitizeFilename(raw: string, fallback = "file"): string {
  let name = String(raw ?? "");

  // Take only the final segment: defeats "../../evil" and "C:\Windows\evil".
  const lastSeparator = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (lastSeparator !== -1) name = name.slice(lastSeparator + 1);

  name = name.replace(ILLEGAL_CHARS, "_").replace(/\s+/g, " ").trim();

  // A name of only dots ("." / "..") has no content once separators are gone.
  if (/^\.+$/.test(name)) name = "";
  // Windows silently strips trailing dots and spaces; do it explicitly instead.
  name = name.replace(/[. ]+$/, "");

  if (name === "") return fallback;

  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : "";

  // "con.mp4" would resolve to the console device; "_con.mp4" is inert.
  const safeStem = RESERVED_NAMES.has(stem.toLowerCase()) ? `_${stem}` : stem;

  const combined = `${safeStem}${ext}`;
  if (combined.length <= MAX_FILENAME_LENGTH) return combined;

  // Truncate the stem, never the extension — the extension carries the type.
  const room = Math.max(1, MAX_FILENAME_LENGTH - ext.length);
  return `${safeStem.slice(0, room)}${ext}`;
}

/** Sanitise a directory segment (game name, year, month). Never empty. */
export function sanitizePathSegment(raw: string, fallback = "Unsorted"): string {
  const cleaned = sanitizeFilename(raw, fallback);
  // A segment must not itself be a traversal token after sanitisation.
  return cleaned === "." || cleaned === ".." ? fallback : cleaned;
}

/** Lowercase extension including the dot, or "" when there is none. */
export function extractExtension(filename: string): string {
  const safe = sanitizeFilename(filename);
  const dotIndex = safe.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === safe.length - 1) return "";
  return safe.slice(dotIndex).toLowerCase();
}

// ─── Archive path construction ───────────────────────────────────────────────

export type ArchivePathInput = {
  game: string | null;
  recordedAt: string | null;
  uploadedAt: string | null;
  originalFilename: string;
};

/**
 * Relative archive location as separate segments, e.g.
 * ["Fortnite", "2026", "08", "Fortnite 2026.08.08 - 19.11.25.55.Elimination.DVR.mp4"].
 *
 * Returned as segments rather than a joined string so the caller joins with the
 * platform separator and so tests can assert on structure. Every segment is
 * sanitised, so the result cannot contain a separator or traversal token.
 *
 * Dates fall back recordedAt → uploadedAt → "Undated", keeping files grouped
 * even when NVIDIA's filename could not be parsed.
 */
export function buildArchiveSegments(input: ArchivePathInput): string[] {
  const game = sanitizePathSegment(input.game ?? "Unsorted", "Unsorted");

  const stamp = input.recordedAt ?? input.uploadedAt;
  const parsed = stamp === null ? Number.NaN : Date.parse(stamp);

  if (Number.isNaN(parsed)) {
    return [game, "Undated", sanitizeFilename(input.originalFilename)];
  }

  const date = new Date(parsed);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  return [game, year, month, sanitizeFilename(input.originalFilename)];
}

/**
 * Deterministic collision suffix: "clip.mp4" → "clip (2).mp4" → "clip (3).mp4".
 *
 * Deterministic rather than random so a retried archive job that re-runs after
 * a crash produces the same candidate sequence instead of scattering copies.
 */
export function withCollisionSuffix(filename: string, attempt: number): string {
  if (attempt <= 1) return filename;

  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : "";
  return `${stem} (${attempt})${ext}`;
}

/**
 * Whether `candidate` lies inside `root`, using normalised Windows-style paths.
 *
 * Comparison is case-insensitive (Windows filesystems are), separators are
 * unified, and the root is compared with a trailing separator so that
 * "D:\Old" does not appear to contain "D:\OldOther\x". Any candidate still
 * containing a ".." segment after normalisation is rejected outright.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/\\+$/, "").toLowerCase();

  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);

  if (normalizedRoot === "" ) return false;
  // Defence in depth: a surviving traversal token means normalisation was
  // incomplete or the input was crafted; refuse rather than guess.
  if (normalizedCandidate.split("\\").includes("..")) return false;

  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}\\`);
}

// ─── Object storage keys ─────────────────────────────────────────────────────

/**
 * Deterministic storage key: "media/<ownerId>/<publicId>/<safe filename>".
 *
 * Derived from server-controlled ids rather than client input, so two uploads
 * can never collide and a crafted filename cannot reach another owner's prefix.
 * The filename is kept as the final segment purely so downloads have a sensible
 * default name; it is sanitised and stripped of separators first.
 *
 * Deterministic keys also make finalize idempotent: a retried upload targets the
 * same object rather than orphaning a second copy in the bucket.
 */
export function buildStorageKey(ownerId: string, publicId: string, originalFilename: string): string {
  const owner = sanitizePathSegment(ownerId, "owner");
  const id = sanitizePathSegment(publicId, "item");
  return `media/${owner}/${id}/${sanitizeFilename(originalFilename)}`;
}

/** Thumbnail key alongside the original, never overlapping it. */
export function buildThumbnailKey(ownerId: string, publicId: string): string {
  const owner = sanitizePathSegment(ownerId, "owner");
  const id = sanitizePathSegment(publicId, "item");
  return `thumbs/${owner}/${id}/poster.jpg`;
}

// ─── NVIDIA / ShadowPlay filename parsing ────────────────────────────────────

/**
 * Event keywords NVIDIA embeds in highlight filenames. Conservative on purpose:
 * only well-known tokens are recognised, and an unrecognised name simply yields
 * no event rather than a guess.
 */
const KNOWN_EVENTS = ["Elimination", "Eliminated", "Down", "Knockout", "Victory", "Win", "Assist"];

export type ParsedClipName = {
  game: string | null;
  eventType: string | null;
  /** ISO 8601 UTC, or null when no reliable timestamp was present. */
  recordedAt: string | null;
};

/**
 * Best-effort metadata from a filename such as
 * "Fortnite 2026.08.08 - 19.11.25.55.Elimination.DVR.mp4".
 *
 * Parsing is advisory only. Every field may be null and upload must succeed
 * regardless — `originalFilename` is always preserved verbatim on the record.
 *
 * The timestamp is interpreted as local wall-clock time (that is how NVIDIA
 * writes it) and converted to UTC by the caller's environment, which is the
 * capturing machine. Fractional/sequence trailing digits are ignored.
 */
export function parseClipFilename(filename: string): ParsedClipName {
  const name = sanitizeFilename(filename);
  const empty: ParsedClipName = { game: null, eventType: null, recordedAt: null };
  if (name === "") return empty;

  // "<Game> YYYY.MM.DD - HH.MM.SS[.NN]"
  const match = name.match(/^(.+?)\s+(\d{4})\.(\d{2})\.(\d{2})\s+-\s+(\d{2})\.(\d{2})\.(\d{2})/);

  let game: string | null = null;
  let recordedAt: string | null = null;

  if (match) {
    const [, rawGame, year, month, day, hour, minute, second] = match;
    const trimmedGame = rawGame.trim();
    if (trimmedGame !== "") game = trimmedGame;

    const date = new Date(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second),
    );
    // Reject impossible dates (e.g. month 13) rather than letting Date roll over.
    const rolledOver =
      date.getFullYear() !== Number(year) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day) ||
      date.getHours() !== Number(hour) ||
      date.getMinutes() !== Number(minute);
    if (!rolledOver) recordedAt = date.toISOString();
  }

  // Event token is matched independently so an unparseable date does not lose it.
  const eventType =
    KNOWN_EVENTS.find((event) =>
      new RegExp(`(^|[.\\s_-])${event}([.\\s_-]|$)`, "i").test(name),
    ) ?? null;

  return { game, eventType, recordedAt };
}

/**
 * Readable default title, e.g. "Fortnite Elimination". Falls back to the
 * filename stem so every item has a usable title without manual editing.
 */
export function suggestTitle(filename: string, parsed: ParsedClipName): string {
  if (parsed.game && parsed.eventType) return `${parsed.game} ${parsed.eventType}`;
  if (parsed.game) return parsed.game;

  const safe = sanitizeFilename(filename);
  const dotIndex = safe.lastIndexOf(".");
  const stem = dotIndex > 0 ? safe.slice(0, dotIndex) : safe;
  return stem === "" ? "Untitled" : stem;
}
