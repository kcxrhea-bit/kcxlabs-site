import { archiveRepository, createDb, mediaRepository } from "../../_lib/db";
import { internalError, isResponse, json, requireDevice, requireMethod } from "../../_lib/http";
import { deleteObject, headObject, r2Context } from "../../_lib/r2";
import { mayDeleteFromCloud, toRetentionInput } from "../../../src/media/retention";

/** Reconciles a guarded archival delete. `cloud_delete_pending` is recoverable after a crash. */
export default async function handler(request: Request): Promise<Response> {
  const method = requireMethod(request, "POST"); if (method) return method;
  const context = await requireDevice(request); if (isResponse(context)) return context;
  const id = new URL(request.url).pathname.split("/").at(-2) ?? "";
  try {
    const db = createDb(context.config.database); const media = mediaRepository(db); const archive = archiveRepository(db);
    let item = await media.byId(context.ownerId, id); if (!item) return json(404, { error: "not_found" });
    if (item.archiveState === "archived_offline" && !item.originalOnline) return json(200, { item, idempotent: true });
    if (!mayDeleteFromCloud(toRetentionInput(item))) return json(409, { error: "archive_not_verified" });
    if (item.archiveState === "archived_local") {
      item = await archive.transition({ id, ownerId: context.ownerId, expectedFrom: ["archived_local"], to: "cloud_delete_pending" });
      if (!item) return json(409, { error: "invalid_state" });
    }
    if (item.archiveState !== "cloud_delete_pending") return json(409, { error: "invalid_state" });
    const r2 = r2Context(context.config.r2); const head = await headObject(r2, item.storageObjectKey);
    if (head.exists) await deleteObject(r2, item.storageObjectKey);
    const offline = await archive.markOriginalOffline({ id, ownerId: context.ownerId });
    if (!offline) return json(500, { error: "reconciliation_required" });
    return json(200, { item: offline, idempotent: false });
  } catch (error) { return internalError(error, context.config); }
}
