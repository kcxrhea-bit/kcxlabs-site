/**
 * R2 storage budget evaluation.
 *
 * KCx Media Center treats Cloudflare R2 as *bounded hot storage* and the PC as
 * the long-term archive. This module decides whether an upload may start, and
 * it is the mechanism behind the "$0/month whenever practical" requirement.
 *
 * Pure and isomorphic: no network, no clock, no credentials. `now` and all
 * metrics are passed in, so every branch is unit-testable without a Cloudflare
 * account — which matters because this is the code that has to be right before
 * any real bucket exists.
 *
 * ── The three different numbers, which are NOT interchangeable ──────────────
 *
 * 1. LOCAL ESTIMATE (`localTrackedBytes`)
 *    Sum of `onlineBytesFor()` across our own media records. Always available,
 *    updated the instant we upload or archive, and authoritative about what we
 *    *intended*. It cannot see objects we do not know about (a failed multipart
 *    upload, a manual dashboard upload, an orphaned thumbnail).
 *
 * 2. PROVIDER-REPORTED BYTES (`providerReportedBytes`)
 *    payloadSize + metadataSize from Cloudflare's GraphQL Analytics API
 *    (`r2StorageAdaptiveGroups`). This is a point-in-time measurement of what
 *    is physically in the bucket. It can lag, and it can be unavailable.
 *
 * 3. BILLABLE USAGE (GB-month)
 *    What Cloudflare actually charges on. This is an integral of stored bytes
 *    over time, NOT a snapshot. Deleting 3 GB today does not undo the GB-month
 *    already accrued this month. We deliberately do NOT compute or display this
 *    as a number, because we cannot derive it reliably — see `BillingNote`.
 *
 * The budget uses the MOST CONSERVATIVE of (1) and (2): the larger number wins.
 * If the provider says 6 GB and we think 7 GB, we plan against 7 GB.
 *
 * ── Degraded mode ───────────────────────────────────────────────────────────
 *
 * When (2) is stale or unavailable, only (1) is left — and (1) cannot see
 * objects KCxLabs did not create. Rather than trust it up to the normal 8 GB
 * ceiling, a stricter 6 GB ceiling applies to AUTOMATIC uploads, measured
 * against the local figure. Manual uploads are not blocked by this, but they
 * carry an explicit warning; they are never silently allowed through.
 *
 * Normal 7 GB / 8 GB behaviour is completely unchanged while metrics are fresh.
 */

import type { ArchiveState, MediaRecordStatus } from "./types.js";

const GB = 1024 * 1024 * 1024;

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Cloudflare R2 Standard's free storage allowance. Shown for context only —
 * this is NOT the number we plan against, and nothing may be sized against it.
 */
export const R2_FREE_TIER_BYTES = 10 * GB;

/** Above this, archiving is actively recommended and surfaced in the UI. */
export const DEFAULT_WARNING_THRESHOLD_BYTES = 7 * GB;

/**
 * Hard application ceiling. Uploads pause here rather than at the free-tier
 * limit, deliberately leaving ~2 GB of headroom.
 *
 * The headroom exists because our view of the bucket is never perfectly exact
 * or perfectly fresh: provider metrics lag, multipart uploads can leave parts
 * behind, and billing is measured over time rather than at an instant. Reacting
 * at 9.9 GB would mean reacting after it is already too late.
 */
export const DEFAULT_PAUSE_THRESHOLD_BYTES = 8 * GB;

/**
 * Degraded-mode ceiling for AUTOMATIC uploads, used whenever Cloudflare's
 * measurement is stale or unavailable.
 *
 * Deliberately stricter than the 8 GB normal ceiling, and evaluated against the
 * LOCAL tracked figure. The reason is specific: local accounting is authoritative
 * about objects KCxLabs uploaded, but it is structurally blind to anything it
 * did not create — orphaned multipart parts, objects written by another tool,
 * or thumbnails left behind by a failed cleanup. When Cloudflare cannot confirm
 * the real total, that blind spot is unbounded, so the safe response is to stop
 * automatic uploads well short of the normal ceiling and wait for a real
 * measurement rather than to keep writing on an unverifiable estimate.
 *
 * Normal 7 GB / 8 GB behaviour is untouched whenever metrics are fresh.
 */
export const DEFAULT_DEGRADED_THRESHOLD_BYTES = 6 * GB;

/** Provider metrics older than this are treated as stale and not trusted alone. */
export const DEFAULT_METRICS_STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

export type StorageThresholds = {
  warningBytes: number;
  pauseBytes: number;
  /** Auto-upload ceiling while provider metrics are stale or unavailable. */
  degradedBytes: number;
  freeTierBytes: number;
  staleAfterMs: number;
};

export const defaultStorageThresholds: StorageThresholds = {
  warningBytes: DEFAULT_WARNING_THRESHOLD_BYTES,
  pauseBytes: DEFAULT_PAUSE_THRESHOLD_BYTES,
  degradedBytes: DEFAULT_DEGRADED_THRESHOLD_BYTES,
  freeTierBytes: R2_FREE_TIER_BYTES,
  staleAfterMs: DEFAULT_METRICS_STALE_AFTER_MS,
};

/**
 * Coerce operator-configured thresholds into a safe, ordered pair.
 *
 * Guards against a settings mistake that would defeat the whole design: a pause
 * threshold above the free tier, a warning above the pause, or non-numeric
 * input all fall back to safe values rather than being honoured.
 */
export function normalizeThresholds(input: Partial<StorageThresholds> = {}): StorageThresholds {
  const freeTierBytes =
    Number.isFinite(input.freeTierBytes) && (input.freeTierBytes as number) > 0
      ? (input.freeTierBytes as number)
      : R2_FREE_TIER_BYTES;

  let pauseBytes =
    Number.isFinite(input.pauseBytes) && (input.pauseBytes as number) > 0
      ? (input.pauseBytes as number)
      : DEFAULT_PAUSE_THRESHOLD_BYTES;
  // Never allow the ceiling to sit at or above the free allowance: headroom is
  // the point of the ceiling.
  pauseBytes = Math.min(pauseBytes, freeTierBytes);

  let warningBytes =
    Number.isFinite(input.warningBytes) && (input.warningBytes as number) > 0
      ? (input.warningBytes as number)
      : DEFAULT_WARNING_THRESHOLD_BYTES;
  // A warning at or above the ceiling would never fire before the pause.
  if (warningBytes >= pauseBytes) warningBytes = Math.floor(pauseBytes * 0.875);

  let degradedBytes =
    Number.isFinite(input.degradedBytes) && (input.degradedBytes as number) > 0
      ? (input.degradedBytes as number)
      : DEFAULT_DEGRADED_THRESHOLD_BYTES;
  // Degraded mode must never be more permissive than normal operation:
  // a degraded ceiling above the pause threshold would defeat its purpose.
  degradedBytes = Math.min(degradedBytes, pauseBytes);

  const staleAfterMs =
    Number.isFinite(input.staleAfterMs) && (input.staleAfterMs as number) > 0
      ? (input.staleAfterMs as number)
      : DEFAULT_METRICS_STALE_AFTER_MS;

  return { warningBytes, pauseBytes, degradedBytes, freeTierBytes, staleAfterMs };
}

// ─── Provider metrics ────────────────────────────────────────────────────────

/**
 * A reading from Cloudflare's GraphQL Analytics API, or the absence of one.
 *
 * `source` is carried all the way to the UI so a local estimate can never be
 * displayed as an official Cloudflare measurement.
 */
export type ProviderMetrics = {
  /** payloadSize + metadataSize for the bucket. */
  storedBytes: number;
  objectCount: number;
  /** Pending multipart uploads — bytes that count against storage but are ours. */
  pendingUploadCount: number | null;
  /** When Cloudflare's measurement was taken, ISO 8601. */
  measuredAt: string;
};

export const storageMetricsSourceValues = [
  "cloudflare_api",
  "local_estimate",
  "cloudflare_api_stale",
] as const;

export type StorageMetricsSource = (typeof storageMetricsSourceValues)[number];

/** Human-readable label. Never claims Cloudflare origin for a local number. */
export const storageMetricsSourceLabel: Record<StorageMetricsSource, string> = {
  cloudflare_api: "Measured by Cloudflare",
  cloudflare_api_stale: "Measured by Cloudflare (out of date)",
  local_estimate: "KCxLabs local estimate — not an official Cloudflare measurement",
};

export const storageStatusValues = [
  "normal",
  "archive_recommended",
  "uploads_paused",
  "metrics_stale",
  "metrics_unavailable",
] as const;

export type StorageStatus = (typeof storageStatusValues)[number];

// ─── Evaluation ──────────────────────────────────────────────────────────────

export type StorageBudgetInput = {
  /** Sum of onlineBytesFor() over our own records. Always present. */
  localTrackedBytes: number;
  /** Latest Cloudflare reading, or null when never fetched / the call failed. */
  providerMetrics: ProviderMetrics | null;
  /** Size of the upload being considered. 0 to evaluate current state only. */
  incomingBytes?: number;
  thresholds?: Partial<StorageThresholds>;
  now: Date;
};

export type StorageBudget = {
  /** The number we actually plan against: max(local, provider). */
  currentOnlineBytes: number;
  localTrackedBytes: number;
  providerReportedBytes: number | null;
  /** Which measurement won, and therefore how it may be labelled in the UI. */
  source: StorageMetricsSource;
  lastProviderMetricsAt: string | null;
  metricsStale: boolean;

  warningThresholdBytes: number;
  pauseThresholdBytes: number;
  degradedThresholdBytes: number;
  freeTierBytes: number;

  /** Bytes remaining below the safety ceiling. Never negative. */
  headroomBytes: number;
  /** currentOnlineBytes + incomingBytes. What the check is actually against. */
  projectedBytes: number;
  /** localTrackedBytes + incomingBytes. What degraded mode is checked against. */
  projectedLocalBytes: number;

  status: StorageStatus;
  /**
   * True whenever Cloudflare's measurement is stale or missing, so the figures
   * shown are not fully corroborated.
   */
  degradedMode: boolean;

  /**
   * The hard ceiling gate. False only when the 8 GB safety ceiling would be
   * reached. Governs manual, owner-initiated uploads and restores.
   */
  uploadAllowed: boolean;

  /**
   * The strict gate for UNATTENDED uploads (the NVIDIA watcher in Auto mode).
   *
   * Always at least as strict as `uploadAllowed`, and stricter in degraded
   * mode. Automatic uploads happen without anyone watching, so they are the
   * ones held back when the true bucket total cannot be confirmed.
   */
  autoUploadAllowed: boolean;
  /** Why automatic uploads are paused, or null when they are running. */
  autoUploadPausedReason: string | null;
  /**
   * Warning to show before a manual upload proceeds, or null. Non-null means
   * "let them continue, but say this first" — never a silent proceed.
   */
  manualUploadWarning: string | null;

  /** Plain-English explanation of the overall state. */
  reason: string;
};

const formatGb = (bytes: number) => `${(bytes / GB).toFixed(2)} GB`;

/**
 * Decide whether an upload of `incomingBytes` may proceed.
 *
 * Fails safe in every direction:
 *   - Uses the LARGER of the local and provider measurements.
 *   - Counts the incoming file BEFORE starting, so a 400 MB clip at 7.9 GB is
 *     refused rather than discovered to be over the line afterwards.
 *   - Treats missing or stale provider metrics as a reason for caution, not as
 *     permission to assume the bucket is empty.
 *
 * Honest limitation: these are application-side safeguards. Cloudflare does not
 * expose a hard provider-side spend cap that we can configure, so this reduces
 * the risk of overage — it cannot make billing impossible.
 */
export function evaluateStorageBudget(input: StorageBudgetInput): StorageBudget {
  const thresholds = normalizeThresholds(input.thresholds);
  const incomingBytes =
    Number.isFinite(input.incomingBytes) && (input.incomingBytes as number) > 0
      ? (input.incomingBytes as number)
      : 0;

  const localTrackedBytes = Math.max(0, input.localTrackedBytes);
  const providerReportedBytes = input.providerMetrics?.storedBytes ?? null;
  const lastProviderMetricsAt = input.providerMetrics?.measuredAt ?? null;

  // Staleness: an old reading is still information, but it must be labelled and
  // must not be allowed to look more current than it is.
  let metricsStale = false;
  if (input.providerMetrics !== null) {
    const measuredMs = Date.parse(input.providerMetrics.measuredAt);
    metricsStale =
      Number.isNaN(measuredMs) || input.now.getTime() - measuredMs > thresholds.staleAfterMs;
  }

  // The conservative choice: whichever measurement is larger. If Cloudflare has
  // not reported, the local estimate is all we have and is used alone.
  const currentOnlineBytes =
    providerReportedBytes === null
      ? localTrackedBytes
      : Math.max(localTrackedBytes, providerReportedBytes);

  let source: StorageMetricsSource;
  if (providerReportedBytes === null) source = "local_estimate";
  else if (metricsStale) source = "cloudflare_api_stale";
  else if (localTrackedBytes > providerReportedBytes) source = "local_estimate";
  else source = "cloudflare_api";

  const headroomBytes = Math.max(0, thresholds.pauseBytes - currentOnlineBytes);
  const projectedBytes = currentOnlineBytes + incomingBytes;
  const projectedLocalBytes = localTrackedBytes + incomingBytes;

  // Degraded mode: Cloudflare has not corroborated our figures recently.
  const degradedMode = providerReportedBytes === null || metricsStale;

  // ── Decision, most severe first ──
  let status: StorageStatus;
  let uploadAllowed: boolean;
  let reason: string;

  if (projectedBytes >= thresholds.pauseBytes) {
    status = "uploads_paused";
    uploadAllowed = false;
    reason =
      incomingBytes > 0
        ? `Uploads paused. Adding ${formatGb(incomingBytes)} would bring storage to ` +
          `${formatGb(projectedBytes)}, at or past the ${formatGb(thresholds.pauseBytes)} safety ceiling. ` +
          `Archive some clips to your PC to free space.`
        : `Uploads paused. Storage is ${formatGb(currentOnlineBytes)}, at or past the ` +
          `${formatGb(thresholds.pauseBytes)} safety ceiling. Archive some clips to your PC to free space.`;
  } else if (providerReportedBytes === null) {
    // We can still upload — the local estimate is trustworthy about our own
    // objects — but the UI must not imply Cloudflare confirmed this number.
    status = "metrics_unavailable";
    uploadAllowed = true;
    reason =
      `Cloudflare storage metrics are unavailable. Using the KCxLabs local estimate of ` +
      `${formatGb(localTrackedBytes)}, which counts only media KCxLabs knows about.`;
  } else if (metricsStale) {
    status = "metrics_stale";
    uploadAllowed = true;
    reason =
      `Cloudflare storage metrics are out of date. Planning against the more cautious of the ` +
      `two figures: ${formatGb(currentOnlineBytes)}.`;
  } else if (projectedBytes >= thresholds.warningBytes) {
    status = "archive_recommended";
    uploadAllowed = true;
    reason =
      `Storage is at ${formatGb(currentOnlineBytes)} of a ${formatGb(thresholds.pauseBytes)} safety ceiling. ` +
      `Archiving older clips to your PC now will avoid uploads pausing later.`;
  } else {
    status = "normal";
    uploadAllowed = true;
    reason = `Storage is normal: ${formatGb(currentOnlineBytes)} used, ${formatGb(headroomBytes)} of headroom.`;
  }

  // ── Automatic-upload gate ──
  //
  // Starts from the hard ceiling, then applies the stricter degraded rule. An
  // unattended upload must never proceed on figures Cloudflare has not
  // corroborated once the local total alone is no longer comfortably small.
  let autoUploadAllowed = uploadAllowed;
  let autoUploadPausedReason: string | null = uploadAllowed ? null : reason;
  let manualUploadWarning: string | null = null;

  if (degradedMode) {
    const measurementNote =
      providerReportedBytes === null
        ? "Cloudflare storage metrics are unavailable"
        : "Cloudflare storage metrics are out of date";

    if (projectedLocalBytes >= thresholds.degradedBytes) {
      autoUploadAllowed = false;
      autoUploadPausedReason =
        `Automatic uploads paused. ${measurementNote}, and KCxLabs is tracking ` +
        `${formatGb(projectedLocalBytes)}, at or past the ${formatGb(thresholds.degradedBytes)} ` +
        `limit that applies while storage cannot be confirmed. Automatic uploads resume once ` +
        `Cloudflare reports current usage. You can still upload manually.`;
      manualUploadWarning =
        `${measurementNote}. KCxLabs is tracking ${formatGb(projectedLocalBytes)} but cannot ` +
        `confirm the real total, which may be higher if the bucket contains files KCxLabs did ` +
        `not upload. Continue only if you are sure there is room.`;
    } else {
      // Below the degraded ceiling automatic uploads continue, but the figures
      // are still uncorroborated, so a manual upload says so first.
      manualUploadWarning =
        `${measurementNote}. Proceeding using the KCxLabs local estimate of ` +
        `${formatGb(localTrackedBytes)}, which counts only media KCxLabs knows about.`;
    }
  }

  return {
    currentOnlineBytes,
    localTrackedBytes,
    providerReportedBytes,
    source,
    lastProviderMetricsAt,
    metricsStale,
    warningThresholdBytes: thresholds.warningBytes,
    pauseThresholdBytes: thresholds.pauseBytes,
    degradedThresholdBytes: thresholds.degradedBytes,
    freeTierBytes: thresholds.freeTierBytes,
    headroomBytes,
    projectedBytes,
    projectedLocalBytes,
    status,
    degradedMode,
    uploadAllowed,
    autoUploadAllowed,
    autoUploadPausedReason,
    manualUploadWarning,
    reason,
  };
}

/**
 * Bytes that must be freed for `incomingBytes` to fit below the ceiling.
 * Zero when it already fits. Drives "archive enough to make room" planning.
 */
export function bytesToFree(budget: StorageBudget, incomingBytes: number): number {
  const projected = budget.currentOnlineBytes + Math.max(0, incomingBytes);
  // Strictly below the ceiling, hence the +1.
  return Math.max(0, projected - budget.pauseThresholdBytes + 1);
}

// ─── Billing honesty ─────────────────────────────────────────────────────────

/**
 * Fixed explanatory text for the UI. Kept here so no screen invents its own
 * wording about billing, and so nothing ever presents a snapshot as a bill.
 */
export const BillingNote = {
  storageMetric:
    "Cloudflare measures storage as GB-month — bytes held over time, not a single reading. " +
    "Deleting a file lowers current storage immediately but does not undo usage already " +
    "accrued this month.",
  notAGuarantee:
    "These are KCxLabs safeguards. Cloudflare does not offer a configurable hard spend cap, " +
    "so KCxLabs cannot guarantee the account is never billed.",
  freeTier:
    "R2 Standard includes 10 GB of storage, 1 million Class A and 10 million Class B " +
    "operations per month, and no egress fees. KCxLabs plans against a lower self-imposed " +
    "ceiling to preserve headroom.",
} as const;

/**
 * Which R2 operation class each action consumes, for the usage screen.
 *
 * Class A (writes/mutations, 1M/month free) is the costlier class; Class B
 * (reads, 10M/month free) is cheaper. Documented so the UI can explain why a
 * multipart upload of one clip counts as several operations.
 */
export const operationClassByAction = {
  upload_single: "A",
  multipart_initiate: "A",
  multipart_upload_part: "A",
  multipart_complete: "A",
  copy: "A",
  list: "A",
  delete: "A",
  download: "B",
  head_metadata: "B",
} as const satisfies Record<string, "A" | "B">;

export type R2Action = keyof typeof operationClassByAction;

// ─── Byte accounting input ───────────────────────────────────────────────────

/** Minimum shape needed to compute the local estimate. */
export type StorageAccountingItem = {
  sizeBytes: number;
  thumbnailSizeBytes: number;
  thumbnailKey: string | null;
  originalOnline: boolean;
  status: MediaRecordStatus;
  archiveState: ArchiveState;
};
