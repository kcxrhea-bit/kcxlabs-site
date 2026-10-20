import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { loadAppConfig, loadCronSecret } from "../../../_lib/config.js";
import { createDb, cameraRepository } from "../../../_lib/db.js";
import { internalError, json, requestUrl, toNodeHandler } from "../../../_lib/http.js";
import { cameraObjectOperations, cameraR2Context } from "../../../_lib/r2.js";
import { cameraObjectStore, cleanupNeedsAttention, runScheduledCleanup } from "../../../_lib/camera-storage.js";

/** Constant-time comparison of the presented bearer token against CRON_SECRET (hashed first, so lengths never leak). */
function cronAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (presented === "") return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * GET|POST /api/camera/maintenance/cleanup — CRON_SECRET bearer ONLY.
 * Never accepts an owner session or a device token: it is a server-to-server
 * maintenance hook for Vercel Cron (which calls with GET).
 *
 * Expires abandoned reservations, retries interrupted deletions, re-checks
 * late uploads, and (with `?sweep=1`, or on the scheduled run by default)
 * reconciles one page of the camera bucket. Bounded, single-runner, and it
 * only ever touches `kcxlabs-camera`. Responds with counts only.
 */
async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Auth before anything else is read or touched. No secret configured → closed.
  const secret = loadCronSecret();
  if (secret === null || !cronAuthorized(request, secret)) return json(401, { error: "unauthorized" });

  const config = loadAppConfig();
  const cameraR2 = cameraR2Context(config);
  if (!cameraR2) return json(503, { error: "camera_storage_unconfigured" });

  try {
    const store = cameraObjectStore(cameraR2.bucket, cameraObjectOperations(cameraR2));
    const repo = cameraRepository(createDb(config.database));
    const sweep = requestUrl(request).searchParams.get("sweep") !== "0";
    const summary = await runScheduledCleanup(repo, store, { holder: randomUUID(), sweep });
    // Observable in Vercel logs without leaking anything: counts only, never keys or ids.
    if (cleanupNeedsAttention(summary)) console.warn(`camera cleanup needs attention: ${JSON.stringify(summary)}`);
    return json(summary.ran ? 200 : 409, summary, { "Cache-Control": "no-store" });
  } catch (error) {
    return internalError(error, config);
  }
}

export default toNodeHandler(handler);
