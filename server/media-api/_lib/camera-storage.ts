/**
 * Crash-recoverable deletion workflow for the Camera Archive bucket.
 *
 * Dependency-free on purpose (types only from db/r2), so the node:test suites
 * drive this exact orchestration against an in-memory repository and a mocked
 * object store. The SQL it relies on lives in `cameraRepository` (db.ts).
 *
 * The lifecycle of a row that leaves the archive:
 *
 *   active (unprotected) ──rotation──┐
 *   reserved (TTL expired) ──expiry──┴─> pending_delete ──R2 delete ok──> deleted
 *                                            ▲      │
 *                                            └──────┘ R2 or DB failure: row stays
 *                                                     pending_delete, retried later
 *
 * Invariants:
 *  - Metadata (key + size) is never dropped before the R2 delete is confirmed:
 *    a row only becomes `deleted` after `deleteObject` resolved.
 *  - `pending_delete` bytes still count against the budget for reservations
 *    (the object still occupies the bucket), so storage can never be
 *    double-counted as free while its delete is unconfirmed.
 *  - Protected rows never enter the workflow (enforced in SQL and by a CHECK
 *    constraint, see migration 006).
 *  - Only keys under `camera/` in the dedicated camera bucket are ever deleted.
 */
import { ConfigError, CAMERA_R2_BUCKET } from "./config.js";

/** A reservation whose upload URL was last issued this long ago is abandoned. Presigned URLs live 15 minutes, so this leaves a wide margin for a slow PUT that started just before expiry. */
export const RESERVATION_TTL_MINUTES = 60;
/** Upper bound on deletions attempted per request, so housekeeping can't stall an upload authorization. */
export const DELETE_BATCH_LIMIT = 10;
/** After this many attempts a row stays `pending_delete` (still counted in the budget) for manual review instead of being retried forever. */
export const MAX_DELETE_ATTEMPTS = 8;

const CAMERA_KEY_PATTERN = /^camera\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/;

export type DeletionCandidate = { id: string; storageObjectKey: string; sizeBytes: number };

/**
 * A late-upload check runs this long after an expired reservation was
 * deleted. Its upload URL stopped accepting new PUTs 15 minutes after it was
 * issued, and expiry needs 60 minutes of silence, so any PUT that could still
 * land has had hours to finish — an object found now is a confirmed orphan.
 */
export const LATE_UPLOAD_GRACE_MINUTES = 6 * 60;
/** The bucket sweep only deletes untracked objects at least this old, so it can never race an upload in progress. */
export const ORPHAN_SWEEP_MIN_AGE_HOURS = 24;
/** Keys listed per sweep page; the cursor persists between runs, so a full pass is spread over many runs. */
export const ORPHAN_SWEEP_PAGE_SIZE = 100;
/** Bounded scheduled run: at most this many reconcile passes (DELETE_BATCH_LIMIT rows each). */
export const CLEANUP_MAX_PASSES = 5;
/**
 * Wall-clock budget for one scheduled run. No new pass, check, or sweep page
 * starts after it, so a run always ends far inside both Vercel's function
 * limit and the lock lease below — the lease can't expire under a live run.
 */
export const CLEANUP_TIME_BUDGET_MS = 45_000;
/** A crashed cleanup run's lock is reclaimable after this long (>> CLEANUP_TIME_BUDGET_MS + one in-flight batch). */
export const CLEANUP_LOCK_TTL_SECONDS = 10 * 60;

const CAMERA_KEY_PREFIX = "camera/";

export type ListedObject = { key: string; lastModified: string | null };

export type CameraObjectStore = {
  readonly bucket: string;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  listObjects(input: { prefix: string; cursor: string | null; limit: number }): Promise<{ objects: ListedObject[]; nextCursor: string | null }>;
};

export type CameraObjectOperations = Omit<CameraObjectStore, "bucket">;

/** The subset of `cameraRepository` this workflow needs. */
export type CameraDeletionRepo = {
  claimForRotation(input: { incomingBytes: number; budgetBytes: number }): Promise<DeletionCandidate[]>;
  claimStaleReservations(input: { ttlMinutes: number; limit: number }): Promise<DeletionCandidate[]>;
  leasePendingDeletions(input: { limit: number; maxAttempts: number }): Promise<DeletionCandidate[]>;
  confirmDeleted(id: string): Promise<boolean>;
  recordDeleteFailure(id: string, code: string): Promise<void>;
};

/** Additional repository surface used only by the scheduled cleanup. */
export type CameraMaintenanceRepo = CameraDeletionRepo & {
  leaseLateUploadChecks(input: { graceMinutes: number; limit: number; maxAttempts: number }): Promise<DeletionCandidate[]>;
  markLateUploadChecked(id: string): Promise<void>;
  /** Of the given keys, those still referenced by a non-deleted row. */
  liveObjectKeys(keys: string[]): Promise<Set<string>>;
  tryAcquireCleanupLock(input: { holder: string; ttlSeconds: number }): Promise<boolean>;
  releaseCleanupLock(holder: string): Promise<void>;
  /** Persist the last run's counts (no keys or ids) so the owner budget view can show cleanup health. */
  recordCleanupRun(summary: string): Promise<void>;
  readSweepCursor(): Promise<string | null>;
  writeSweepCursor(cursor: string | null): Promise<void>;
};

export type DeletionOutcome = {
  deletedIds: string[];
  freedBytes: number;
  /** R2 delete failed (or the key was refused); row left pending for retry. */
  failedIds: string[];
  /** R2 delete succeeded but the DB confirmation failed; row left pending, retry re-deletes idempotently. */
  unconfirmedIds: string[];
};

export function isCameraObjectKey(key: string): boolean {
  return CAMERA_KEY_PATTERN.test(key) && !key.includes("..");
}

/** Wrap raw object operations, refusing to run against anything but the dedicated camera bucket. */
export function cameraObjectStore(bucket: string, operations: CameraObjectOperations): CameraObjectStore {
  if (bucket !== CAMERA_R2_BUCKET) throw new ConfigError([], [`CAMERA_R2_BUCKET (must be ${CAMERA_R2_BUCKET})`]);
  return { bucket, ...operations };
}

/** Error class names only — never a message, which SDKs sometimes fill with request details. */
function failureCode(error: unknown): string {
  const name = (error as { name?: unknown })?.name;
  return typeof name === "string" && /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : "delete_failed";
}

function emptyOutcome(): DeletionOutcome {
  return { deletedIds: [], freedBytes: 0, failedIds: [], unconfirmedIds: [] };
}

function merge(a: DeletionOutcome, b: DeletionOutcome): DeletionOutcome {
  return {
    deletedIds: [...a.deletedIds, ...b.deletedIds],
    freedBytes: a.freedBytes + b.freedBytes,
    failedIds: [...a.failedIds, ...b.failedIds],
    unconfirmedIds: [...a.unconfirmedIds, ...b.unconfirmedIds],
  };
}

/** Delete each claimed object, then confirm it in the database. Never throws for a per-row failure. */
export async function deleteClaimedObjects(
  repo: CameraDeletionRepo,
  store: CameraObjectStore,
  candidates: DeletionCandidate[],
): Promise<DeletionOutcome> {
  const outcome = emptyOutcome();
  for (const candidate of candidates) {
    if (!isCameraObjectKey(candidate.storageObjectKey)) {
      await repo.recordDeleteFailure(candidate.id, "invalid_key").catch(() => undefined);
      outcome.failedIds.push(candidate.id);
      continue;
    }
    try {
      await store.deleteObject(candidate.storageObjectKey);
    } catch (error) {
      await repo.recordDeleteFailure(candidate.id, failureCode(error)).catch(() => undefined);
      outcome.failedIds.push(candidate.id);
      continue;
    }
    try {
      if (await repo.confirmDeleted(candidate.id)) {
        outcome.deletedIds.push(candidate.id);
        outcome.freedBytes += candidate.sizeBytes;
      }
    } catch {
      outcome.unconfirmedIds.push(candidate.id);
    }
  }
  return outcome;
}

/**
 * Bounded housekeeping, safe to run on every upload authorization: expire
 * abandoned reservations, then retry deletions a previous request left
 * unfinished (crash, R2 outage, DB failure after the R2 delete).
 */
export async function reconcileCameraStorage(repo: CameraDeletionRepo, store: CameraObjectStore): Promise<DeletionOutcome> {
  const expired = await repo.claimStaleReservations({ ttlMinutes: RESERVATION_TTL_MINUTES, limit: DELETE_BATCH_LIMIT });
  const expiredOutcome = await deleteClaimedObjects(repo, store, expired);
  const retries = await repo.leasePendingDeletions({ limit: DELETE_BATCH_LIMIT, maxAttempts: MAX_DELETE_ATTEMPTS });
  return merge(expiredOutcome, await deleteClaimedObjects(repo, store, retries));
}

/** Free room for an incoming clip: claim the oldest unprotected recordings (live budget computed in SQL), then delete them. */
export async function rotateForSpace(
  repo: CameraDeletionRepo,
  store: CameraObjectStore,
  input: { incomingBytes: number; budgetBytes: number },
): Promise<DeletionOutcome> {
  const claimed = await repo.claimForRotation(input);
  return deleteClaimedObjects(repo, store, claimed);
}

// ─── Late uploads and orphan reconciliation ─────────────────────────────────

export type LateUploadOutcome = { checked: number; orphansDeleted: number; failed: number };

/**
 * Targeted late-upload reconciliation. An expired reservation's PUT might
 * still land after its row was deleted. Once the grace period has passed,
 * HEAD each such key exactly where we know it lives (no bucket listing) and
 * delete it if present. Keys embed the unique recording id, so a deleted
 * row's key is never reused by a live row — re-checked anyway before deleting.
 */
export async function checkLateUploads(repo: CameraMaintenanceRepo, store: CameraObjectStore): Promise<LateUploadOutcome> {
  const outcome: LateUploadOutcome = { checked: 0, orphansDeleted: 0, failed: 0 };
  const candidates = await repo.leaseLateUploadChecks({
    graceMinutes: LATE_UPLOAD_GRACE_MINUTES,
    limit: DELETE_BATCH_LIMIT,
    maxAttempts: MAX_DELETE_ATTEMPTS,
  });
  if (candidates.length === 0) return outcome;
  const live = await repo.liveObjectKeys(candidates.map((c) => c.storageObjectKey));
  for (const candidate of candidates) {
    try {
      if (isCameraObjectKey(candidate.storageObjectKey) && !live.has(candidate.storageObjectKey)) {
        if (await store.objectExists(candidate.storageObjectKey)) {
          await store.deleteObject(candidate.storageObjectKey);
          outcome.orphansDeleted += 1;
        }
      }
      await repo.markLateUploadChecked(candidate.id);
      outcome.checked += 1;
    } catch {
      outcome.failed += 1; // lease attempt already counted; retried on a later run
    }
  }
  return outcome;
}

export type SweepOutcome = { listed: number; orphansDeleted: number; completedPass: boolean };

/**
 * Bounded bucket reconciliation for anything the targeted check can't know
 * about (e.g. a crash between PUT and reservation bookkeeping). One page per
 * call, cursor persisted, so a full pass is spread across runs and never
 * happens on the upload path. Deletes only objects that are under `camera/`,
 * not referenced by any non-deleted row, AND older than 24 h — an in-progress
 * upload always has a live `reserved` row, and is never that old.
 */
export async function sweepOrphanObjects(
  repo: CameraMaintenanceRepo,
  store: CameraObjectStore,
  now: Date = new Date(),
): Promise<SweepOutcome> {
  const cursor = await repo.readSweepCursor();
  const page = await store.listObjects({ prefix: CAMERA_KEY_PREFIX, cursor, limit: ORPHAN_SWEEP_PAGE_SIZE });
  const keys = page.objects.map((o) => o.key).filter(isCameraObjectKey);
  const live = keys.length === 0 ? new Set<string>() : await repo.liveObjectKeys(keys);
  const cutoff = now.getTime() - ORPHAN_SWEEP_MIN_AGE_HOURS * 3_600_000;

  let orphansDeleted = 0;
  for (const object of page.objects) {
    if (!isCameraObjectKey(object.key) || live.has(object.key)) continue;
    const modified = object.lastModified === null ? NaN : Date.parse(object.lastModified);
    if (!Number.isFinite(modified) || modified > cutoff) continue; // unknown or recent age: leave it
    await store.deleteObject(object.key);
    orphansDeleted += 1;
  }
  // Only advance once the page was fully handled, so a failure re-sweeps the same page next run.
  await repo.writeSweepCursor(page.nextCursor);
  return { listed: page.objects.length, orphansDeleted, completedPass: page.nextCursor === null };
}

export type CleanupSummary =
  | { ran: false; reason: "already_running" }
  | {
      ran: true;
      deleted: number;
      freedBytes: number;
      failed: number;
      unconfirmed: number;
      lateUploads: LateUploadOutcome | null;
      sweep: SweepOutcome | null;
      /** True when the time budget stopped the run early; the remainder is picked up next run. */
      truncated: boolean;
    };

/**
 * The scheduled run: a single holder at a time (DB lease), bounded passes of
 * expiry + retry, then the targeted late-upload check and one sweep page.
 * Returns counts only — never keys, ids, or credentials.
 */
export async function runScheduledCleanup(
  repo: CameraMaintenanceRepo,
  store: CameraObjectStore,
  input: { holder: string; sweep: boolean; now?: Date; timeBudgetMs?: number; clock?: () => number },
): Promise<CleanupSummary> {
  const clock = input.clock ?? Date.now;
  const deadline = clock() + (input.timeBudgetMs ?? CLEANUP_TIME_BUDGET_MS);
  const timeLeft = () => clock() < deadline;

  if (!(await repo.tryAcquireCleanupLock({ holder: input.holder, ttlSeconds: CLEANUP_LOCK_TTL_SECONDS }))) {
    return { ran: false, reason: "already_running" };
  }
  try {
    let total = emptyOutcome();
    let truncated = false;
    for (let pass = 0; pass < CLEANUP_MAX_PASSES; pass++) {
      if (!timeLeft()) { truncated = true; break; }
      const outcome = await reconcileCameraStorage(repo, store);
      total = merge(total, outcome);
      const progressed = outcome.deletedIds.length + outcome.failedIds.length + outcome.unconfirmedIds.length;
      if (progressed < DELETE_BATCH_LIMIT) break; // queue drained (or only backed-off rows remain)
    }
    let lateUploads: LateUploadOutcome | null = null;
    if (timeLeft()) lateUploads = await checkLateUploads(repo, store);
    else truncated = true;
    let sweep: SweepOutcome | null = null;
    if (input.sweep) {
      if (timeLeft()) sweep = await sweepOrphanObjects(repo, store, input.now);
      else truncated = true;
    }
    const summary: CleanupSummary = {
      ran: true,
      deleted: total.deletedIds.length,
      freedBytes: total.freedBytes,
      failed: total.failedIds.length,
      unconfirmed: total.unconfirmedIds.length,
      lateUploads,
      sweep,
      truncated,
    };
    await repo.recordCleanupRun(JSON.stringify({ at: new Date(clock()).toISOString(), ...summary })).catch(() => undefined);
    return summary;
  } finally {
    await repo.releaseCleanupLock(input.holder).catch(() => undefined);
  }
}

/** True when a run left work that needs attention — surfaced in logs (counts only). */
export function cleanupNeedsAttention(summary: CleanupSummary): boolean {
  return summary.ran && (summary.failed > 0 || summary.unconfirmed > 0 || (summary.lateUploads?.failed ?? 0) > 0);
}
