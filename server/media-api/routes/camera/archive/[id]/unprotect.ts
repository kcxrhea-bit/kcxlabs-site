import { createDb, cameraRepository } from "../../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerSession, toNodeHandler } from "../../../../_lib/http.js";

/** POST /api/camera/archive/:id/unprotect — OWNER SESSION ONLY. See protect.ts for why device tokens are rejected here. */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const context = await requireOwnerSession(request);
  if (isResponse(context)) return context;

  const id = requestUrl(request).pathname.split("/").slice(-2)[0] ?? "";
  if (!id) return json(400, { error: "invalid_request" });

  try {
    const repo = cameraRepository(createDb(context.config.database));
    const item = await repo.setProtected({ id, ownerId: context.ownerId, protected: false });
    if (!item) return json(404, { error: "not_found" });
    return json(200, { item: { id: item.id, protected: item.protected } });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
