import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateStorageBudget,
  normalizeThresholds,
  bytesToFree,
  onlineBytesFor,
  totalOnlineBytes,
  operationClassByAction,
  storageMetricsSourceLabel,
  BillingNote,
  R2_FREE_TIER_BYTES,
  DEFAULT_WARNING_THRESHOLD_BYTES,
  DEFAULT_PAUSE_THRESHOLD_BYTES,
  DEFAULT_DEGRADED_THRESHOLD_BYTES,
  defaultMediaSettings,
} from "../dist-electron/media-core.cjs";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const NOW = new Date("2026-08-10T12:00:00.000Z");

const metrics = (bytes, minutesAgo = 1) => ({
  storedBytes: bytes,
  objectCount: 10,
  pendingUploadCount: 0,
  measuredAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
});

const budget = (overrides = {}) =>
  evaluateStorageBudget({
    localTrackedBytes: 0,
    providerMetrics: null,
    now: NOW,
    ...overrides,
  });

// ─── Thresholds (requirements 2 and 3) ───────────────────────────────────────

test("the free tier is 10 GB but is never used as the planning limit", () => {
  assert.equal(R2_FREE_TIER_BYTES, 10 * GB);
  assert.ok(DEFAULT_PAUSE_THRESHOLD_BYTES < R2_FREE_TIER_BYTES);
});

test("the warning threshold defaults to 7 GB", () => {
  assert.equal(DEFAULT_WARNING_THRESHOLD_BYTES, 7 * GB);
  assert.equal(defaultMediaSettings.storageWarningBytes, 7 * GB);
});

test("the safety ceiling defaults to 8 GB, preserving 2 GB of headroom", () => {
  assert.equal(DEFAULT_PAUSE_THRESHOLD_BYTES, 8 * GB);
  assert.equal(defaultMediaSettings.storagePauseBytes, 8 * GB);
  assert.equal(R2_FREE_TIER_BYTES - DEFAULT_PAUSE_THRESHOLD_BYTES, 2 * GB);
});

test("thresholds are configurable but unsafe orderings are refused", () => {
  // A ceiling above the free allowance is clamped down to it.
  assert.equal(normalizeThresholds({ pauseBytes: 50 * GB }).pauseBytes, R2_FREE_TIER_BYTES);
  // A warning at or above the ceiling would never fire; it is pulled below.
  assert.ok(normalizeThresholds({ warningBytes: 9 * GB, pauseBytes: 8 * GB }).warningBytes < 8 * GB);
  // Garbage falls back to the safe defaults.
  assert.deepEqual(normalizeThresholds({ pauseBytes: Number.NaN, warningBytes: -1 }), {
    warningBytes: DEFAULT_WARNING_THRESHOLD_BYTES,
    pauseBytes: DEFAULT_PAUSE_THRESHOLD_BYTES,
    degradedBytes: DEFAULT_DEGRADED_THRESHOLD_BYTES,
    freeTierBytes: R2_FREE_TIER_BYTES,
    staleAfterMs: 60 * 60 * 1000,
  });
  // A legitimate custom pair is honoured.
  const custom = normalizeThresholds({ warningBytes: 3 * GB, pauseBytes: 4 * GB });
  assert.equal(custom.warningBytes, 3 * GB);
  assert.equal(custom.pauseBytes, 4 * GB);
});

// ─── Status bands (requirements 5, 6, 7) ─────────────────────────────────────

test("usage below the warning threshold is normal and uploads are allowed", () => {
  const result = budget({ localTrackedBytes: 4 * GB, providerMetrics: metrics(4 * GB) });
  assert.equal(result.status, "normal");
  assert.equal(result.uploadAllowed, true);
  assert.equal(result.headroomBytes, 4 * GB);
});

test("usage in the 7-8 GB band recommends archiving but still allows uploads", () => {
  const result = budget({ localTrackedBytes: 7.2 * GB, providerMetrics: metrics(7.2 * GB) });
  assert.equal(result.status, "archive_recommended");
  assert.equal(result.uploadAllowed, true);
  assert.match(result.reason, /Archiving older clips/);
});

test("usage at or past the safety ceiling pauses uploads", () => {
  const result = budget({ localTrackedBytes: 8 * GB, providerMetrics: metrics(8 * GB) });
  assert.equal(result.status, "uploads_paused");
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.headroomBytes, 0);
});

// ─── Incoming file size (requirements 4 and 6) ───────────────────────────────

test("the incoming file size is included in the decision, not just current usage", () => {
  // The exact scenario from the brief: 7.9 GB used, 400 MB clip incoming.
  const result = budget({
    localTrackedBytes: 7.9 * GB,
    providerMetrics: metrics(7.9 * GB),
    incomingBytes: 400 * MB,
  });
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.status, "uploads_paused");
  assert.equal(result.projectedBytes, 7.9 * GB + 400 * MB);
  assert.match(result.reason, /would bring storage to/);

  // Without the incoming file, the same usage is merely a warning.
  const idle = budget({ localTrackedBytes: 7.9 * GB, providerMetrics: metrics(7.9 * GB) });
  assert.equal(idle.uploadAllowed, true);
  assert.equal(idle.status, "archive_recommended");
});

test("a small file that still fits is allowed at the same usage level", () => {
  const result = budget({
    localTrackedBytes: 7.5 * GB,
    providerMetrics: metrics(7.5 * GB),
    incomingBytes: 100 * MB,
  });
  assert.equal(result.uploadAllowed, true);
});

test("a file that lands exactly on the ceiling is refused", () => {
  const result = budget({
    localTrackedBytes: 7 * GB,
    providerMetrics: metrics(7 * GB),
    incomingBytes: 1 * GB,
  });
  assert.equal(result.projectedBytes, 8 * GB);
  assert.equal(result.uploadAllowed, false);
});

test("bytesToFree reports how much archiving is needed to fit an upload", () => {
  const current = budget({ localTrackedBytes: 7.9 * GB, providerMetrics: metrics(7.9 * GB) });
  assert.ok(bytesToFree(current, 400 * MB) > 0);
  assert.equal(bytesToFree(current, 10 * MB), 0);
});

// ─── Metrics provenance (requirements 20 and 21) ─────────────────────────────

test("with no provider metrics the result is labelled a local estimate, never official", () => {
  const result = budget({ localTrackedBytes: 6.2 * GB, providerMetrics: null });
  assert.equal(result.status, "metrics_unavailable");
  assert.equal(result.source, "local_estimate");
  assert.equal(result.providerReportedBytes, null);
  assert.equal(result.lastProviderMetricsAt, null);
  assert.match(result.reason, /unavailable/);
  // The label must not imply Cloudflare measured this.
  assert.match(storageMetricsSourceLabel[result.source], /not an official Cloudflare measurement/);
  assert.doesNotMatch(result.reason, /Measured by Cloudflare/);
});

test("metrics unavailable does not block uploads, it only changes the labelling", () => {
  const result = budget({ localTrackedBytes: 1 * GB, providerMetrics: null });
  assert.equal(result.uploadAllowed, true);
});

test("metrics unavailable still pauses uploads when the local estimate is over the ceiling", () => {
  // Losing Cloudflare visibility must never become a way to exceed the ceiling.
  const result = budget({ localTrackedBytes: 8.5 * GB, providerMetrics: null });
  assert.equal(result.status, "uploads_paused");
  assert.equal(result.uploadAllowed, false);
});

test("provider metrics older than the staleness window are identified as stale", () => {
  const result = budget({
    localTrackedBytes: 3 * GB,
    providerMetrics: metrics(3 * GB, 120), // two hours old
  });
  assert.equal(result.metricsStale, true);
  assert.equal(result.status, "metrics_stale");
  assert.equal(result.source, "cloudflare_api_stale");
  assert.match(storageMetricsSourceLabel[result.source], /out of date/);
});

test("fresh provider metrics are attributed to Cloudflare", () => {
  const result = budget({ localTrackedBytes: 2 * GB, providerMetrics: metrics(3 * GB) });
  assert.equal(result.source, "cloudflare_api");
  assert.equal(result.metricsStale, false);
  assert.equal(storageMetricsSourceLabel[result.source], "Measured by Cloudflare");
});

test("a malformed provider timestamp is treated as stale rather than as current", () => {
  const result = budget({
    localTrackedBytes: 1 * GB,
    providerMetrics: { ...metrics(1 * GB), measuredAt: "not-a-date" },
  });
  assert.equal(result.metricsStale, true);
});

// ─── Degraded mode: stale or unavailable provider metrics ────────────────────

test("the degraded auto-upload ceiling defaults to 6 GB, below the normal 8 GB", () => {
  assert.equal(DEFAULT_DEGRADED_THRESHOLD_BYTES, 6 * GB);
  assert.equal(defaultMediaSettings.storageDegradedBytes, 6 * GB);
  assert.ok(DEFAULT_DEGRADED_THRESHOLD_BYTES < DEFAULT_PAUSE_THRESHOLD_BYTES);
});

test("stale metrics with projected local usage below 6 GB permits automatic upload", () => {
  const result = budget({
    localTrackedBytes: 4 * GB,
    providerMetrics: metrics(4 * GB, 120),
    incomingBytes: 500 * MB,
  });
  assert.equal(result.degradedMode, true);
  assert.equal(result.status, "metrics_stale");
  assert.equal(result.autoUploadAllowed, true);
  assert.equal(result.autoUploadPausedReason, null);
  // Manual uploads proceed, but never silently.
  assert.notEqual(result.manualUploadWarning, null);
  assert.match(result.manualUploadWarning, /out of date/);
});

test("stale metrics with projected local usage at or past 6 GB pauses automatic upload", () => {
  const result = budget({
    localTrackedBytes: 5.8 * GB,
    providerMetrics: metrics(5.8 * GB, 120),
    incomingBytes: 400 * MB,
  });
  assert.equal(result.projectedLocalBytes, 5.8 * GB + 400 * MB);
  assert.equal(result.autoUploadAllowed, false);
  assert.match(result.autoUploadPausedReason, /Automatic uploads paused/);
  assert.match(result.autoUploadPausedReason, /out of date/);
  // The hard ceiling has not been reached, so manual upload remains possible.
  assert.equal(result.uploadAllowed, true);
  assert.match(result.manualUploadWarning, /cannot confirm the real total/);
});

test("landing exactly on the 6 GB degraded ceiling pauses automatic upload", () => {
  const result = budget({
    localTrackedBytes: 5.5 * GB,
    providerMetrics: metrics(5.5 * GB, 120),
    incomingBytes: 0.5 * GB,
  });
  assert.equal(result.projectedLocalBytes, 6 * GB);
  assert.equal(result.autoUploadAllowed, false);
});

test("unavailable metrics uses the same conservative 6 GB rule", () => {
  const below = budget({ localTrackedBytes: 5 * GB, providerMetrics: null, incomingBytes: 200 * MB });
  assert.equal(below.status, "metrics_unavailable");
  assert.equal(below.autoUploadAllowed, true);

  const at = budget({ localTrackedBytes: 5.9 * GB, providerMetrics: null, incomingBytes: 200 * MB });
  assert.equal(at.status, "metrics_unavailable");
  assert.equal(at.autoUploadAllowed, false);
  assert.match(at.autoUploadPausedReason, /unavailable/);
  assert.match(at.autoUploadPausedReason, /You can still upload manually/);
});

test("the degraded rule is measured against local usage, not the provider figure", () => {
  // Local is small; a stale provider reading is larger. Automatic uploads keep
  // running because the degraded ceiling tracks what WE know we uploaded.
  const result = budget({
    localTrackedBytes: 2 * GB,
    providerMetrics: metrics(6.5 * GB, 120),
    incomingBytes: 100 * MB,
  });
  assert.equal(result.autoUploadAllowed, true);
  // The larger provider figure still drives the headline number and banding.
  assert.equal(result.currentOnlineBytes, 6.5 * GB);
});

test("fresh metrics restore the normal 7 GB / 8 GB thresholds", () => {
  // 6.5 GB projected would pause automatic uploads in degraded mode; with a
  // fresh measurement it is simply normal operation.
  const fresh = budget({
    localTrackedBytes: 6.5 * GB,
    providerMetrics: metrics(6.5 * GB),
    incomingBytes: 100 * MB,
  });
  assert.equal(fresh.degradedMode, false);
  assert.equal(fresh.status, "normal");
  assert.equal(fresh.autoUploadAllowed, true);
  assert.equal(fresh.autoUploadPausedReason, null);
  // No warning is needed when the figures are corroborated.
  assert.equal(fresh.manualUploadWarning, null);

  // The 7 GB warning band still behaves exactly as before.
  const warning = budget({ localTrackedBytes: 7.5 * GB, providerMetrics: metrics(7.5 * GB) });
  assert.equal(warning.status, "archive_recommended");
  assert.equal(warning.autoUploadAllowed, true);

  // The 8 GB ceiling still behaves exactly as before.
  const paused = budget({ localTrackedBytes: 8 * GB, providerMetrics: metrics(8 * GB) });
  assert.equal(paused.status, "uploads_paused");
  assert.equal(paused.uploadAllowed, false);
  assert.equal(paused.autoUploadAllowed, false);
});

test("higher provider usage still wins over lower local usage in degraded mode", () => {
  // Stale, but the provider saw far more than we track: the hard ceiling is
  // evaluated on the larger figure, so everything pauses.
  const result = budget({
    localTrackedBytes: 1 * GB,
    providerMetrics: metrics(8.5 * GB, 300),
    incomingBytes: 50 * MB,
  });
  assert.equal(result.currentOnlineBytes, 8.5 * GB);
  assert.equal(result.status, "uploads_paused");
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.autoUploadAllowed, false);
});

test("automatic uploads are never more permissive than manual uploads", () => {
  const cases = [
    { localTrackedBytes: 0, providerMetrics: null },
    { localTrackedBytes: 6.5 * GB, providerMetrics: null },
    { localTrackedBytes: 3 * GB, providerMetrics: metrics(3 * GB, 500) },
    { localTrackedBytes: 7.5 * GB, providerMetrics: metrics(7.5 * GB) },
    { localTrackedBytes: 9 * GB, providerMetrics: metrics(9 * GB) },
  ];
  for (const input of cases) {
    const result = budget({ ...input, incomingBytes: 300 * MB });
    assert.ok(
      !result.autoUploadAllowed || result.uploadAllowed,
      `auto was more permissive than manual at ${result.localTrackedBytes}`,
    );
  }
});

test("a degraded ceiling configured above the hard ceiling is clamped down", () => {
  // Degraded mode must never be more permissive than normal operation.
  assert.equal(normalizeThresholds({ degradedBytes: 50 * GB }).degradedBytes, DEFAULT_PAUSE_THRESHOLD_BYTES);
  assert.equal(normalizeThresholds({ degradedBytes: Number.NaN }).degradedBytes, DEFAULT_DEGRADED_THRESHOLD_BYTES);
  assert.equal(normalizeThresholds({ degradedBytes: 3 * GB }).degradedBytes, 3 * GB);
});

// ─── Conservative measurement ────────────────────────────────────────────────

test("the larger of the local and provider measurements is used", () => {
  // Provider is behind: our own record of what we uploaded wins.
  const localHigher = budget({ localTrackedBytes: 7 * GB, providerMetrics: metrics(5 * GB) });
  assert.equal(localHigher.currentOnlineBytes, 7 * GB);
  assert.equal(localHigher.source, "local_estimate");

  // Provider sees objects we do not know about (orphaned parts): trust it.
  const providerHigher = budget({ localTrackedBytes: 5 * GB, providerMetrics: metrics(7 * GB) });
  assert.equal(providerHigher.currentOnlineBytes, 7 * GB);
  assert.equal(providerHigher.source, "cloudflare_api");
});

test("an untracked orphaned object can push the bucket into paused on its own", () => {
  // Local thinks 2 GB; Cloudflare sees 8.2 GB of real bytes. Pause.
  const result = budget({ localTrackedBytes: 2 * GB, providerMetrics: metrics(8.2 * GB) });
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.currentOnlineBytes, 8.2 * GB);
});

// ─── Byte accounting ─────────────────────────────────────────────────────────

const record = (overrides = {}) => ({
  sizeBytes: 100 * MB,
  thumbnailSizeBytes: 50 * 1024,
  thumbnailKey: "thumbs/o/x/poster.jpg",
  originalOnline: true,
  status: "active",
  archiveState: "active",
  ...overrides,
});

test("an online item costs its original plus its thumbnail", () => {
  assert.equal(onlineBytesFor(record()), 100 * MB + 50 * 1024);
});

test("an archived item costs only its thumbnail, which is what frees space", () => {
  const archived = record({ originalOnline: false, archiveState: "archived_offline" });
  assert.equal(onlineBytesFor(archived), 50 * 1024);
  assert.ok(onlineBytesFor(archived) < onlineBytesFor(record()) / 100);
});

test("pending and deleted records contribute nothing to the estimate", () => {
  assert.equal(onlineBytesFor(record({ status: "pending" })), 0);
  assert.equal(onlineBytesFor(record({ status: "deleted" })), 0);
});

test("an item with no thumbnail counts only its original", () => {
  assert.equal(onlineBytesFor(record({ thumbnailKey: null })), 100 * MB);
});

test("the local estimate is the sum across active records", () => {
  const total = totalOnlineBytes([
    record(),
    record({ originalOnline: false }),
    record({ status: "deleted" }),
  ]);
  assert.equal(total, 100 * MB + 50 * 1024 + 50 * 1024);
});

// ─── Billing honesty ─────────────────────────────────────────────────────────

test("billing notes distinguish stored bytes from GB-month and claim no hard cap", () => {
  assert.match(BillingNote.storageMetric, /GB-month/);
  assert.match(BillingNote.storageMetric, /does not undo usage already/);
  assert.match(BillingNote.notAGuarantee, /cannot guarantee/);
});

test("operation classes are documented for the actions that consume them", () => {
  assert.equal(operationClassByAction.upload_single, "A");
  assert.equal(operationClassByAction.multipart_upload_part, "A");
  assert.equal(operationClassByAction.multipart_complete, "A");
  assert.equal(operationClassByAction.delete, "A");
  assert.equal(operationClassByAction.list, "A");
  assert.equal(operationClassByAction.download, "B");
  assert.equal(operationClassByAction.head_metadata, "B");
});
