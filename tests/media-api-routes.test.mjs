import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  verifyDeviceTokenRecord,
} from "../dist-electron/api-core.cjs";
import {
  evaluateStorageBudget,
  validateUploadRequest,
  verifyArchiveCopy,
  evaluateRestoreEligibility,
  isPubliclyListable,
  canTransitionArchiveState,
} from "../dist-electron/media-core.cjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const NOW = new Date("2026-08-10T12:00:00.000Z");
const HASH = "a".repeat(64);

/**
 * Every `.ts` file under `server/media-api/routes/` is a route the single
 * Vercel Function at `api/[...path].ts` dispatches to. Discovered from disk
 * rather than hardcoded so a new route file shows up in the coverage check
 * below without anyone remembering to add it to a list.
 *
 * Route implementations moved out of `api/` (see `docs/media-api-consolidation.md`)
 * so Vercel's function discovery counts only the one dispatcher file, staying
 * under the Hobby plan's 12-function limit — `api/` itself is checked
 * separately in "the api directory holds only the single dispatcher function".
 */
function discoverRouteFiles(dir = "server/media-api/routes") {
  const root = fileURLToPath(new URL(`../${dir}/`, import.meta.url));
  const routes = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) routes.push(...discoverRouteFiles(relative));
    else if (entry.name.endsWith(".ts")) routes.push(relative);
  }
  return routes;
}

const routeFiles = discoverRouteFiles();

test("every API route file is discovered (guards the coverage check below against a silently-skipped route)", () => {
  // Bumping this number is fine when a route is genuinely added or removed —
  // it exists so a route silently missing from `routeFiles` (e.g. a typo in
  // discoverRouteFiles's traversal) fails loudly instead of the coverage
  // test below just quietly checking fewer files than it should.
  assert.equal(routeFiles.length, 17);
});

test("the api directory holds only the single dispatcher function (Vercel Hobby's 12-function limit)", () => {
  const apiRoot = fileURLToPath(new URL("../api/", import.meta.url));
  const functionFiles = [];
  const walk = (dir, relative) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_")) continue; // Vercel excludes underscore-prefixed paths from function discovery.
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, entryRelative);
      else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) functionFiles.push(entryRelative);
    }
  };
  walk(apiRoot, "");
  assert.deepEqual(functionFiles, ["[...path].ts"]);
});

// Every route is wrapped in `toNodeHandler` so `vercel dev` (which never
// resolves a bare Fetch-style export locally — see the note in
// api/_lib/http.ts) can execute it. The Fetch handler itself, `handler`, is
// still the one and only place each route's logic lives — the wrapper only
// adapts how it is invoked and how its response is written back.
test("every API route is wrapped for local `vercel dev` compatibility with its real logic in one Fetch handler", () => {
  for (const path of routeFiles) {
    const route = source(path);
    assert.match(route, /async function handler\(request/, `${path}: missing a Fetch-style handler function`);
    assert.match(route, /export default toNodeHandler\(handler\);/, `${path}: default export is not toNodeHandler(handler)`);
    assert.doesNotMatch(route, /export default async function handler/, `${path}: still exports a bare Fetch handler`);
    // One adapter, reused — not a per-route reimplementation of the same wrapping logic.
    assert.match(route, /from ["'](\.\/|(\.\.\/)+)_lib\/http["']/, `${path}: toNodeHandler must come from the shared _lib/http, not a local copy`);
  }
});

test("upload authorization rejects unauthenticated requests before storage work", () => {
  const route = source("server/media-api/routes/media/upload-authorize.ts");
  assert.ok(route.indexOf("requireDevice(request)") < route.indexOf("currentStorageBudget("));
  assert.ok(route.indexOf("requireDevice(request)") < route.indexOf("presignUpload("));
});

test("revoked and expired device records fail the verifier used by endpoint auth", () => {
  const record = { id: "device", ownerId: "owner", deviceName: "desktop", expiresAt: null, revokedAt: null };
  assert.equal(verifyDeviceTokenRecord({ ...record, revokedAt: "2026-08-01T00:00:00.000Z" }, NOW).reason, "revoked");
  assert.equal(verifyDeviceTokenRecord({ ...record, expiresAt: "2026-08-09T00:00:00.000Z" }, NOW).reason, "expired");
  assert.match(source("server/media-api/_lib/http.ts"), /verifyDeviceTokenRecord/);
});

test("malformed upload requests are rejected by the route's shared validator", () => {
  assert.equal(validateUploadRequest({ filename: "", sizeBytes: 1, sha256: HASH }).ok, false);
  assert.equal(validateUploadRequest({ filename: "clip.mp4", sizeBytes: 0, sha256: HASH }).ok, false);
  assert.equal(validateUploadRequest({ filename: "clip.mp4", sizeBytes: 1, sha256: "bad" }).ok, false);
  assert.match(source("server/media-api/routes/media/upload-authorize.ts"), /validateUploadRequest/);
});

test("under-budget upload authorization is allowed", () => {
  const budget = evaluateStorageBudget({ localTrackedBytes: 1 * GB, providerMetrics: null, incomingBytes: 100 * MB, now: NOW });
  assert.equal(budget.uploadAllowed, true);
});

test("over-budget upload authorization is rejected", () => {
  const budget = evaluateStorageBudget({ localTrackedBytes: 7.95 * GB, providerMetrics: null, incomingBytes: 100 * MB, now: NOW });
  assert.equal(budget.uploadAllowed, false);
  const route = source("server/media-api/routes/media/upload-authorize.ts");
  assert.match(route, /!budget\.uploadAllowed/);
  assert.match(route, /autoUpload&&!budget\.autoUploadAllowed/);
});

test("upload authorization is one-key, short-lived, and binds size and SHA-256", () => {
  const r2 = source("server/media-api/_lib/r2.ts");
  const route = source("server/media-api/routes/media/upload-authorize.ts");
  assert.match(route, /buildStorageKey\(context\.ownerId,publicId,filename\)/);
  assert.match(route, /presignUpload[^;]+sha256/);
  assert.match(r2, /PRESIGN_TTL_SECONDS = 15 \* 60/);
  assert.match(r2, /Metadata: \{ sha256:/);
  assert.match(r2, /unhoistableHeaders: new Set\(\["x-amz-meta-sha256"\]\)/);
  assert.match(r2, /"x-amz-meta-sha256": input\.sha256\.toLowerCase\(\)/);
  assert.doesNotMatch(route, /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/);
});

test("finalize verifies R2 existence, size, and SHA-256 and is idempotent", () => {
  const route = source("server/media-api/routes/media/finalize.ts");
  assert.match(route, /item\.status==="active"&&item\.originalOnline/);
  assert.match(route, /if\(!head\.exists\)/);
  assert.match(route, /head\.sizeBytes!==item\.sizeBytes/);
  assert.match(route, /head\.sha256!==item\.sha256\.toLowerCase\(\)/);
  assert.match(route, /idempotent:true/);
});

test("archive completion rejects unverified copies and accepts matching evidence", () => {
  assert.equal(verifyArchiveCopy({ sizeBytes: 10, sha256: HASH }, { sizeBytes: 10, sha256: "b".repeat(64) }).verified, false);
  assert.equal(verifyArchiveCopy({ sizeBytes: 10, sha256: HASH }, { sizeBytes: 10, sha256: HASH }).verified, true);
  const route = source("server/media-api/routes/archive/[id]/complete.ts");
  assert.match(route, /body\?\.verified!==true/);
  assert.match(route, /item\.archiveState!=="archive_downloading"/);
  assert.match(route, /verifyArchiveCopy/);
});

test("archive verification manifest and state transition are one compare-and-set statement", () => {
  const db = source("server/media-api/_lib/db.ts");
  assert.match(db, /WITH updated AS \([\s\S]+archive_state = 'archive_downloading'/);
  assert.match(db, /INSERT INTO archive_manifest[\s\S]+FROM updated/);
  assert.match(db, /SELECT updated\.\* FROM updated[\s\S]+JOIN manifest/);
});

const archivedMedia = {
  id: "media", publicId: "PublicId12345678", sizeBytes: 200 * MB, sha256: HASH,
  archiveState: "archived_offline",
};
const manifest = {
  mediaId: "media", publicId: archivedMedia.publicId, localPath: "D:\\archive\\clip.mp4",
  sizeBytes: archivedMedia.sizeBytes, sha256: HASH, archivedAt: NOW.toISOString(), verifiedAt: NOW.toISOString(),
};
const roomyBudget = evaluateStorageBudget({ localTrackedBytes: 1 * GB, providerMetrics: null, incomingBytes: archivedMedia.sizeBytes, now: NOW });

test("restore authorization rejects a non-archived media item", () => {
  const result = evaluateRestoreEligibility({
    media: { ...archivedMedia, archiveState: "active" }, manifestEntry: manifest,
    probe: { exists: true, readable: true, sizeBytes: archivedMedia.sizeBytes, sha256: HASH }, budget: roomyBudget,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not_archived");
});

test("restore authorization rejects an over-budget restore", () => {
  const tight = evaluateStorageBudget({ localTrackedBytes: 7.95 * GB, providerMetrics: null, incomingBytes: archivedMedia.sizeBytes, now: NOW });
  const result = evaluateRestoreEligibility({
    media: archivedMedia, manifestEntry: manifest,
    probe: { exists: true, readable: true, sizeBytes: archivedMedia.sizeBytes, sha256: HASH }, budget: tight,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "storage_budget");
  assert.match(source("server/media-api/routes/media/[id]/restore-authorize.ts"), /currentStorageBudget/);
});

test("restore finalize preserves publicId and verifies size and SHA-256", () => {
  const route = source("server/media-api/routes/media/[id]/restore-finalize.ts");
  assert.match(route, /media\.publicId/);
  assert.match(route, /head\.sizeBytes!==media\.sizeBytes/);
  assert.match(route, /head\.sha256!==media\.sha256\.toLowerCase\(\)/);
  assert.match(route, /markRestored/);
  assert.doesNotMatch(route, /generatePublicId/);
});

test("invalid archive and restore state shortcuts remain rejected", () => {
  assert.equal(canTransitionArchiveState("active", "archived_offline"), false);
  assert.equal(canTransitionArchiveState("archived_offline", "active"), false);
  assert.equal(canTransitionArchiveState("archived_offline", "restoring"), true);
  assert.equal(canTransitionArchiveState("restoring", "active"), true);
});

test("GET PATCH and DELETE media operations remain owner-authenticated and bounded", () => {
  const route = source("server/media-api/routes/media/[id].ts");
  assert.ok(route.indexOf("requireDevice(request)") < route.indexOf('request.method==="GET"'));
  assert.match(route, /request\.method==="GET"/);
  assert.match(route, /request\.method!=="PATCH"/);
  assert.match(route, /request\.method==="DELETE"/);
  assert.match(route, /Object\.keys\(body\)\.some\(k=>!mutable\.has\(k\)\)/);
  assert.match(route, /repo\.softDelete\(context\.ownerId,id\)/);
  assert.doesNotMatch(route, /deleteObject|mayDeleteFromCloud/);
});

test("public enumeration includes PUBLIC and excludes UNLISTED and PRIVATE", () => {
  assert.equal(isPubliclyListable("public"), true);
  assert.equal(isPubliclyListable("unlisted"), false);
  assert.equal(isPubliclyListable("private"), false);
  assert.match(source("server/media-api/_lib/db.ts"), /WHERE visibility = 'public' AND status = 'active'/);
  assert.match(source("server/media-api/routes/clips.ts"), /listPublic/);
});

test("archive download authorization is owner-authenticated, state-bound, and narrow", () => {
  const route = source("server/media-api/routes/archive/[id]/download-authorize.ts");
  assert.match(route, /requireDevice\(request\)/);
  assert.match(route, /archiveState !== "archive_downloading"/);
  assert.match(route, /!item\.originalOnline/);
  assert.match(route, /presignDownload/);
  assert.doesNotMatch(route, /R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID/);
});

test("cloud removal keeps mayDeleteFromCloud authoritative and has a recoverable pending state", () => {
  const route = source("server/media-api/routes/archive/[id]/remove-cloud-original.ts");
  assert.match(route, /mayDeleteFromCloud\(toRetentionInput\(item\)\)/);
  assert.match(route, /archived_local/);
  assert.match(route, /cloud_delete_pending/);
  assert.match(route, /deleteObject/);
  assert.match(route, /markOriginalOffline/);
  assert.match(route, /archived_offline[\s\S]*idempotent: true/);
});

test("public share lookup permits PUBLIC and UNLISTED but hides PRIVATE and offline originals", () => {
  const route = source("server/media-api/routes/media/public/[publicId].ts");
  assert.match(route, /item\.visibility === "private"/);
  assert.match(route, /item\.originalOnline \? await presignDownload/);
  assert.match(route, /deliveryUrl = .*: null/);
  assert.match(route, /toPublicMediaItem/);
  assert.doesNotMatch(route, /storageObjectKey.*json|ownerId.*json/);
});
