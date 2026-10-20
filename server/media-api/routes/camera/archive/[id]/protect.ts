import { createDb, cameraRepository } from "../../../../_lib/db.js";
import { internalError, isResponse, json, requestUrl, requireMethod, requireOwnerSession, toNodeHandler } from "../../../../_lib/http.js";

/**
 * POST /api/camera/archive/:id/protect — OWNER SESSION ONLY.
 *
 * Deliberately does NOT call `requireDevice` even as a fallback: a paired
 * desktop device token must never be able to protect/unprotect or otherwise
 * manage the archive, only upload to it. A request bearing a perfectly
 * valid device bearer token but no session cookie is rejected 401 here,
 * proving that narrower authorization boundary.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const context = await requireOwnerSession(request);
  if (isResponse(context)) return context;

  const id = requestUrl(request).pathname.split("/").slice(-2)[0] ?? "";
  if (!id) return json(400, { error: "invalid_request" });

  try {
    const repo = cameraRepository(createDb(context.config.database));
    const item = await repo.setProtected({ id, ownerId: context.ownerId, protected: true });
    if (!item) return json(404, { error: "not_found" });
    return json(200, { item: { id: item.id, protected: item.protected } });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
