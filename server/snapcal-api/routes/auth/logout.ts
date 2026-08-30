import { json, requireMethod, SNAPCAL_SESSION_COOKIE, toNodeHandler } from "../../../media-api/_lib/http.js";

/**
 * POST /api/snapcal/v1/auth/logout — clears the SnapCal browser session
 * cookie. No auth required to call this: clearing a cookie that was never
 * valid, or is already gone, is a harmless no-op, matching the "duplicate
 * delete is a non-destructive success" pattern used elsewhere in this API.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const cookie = [`${SNAPCAL_SESSION_COOKIE}=`, "Path=/api/snapcal", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"].join("; ");

  return json(200, { ok: true }, { "Set-Cookie": cookie });
}

export default toNodeHandler(handler);
