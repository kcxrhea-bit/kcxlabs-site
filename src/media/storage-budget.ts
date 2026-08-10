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
 */

import type { ArchiveState, MediaRecordStatus } from "./types";

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

/** Provider metrics older than this are treated as stale and not trusted alone. */
export const DEFAULT_METRICS_STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

export type StorageThresholds = {
  warningBytes: number;
  pauseBytes: number;
  freeTierBytes: number;
  staleAfterMs: number;
};

export const defaultStorageThresholds: StorageThresholds = {
  warningBytes: DEFAULT_WARNING_THRESHOLD_BYTES,
  pauseBytes: DEFAULT_PAUSE_THRESHOLD_BYTES,
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

  const staleAfterMs =
    Number.isFinite(input.staleAfterMs) && (input.staleAfterMs as number) > 0
      ? (input.staleAfterMs as number)
      : DEFAULT_METRICS_STALE_AFTER_MS;

  return { warningBytes, pauseBytes, freeTierBytes, staleAfterMs };
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
  freeTierBytes: number;

  /** Bytes remaining below the safety ceiling. Never negative. */
  headroomBytes: number;
  /** currentOnlineBytes + incomingBytes. What the check is actually against. */
  projectedBytes: number;

  status: StorageStatus;
  uploadAllowed: boolean;
  /** Plain-English explanation, suitable for showing directly to the user. */
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

  return {
    currentOnlineBytes,
    localTrackedBytes,
    providerReportedBytes,
    source,
    lastProviderMetricsAt,
    metricsStale,
    warningThresholdBytes: thresholds.warningBytes,
    pauseThresholdBytes: thresholds.pauseBytes,
    freeTierBytes: thresholds.freeTierBytes,
    headroomBytes,
    projectedBytes,
    status,
    uploadAllowed,
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
