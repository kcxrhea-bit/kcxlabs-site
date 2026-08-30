import { json, requireMethod, toNodeHandler } from "../../media-api/_lib/http.js";
import { SNAPCAL_API_VERSION } from "../_lib/version.js";

/** Public, privacy-safe liveness/version check — no auth required, matches KsnapCalx's own local /api/v1/health contract. */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;

  return json(200, {
    ok: true,
    service: "SnapCal",
    apiVersion: SNAPCAL_API_VERSION,
    status: "ready",
  });
}

export default toNodeHandler(handler);
