import { signSession, verifyPassword } from "../../../media-api/_lib/auth.js";
import { loadAppConfig } from "../../../media-api/_lib/config.js";
import { json, readJson, requireMethod, SINGLE_OWNER_ID, SNAPCAL_SESSION_COOKIE, toNodeHandler } from "../../../media-api/_lib/http.js";

/** 7 days, a reasonable "stay signed in on this browser" window for the single-owner web calendar. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * POST /api/snapcal/v1/auth/login — browser session login for the SnapCal
 * web calendar. Checks the same owner email/password as `POST /api/auth/pair`
 * (device pairing), but issues nothing in the response body: on success it
 * sets an HttpOnly, Secure, SameSite=Lax cookie scoped to `/api/snapcal`
 * carrying `signSession(ownerId, sessionSecret)`. Unlike device pairing,
 * there is no bearer token for a browser to store — the cookie is the only
 * credential, and `requireOwnerOrDevice()` is what accepts it on every
 * protected SnapCal route.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return json(400, { error: { code: "INVALID_REQUEST", message: "email and password are required." } });
  }

  const config = loadAppConfig();
  if (email !== config.auth.ownerEmail.toLowerCase() || !(await verifyPassword(password, config.auth.ownerPasswordHash))) {
    return json(401, { error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." } });
  }

  const cookieValue = signSession(SINGLE_OWNER_ID, config.auth.sessionSecret);
  const cookie = [
    `${SNAPCAL_SESSION_COOKIE}=${encodeURIComponent(cookieValue)}`,
    "Path=/api/snapcal",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");

  return json(200, { ok: true }, { "Set-Cookie": cookie });
}

export default toNodeHandler(handler);
