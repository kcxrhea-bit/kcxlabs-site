/** Server-only HTTP primitives shared by every Media API handler. */
import { bearerToken, hashDeviceToken, verifyDeviceTokenRecord } from "./auth";
import { authRepository, createDb } from "./db";
import { loadAppConfig, redactSecrets, type AppConfig } from "./config";

export type ApiContext = { config: AppConfig; ownerId: string };

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function requireMethod(request: Request, method: string): Response | null {
  return request.method === method ? null : json(405, { error: "method_not_allowed" }, { Allow: method });
}

export async function requireDevice(request: Request): Promise<ApiContext | Response> {
  const config = loadAppConfig();
  const token = bearerToken(request.headers.get("authorization"));
  if (token === null) return json(401, { error: "unauthorized" });

  const auth = authRepository(createDb(config.database));
  const verified = verifyDeviceTokenRecord(await auth.deviceTokenByHash(hashDeviceToken(token)), new Date());
  if (!verified.valid) return json(401, { error: "unauthorized" });
  await auth.touchDeviceToken(verified.record.id);
  return { config, ownerId: verified.record.ownerId };
}

export function isResponse(value: ApiContext | Response): value is Response {
  return value instanceof Response;
}

/** Keep provider errors useful without ever reflecting a configured credential. */
export function internalError(error: unknown, config: AppConfig): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactSecrets(message));
  return json(500, { error: "internal_error" });
}
