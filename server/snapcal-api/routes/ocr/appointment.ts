/**
 * POST /api/snapcal/v1/ocr/appointment — Cloud Vision `DOCUMENT_TEXT_DETECTION`
 * fallback for a photographed appointment card, used only when Buddy's
 * on-device ML Kit OCR could not extract the required fields (handwriting is
 * ML Kit's known weak spot; Cloud Vision's document model is materially
 * better at it — see docs/snapcal-architecture.md's OCR fallback section).
 *
 * Scope, deliberately narrow for this first implementation:
 * - appointment-card images only (not wall calendars, not arbitrary photos)
 * - device-token auth only, via the same `requireDevice()` every other
 *   SnapCal route uses — there is no separate abuse-protection layer in this
 *   codebase to plug into, so reusing the per-device auth gate is the
 *   available protection for this first pass
 * - image bytes arrive as a bounded base64 JSON field, never a URL — this
 *   route fetches nothing on the caller's behalf
 * - only `DOCUMENT_TEXT_DETECTION` is ever requested of Vision
 *
 * Request validation (`validateOcrRequest`) is a separate, dependency-free
 * module so it is unit-testable without auth or a live database — this
 * handler's own job is only: authenticate, validate, call Vision, respond.
 */

import { loadGoogleVisionConfig } from "../../../media-api/_lib/config.js";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod, toNodeHandler } from "../../../media-api/_lib/http.js";
import { recognizeDocumentText } from "../../_lib/googleVision.js";
import { validateOcrRequest } from "../../_lib/validateOcr.js";

async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;

  const context = await requireDevice(request);
  if (isResponse(context)) return context;

  const visionConfig = loadGoogleVisionConfig();
  if (visionConfig === null) {
    return json(503, { error: { code: "ocr_unavailable", message: "Cloud OCR is not configured on this server." } });
  }

  const body = await readJson(request);
  if (body === null) return json(400, { error: { code: "invalid_request", message: "Request body must be JSON." } });

  const validation = validateOcrRequest(body);
  if (!validation.ok) {
    return json(validation.status, { error: { code: validation.code, message: validation.message } });
  }

  try {
    const result = await recognizeDocumentText(visionConfig, validation.value.imageBytes);
    if (!result.ok) {
      // Names the failure kind without ever including credential material —
      // `permission_denied` is exactly the "no Vision role granted yet" case.
      // 502: this server made an outbound call to Vision and Vision itself
      // rejected/failed it, distinct from a 400 (this request was malformed).
      return json(502, {
        error: {
          code: `google_vision_${result.kind}`,
          message: result.message,
        },
      });
    }

    return json(200, {
      engine: "google-cloud-vision",
      rawText: result.rawText,
    });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
