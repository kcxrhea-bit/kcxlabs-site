import { signSession, verifyPassword } from "../../../../_lib/auth.js";
import { loadAppConfig } from "../../../../_lib/config.js";
import { json, readJson, requireMethod, MEDIA_SESSION_COOKIE, SINGLE_OWNER_ID, toNodeHandler } from "../../../../_lib/http.js";

/** 7 days, matching the SnapCal web session's "stay signed in on this browser" window. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * POST /api/media/archive/auth/login — browser session login for the
 * Camera Archive web viewer. Checks the same owner email/password as every
 * other owner credential check in this codebase (device pairing, SnapCal
 * login). On success it sets an HttpOnly, Secure, SameSite=Lax cookie scoped
 * to `/api/media`, carrying `signSession(ownerId, sessionSecret)`. No bearer
 * token is ever returned to this browser page — the cookie is the only
 * credential, and `requireOwnerOrDeviceForMedia()` is what accepts it on
 * every protected Camera Archive route.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return json(400, { error: "invalid_request" });
  }

  const config = loadAppConfig();
  if (email !== config.auth.ownerEmail.toLowerCase() || !(await verifyPassword(password, config.auth.ownerPasswordHash))) {
    return json(401, { error: "invalid_credentials" });
  }

  const cookieValue = signSession(SINGLE_OWNER_ID, config.auth.sessionSecret);
  const cookie = [
    `${MEDIA_SESSION_COOKIE}=${encodeURIComponent(cookieValue)}`,
    "Path=/api/media",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");

  return json(200, { ok: true }, { "Set-Cookie": cookie });
}

export default toNodeHandler(handler);
