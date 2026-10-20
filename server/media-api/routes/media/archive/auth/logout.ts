import { json, requireMethod, MEDIA_SESSION_COOKIE, toNodeHandler } from "../../../../_lib/http.js";

/**
 * POST /api/media/archive/auth/logout — clears the Camera Archive browser
 * session cookie. No auth required to call this: clearing a cookie that was
 * never valid, or is already gone, is a harmless no-op.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const cookie = [`${MEDIA_SESSION_COOKIE}=`, "Path=/api/media", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"].join("; ");

  return json(200, { ok: true }, { "Set-Cookie": cookie });
}

export default toNodeHandler(handler);
