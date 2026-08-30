/**
 * Request-body validation for POST /api/snapcal/v1/ocr/appointment.
 * Pure, dependency-free, and testable without auth or a database — mirrors
 * this directory's existing `validate.ts` convention. The route calls this
 * only after `requireDevice()` has already authenticated the caller.
 */

/** Base64 grows input ~4/3; this keeps decoded image bytes under ~6MB, comfortably inside Vercel's request-body ceiling. */
export const MAX_IMAGE_BASE64_LENGTH = 8_000_000;
export const MAX_IMAGE_BYTES = 6_000_000;

export const ALLOWED_OCR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type OcrRequestInput = {
  scanType: string;
  mimeType: string;
  imageBase64: string;
};

export type OcrValidationResult =
  | { ok: true; value: { mimeType: string; imageBytes: Buffer } }
  | { ok: false; status: number; code: string; message: string };

function decodeDataUrlOrPlainBase64(imageBase64: string, mimeType: string): Buffer | null {
  const dataUrlPrefix = `data:${mimeType};base64,`;
  const payload = imageBase64.startsWith("data:") ? imageBase64.slice(imageBase64.indexOf(",") + 1) : imageBase64;
  if (imageBase64.startsWith("data:") && !imageBase64.startsWith(dataUrlPrefix)) return null;

  try {
    const decoded = Buffer.from(payload, "base64");
    if (decoded.length === 0) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Fails closed: anything unrecognized, oversized, or malformed is rejected, never coerced into a best guess. */
export function validateOcrRequest(body: Record<string, unknown>): OcrValidationResult {
  const scanType = typeof body.scanType === "string" ? body.scanType : null;
  if (scanType !== "APPOINTMENT_CARD") {
    return { ok: false, status: 400, code: "unsupported_scan_type", message: "This endpoint currently supports only APPOINTMENT_CARD scans." };
  }

  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
  if (mimeType === null || !ALLOWED_OCR_MIME_TYPES.has(mimeType)) {
    return { ok: false, status: 400, code: "unsupported_mime_type", message: "mimeType must be one of image/jpeg, image/png, image/webp." };
  }

  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : null;
  if (imageBase64 === null || imageBase64.length === 0) {
    return { ok: false, status: 400, code: "missing_image", message: "imageBase64 is required." };
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    return { ok: false, status: 413, code: "image_too_large", message: "Encoded image exceeds the maximum allowed size." };
  }

  const imageBytes = decodeDataUrlOrPlainBase64(imageBase64, mimeType);
  if (imageBytes === null) {
    return { ok: false, status: 400, code: "invalid_image_encoding", message: "imageBase64 could not be decoded." };
  }
  if (imageBytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, status: 413, code: "image_too_large", message: "Decoded image exceeds the maximum allowed size." };
  }

  return { ok: true, value: { mimeType, imageBytes } };
}
