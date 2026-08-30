/**
 * Minimal Google Cloud Vision client: `DOCUMENT_TEXT_DETECTION` only. No
 * other Vision feature (LABEL_DETECTION, FACE_DETECTION, plain
 * TEXT_DETECTION, etc.) is ever requested — see
 * `docs/snapcal-architecture.md`'s OCR fallback section for why this is
 * scoped this tightly: it is the minimum needed for Buddy's appointment-card
 * parser, and a narrower request surface is a narrower billing/privacy
 * surface too.
 */

import type { GoogleVisionConfig } from "../../media-api/_lib/config.js";
import { getGoogleVisionAccessToken } from "./googleVisionAuth.js";

// Re-exported so tests bundled against THIS module (which inlines its own copy
// of googleVisionAuth.ts, since esbuild bundles each entrypoint independently)
// can reset the token cache this module actually uses, not a separate
// instance living in a different bundle.
export { resetGoogleVisionAuthCacheForTests } from "./googleVisionAuth.js";

const ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";

export type VisionOcrResult =
  | { ok: true; rawText: string }
  | { ok: false; kind: "credential_error" | "network" | "unauthorized" | "permission_denied" | "quota_exceeded" | "server"; message: string; status?: number };

/**
 * `imageBytes` is the raw (already-decoded) JPEG/PNG bytes — the route
 * handler is responsible for base64-decoding the request body and enforcing
 * size limits before this is ever called, so this module has no upload
 * concerns of its own.
 */
export async function recognizeDocumentText(
  config: GoogleVisionConfig,
  imageBytes: Buffer,
  fetchImpl: typeof fetch = fetch
): Promise<VisionOcrResult> {
  const auth = await getGoogleVisionAccessToken(config, fetchImpl);
  if (!auth.ok) {
    if (auth.kind === "unauthorized") {
      return { ok: false, kind: "unauthorized", message: auth.message, status: auth.status };
    }
    return { ok: false, kind: auth.kind, message: auth.message };
  }

  let response: Response;
  try {
    response = await fetchImpl(ANNOTATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
        "x-goog-user-project": config.projectId,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBytes.toString("base64") },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    });
  } catch (error) {
    return { ok: false, kind: "network", message: error instanceof Error ? error.message : "Network error reaching Cloud Vision." };
  }

  const bodyText = await response.text();
  let body: unknown = null;
  try {
    body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    return classifyHttpError(response.status, body);
  }

  // Vision batches per-request errors inside a 200 response body, one entry per `requests[]` item.
  const parsed = body as { responses?: Array<{ error?: { code?: number; message?: string }; fullTextAnnotation?: { text?: string } }> } | null;
  const first = parsed?.responses?.[0];
  if (first?.error) {
    return classifyHttpError(first.error.code ?? 500, { error: first.error });
  }

  return { ok: true, rawText: first?.fullTextAnnotation?.text ?? "" };
}

function classifyHttpError(status: number, body: unknown): VisionOcrResult {
  const envelope = body as { error?: { status?: string; message?: string } } | null;
  const message = envelope?.error?.message ?? `Cloud Vision request failed with status ${status}.`;
  const grpcStatus = envelope?.error?.status;

  if (status === 401) return { ok: false, kind: "unauthorized", message, status };
  // PERMISSION_DENIED is exactly the shape expected here: the service account
  // has no Vision role granted yet. Surfaced distinctly so this can be
  // reported back without guessing at IAM configuration.
  if (status === 403 || grpcStatus === "PERMISSION_DENIED") return { ok: false, kind: "permission_denied", message, status };
  if (status === 429 || grpcStatus === "RESOURCE_EXHAUSTED") return { ok: false, kind: "quota_exceeded", message, status };
  return { ok: false, kind: "server", message, status };
}
