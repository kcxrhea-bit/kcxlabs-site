/**
 * Camera-backup eligibility: the single allowed camera and its upload
 * schedule window. Pure and isomorphic — no I/O, so it is trivially
 * unit-testable and can be mirrored by the desktop without drift risk
 * (the desktop does its own trim; this is the server's independent,
 * authoritative re-check — see `upload-authorize.ts`).
 */

/** Hard allow-list of exactly one camera. Not a soft warning — anything else is rejected outright. */
export const ALLOWED_CAMERAS = ["living-room"] as const;
export type AllowedCamera = (typeof ALLOWED_CAMERAS)[number];

export function isAllowedCamera(value: unknown): value is AllowedCamera {
  return typeof value === "string" && (ALLOWED_CAMERAS as readonly string[]).includes(value);
}

export const SCHEDULE_TIME_ZONE = "America/Los_Angeles";
export const SCHEDULE_START_HOUR = 6; // 06:00:00 inclusive
export const SCHEDULE_END_HOUR = 22; // 22:00:00 exclusive

/**
 * Wall-clock parts of an instant in `SCHEDULE_TIME_ZONE`, DST-aware via the
 * platform's `Intl` timezone database — no manual offset arithmetic.
 */
function laParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  // Intl's 24-hour "hour" field can print "24" for midnight in some locales/engines; normalize.
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function laDayKey(instant: Date): string {
  const p = laParts(instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function laSecondsSinceMidnight(instant: Date): number {
  const p = laParts(instant);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

const WINDOW_START_SECONDS = SCHEDULE_START_HOUR * 3600;
const WINDOW_END_SECONDS = SCHEDULE_END_HOUR * 3600;

/**
 * UTC instants bounding one America/Los_Angeles calendar day, for the
 * archive listing's `date` filter. Computed by binary-searching for the
 * UTC instant whose LA day-key changes, rather than naive offset math, so
 * it is correct across a DST transition day (which is 23 or 25 hours long
 * in LA wall-clock terms, not a fixed 24).
 */
export function laDayBoundsUtc(dateKey: string): { fromIso: string; toIso: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  // A UTC midnight guess close to the LA day is always within +/-1 day of it
  // (LA is UTC-7 or UTC-8), so searching a 3-day window around it is enough.
  const guess = new Date(`${dateKey}T12:00:00Z`).getTime();
  const SEARCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

  function findBoundary(after: boolean): number {
    // Find the instant where `laDayKey(instant) === dateKey` flips, scanning
    // minute-by-minute within the search window — cheap (a few thousand
    // iterations) and immune to any DST arithmetic mistake.
    let lo = guess - SEARCH_WINDOW_MS;
    let hi = guess + SEARCH_WINDOW_MS;
    const MINUTE = 60_000;
    let boundary = after ? hi : lo;
    for (let t = lo; t <= hi; t += MINUTE) {
      const isTarget = laDayKey(new Date(t)) === dateKey;
      if (after && !isTarget && t > guess) {
        boundary = t;
        break;
      }
      if (!after && isTarget) {
        boundary = t;
        break;
      }
    }
    return boundary;
  }

  const fromMs = findBoundary(false);
  const toMs = findBoundary(true);
  if (!(toMs > fromMs)) return null;
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
}

export type ScheduleCheck =
  | { ok: true }
  | { ok: false; reason: "invalid_range" | "crosses_day" | "before_window" | "after_window" | "spans_outside_window" };

/**
 * Requires the ENTIRE `[startIso, endIso)` interval to fall on the same
 * America/Los_Angeles calendar day, within [06:00:00, 22:00:00) local time.
 *
 * This is a defense-in-depth re-check: the desktop is expected to have
 * already trimmed any boundary-crossing recording before calling
 * upload-authorize, so in normal operation this should always pass for an
 * already-trimmed clip. A recording that still crosses a boundary when it
 * reaches here is rejected outright (422), never silently re-trimmed
 * server-side.
 */
export function checkSchedule(startIso: string, endIso: string): ScheduleCheck {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return { ok: false, reason: "invalid_range" };
  }

  if (laDayKey(start) !== laDayKey(end)) return { ok: false, reason: "crosses_day" };

  const startSeconds = laSecondsSinceMidnight(start);
  // An end exactly at a second boundary (e.g. 22:00:00.000) is end-exclusive;
  // subtracting 1ms before reading the clock avoids a recording that ends
  // exactly at the boundary being misread as one second into the next bucket.
  const endSeconds = laSecondsSinceMidnight(new Date(end.getTime() - 1));

  if (startSeconds < WINDOW_START_SECONDS) return { ok: false, reason: "before_window" };
  if (endSeconds >= WINDOW_END_SECONDS) return { ok: false, reason: "after_window" };
  if (startSeconds >= WINDOW_END_SECONDS || endSeconds < WINDOW_START_SECONDS) {
    return { ok: false, reason: "spans_outside_window" };
  }
  return { ok: true };
}
