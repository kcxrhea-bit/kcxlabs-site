import { CAMERA_SESSION_COOKIE, json, requireMethod, toNodeHandler } from "../../../_lib/http.js";

/** POST /api/camera/auth/logout — clears the Camera Archive session cookie. No auth required: a harmless no-op if already logged out. */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const cookie = [`${CAMERA_SESSION_COOKIE}=`, "Path=/api/camera", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"].join("; ");
  return json(200, { ok: true }, { "Set-Cookie": cookie });
}

export default toNodeHandler(handler);
