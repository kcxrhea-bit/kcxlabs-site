import { deviceTokenExpiry, hashDeviceToken, verifyPassword } from "../../_lib/auth.js";
import { generateDeviceToken, generateDeviceTokenId } from "../../_lib/ids.js";
import { authRepository, createDb } from "../../_lib/db.js";
import { loadAppConfig } from "../../_lib/config.js";
import { internalError, json, readJson, requireMethod, toNodeHandler } from "../../_lib/http.js";

async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim().slice(0, 120) : "";
  if (!email || !password || !deviceName) return json(400, { error: "invalid_request" });

  const config = loadAppConfig();
  if (email !== config.auth.ownerEmail.toLowerCase() || !(await verifyPassword(password, config.auth.ownerPasswordHash))) {
    return json(401, { error: "invalid_credentials" });
  }

  try {
    const auth = authRepository(createDb(config.database));
    const ownerId = "owner_kcx";
    await auth.ensureOwner({ id: ownerId, email: config.auth.ownerEmail, passwordHash: config.auth.ownerPasswordHash });
    const token = generateDeviceToken();
    const deviceTokenId = generateDeviceTokenId();
    const expiresAt = deviceTokenExpiry(new Date());
    await auth.createDeviceToken({ id: deviceTokenId, ownerId, tokenHash: hashDeviceToken(token), deviceName, expiresAt });
    return json(201, { token, deviceTokenId, expiresAt });
  } catch (error) {
    return internalError(error, config);
  }
}

export default toNodeHandler(handler);
