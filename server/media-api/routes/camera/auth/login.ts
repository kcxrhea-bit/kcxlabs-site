import { signSession, verifyPassword } from "../../../_lib/auth.js";
import { loadAppConfig } from "../../../_lib/config.js";
import { CAMERA_SESSION_COOKIE, json, readJson, requireMethod, SINGLE_OWNER_ID, toNodeHandler } from "../../../_lib/http.js";

/** 7 days, matching the SnapCal web session's "stay signed in" window. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * POST /api/camera/auth/login — browser session login for the Camera
 * Archive page. Checks the same owner email/password as device pairing and
 * SnapCal login. Issues an HttpOnly/Secure/SameSite=Lax cookie scoped
 * `Path=/api/camera`, distinct from both the SnapCal and generic Media
 * Center cookies — logging out of one never affects the others.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return json(400, { error: "invalid_request" });

  const config = loadAppConfig();
  if (email !== config.auth.ownerEmail.toLowerCase() || !(await verifyPassword(password, config.auth.ownerPasswordHash))) {
    return json(401, { error: "invalid_credentials" });
  }

  const cookieValue = signSession(SINGLE_OWNER_ID, config.auth.sessionSecret);
  const cookie = [
    `${CAMERA_SESSION_COOKIE}=${encodeURIComponent(cookieValue)}`,
    "Path=/api/camera",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");

  return json(200, { ok: true }, { "Set-Cookie": cookie });
}

export default toNodeHandler(handler);
