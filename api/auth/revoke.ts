import { authRepository, createDb } from "../_lib/db";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod } from "../_lib/http";

export default async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const context = await requireDevice(request);
  if (isResponse(context)) return context;
  const body = await readJson(request);
  const deviceTokenId = typeof body?.deviceTokenId === "string" ? body.deviceTokenId : "";
  if (!deviceTokenId) return json(400, { error: "invalid_request" });
  try {
    const revoked = await authRepository(createDb(context.config.database)).revokeDeviceToken(context.ownerId, deviceTokenId);
    return revoked ? json(200, { revoked: true }) : json(404, { error: "not_found" });
  } catch (error) {
    return internalError(error, context.config);
  }
}
