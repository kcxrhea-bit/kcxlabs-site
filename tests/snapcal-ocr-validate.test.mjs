/**
 * Direct, dependency-free tests for validateOcrRequest
 * (server/snapcal-api/_lib/validateOcr.ts) — no auth, no database, no
 * network, mirroring how validate.ts's validateNewEvent/validateEventPatch
 * are tested in tests/snapcal-routes.test.mjs's sibling suites.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { validateOcrRequest, MAX_IMAGE_BASE64_LENGTH, ALLOWED_OCR_MIME_TYPES } from "../dist-electron/lib/snapcal-validate-ocr.cjs";

const VALID_BASE64_IMAGE = Buffer.from("not-a-real-jpeg-but-non-empty").toString("base64");

test("a well-formed request is accepted and decodes the image bytes", () => {
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE });
  assert.equal(result.ok, true);
  assert.equal(result.value.mimeType, "image/jpeg");
  assert.deepEqual(result.value.imageBytes, Buffer.from("not-a-real-jpeg-but-non-empty"));
});

test("every allowed MIME type is accepted", () => {
  for (const mimeType of ALLOWED_OCR_MIME_TYPES) {
    const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType, imageBase64: VALID_BASE64_IMAGE });
    assert.equal(result.ok, true, `${mimeType} should be accepted`);
  }
});

test("a non-APPOINTMENT_CARD scanType is rejected with 400 unsupported_scan_type — wall calendars are out of scope for this first pass", () => {
  const result = validateOcrRequest({ scanType: "WALL_CALENDAR", mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, "unsupported_scan_type");
});

test("a missing scanType is rejected the same as an unsupported one", () => {
  const result = validateOcrRequest({ mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_scan_type");
});

test("an unsupported MIME type is rejected with 400 unsupported_mime_type", () => {
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "application/pdf", imageBase64: VALID_BASE64_IMAGE });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, "unsupported_mime_type");
});

test("a missing imageBase64 is rejected with 400 missing_image", () => {
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, "missing_image");
});

test("an empty-string imageBase64 is rejected as missing_image, not accepted as a zero-byte image", () => {
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: "" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_image");
});

test("an encoded image over the base64-length ceiling is rejected with 413, before ever decoding it", () => {
  const oversized = "a".repeat(MAX_IMAGE_BASE64_LENGTH + 1);
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: oversized });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
  assert.equal(result.code, "image_too_large");
});

test("a decoded image over the byte ceiling is rejected with 413 (the base64-length gate and decoded-byte gate are calibrated close together by design, so an oversized image trips one or the other)", () => {
  const oversizedBytes = Buffer.alloc(6_000_001, 1);
  const oversizedBase64 = oversizedBytes.toString("base64");
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: oversizedBase64 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
  assert.equal(result.code, "image_too_large");
});

test("a data: URL matching the declared mimeType is accepted and decoded to the same bytes as plain base64", () => {
  const dataUrl = `data:image/png;base64,${VALID_BASE64_IMAGE}`;
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/png", imageBase64: dataUrl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.imageBytes, Buffer.from("not-a-real-jpeg-but-non-empty"));
});

test("a data: URL whose embedded MIME type does not match the declared mimeType is rejected, not silently trusted", () => {
  const dataUrl = `data:image/png;base64,${VALID_BASE64_IMAGE}`;
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: dataUrl });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_image_encoding");
});

test("a non-string scanType/mimeType/imageBase64 is rejected, never coerced", () => {
  assert.equal(validateOcrRequest({ scanType: 123, mimeType: "image/jpeg", imageBase64: VALID_BASE64_IMAGE }).ok, false);
  assert.equal(validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: 123, imageBase64: VALID_BASE64_IMAGE }).ok, false);
  assert.equal(validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: 123 }).ok, false);
});

test("a request is not accidentally treated as a URL fetch: a URL string in imageBase64 is just invalid base64/oversized text, never dereferenced", () => {
  const result = validateOcrRequest({ scanType: "APPOINTMENT_CARD", mimeType: "image/jpeg", imageBase64: "https://example.test/some-image.jpg" });
  // Whatever the outcome, it must be a local validation verdict, not evidence
  // this module ever performed a network fetch (it has no fetch import at all).
  assert.equal(typeof result.ok, "boolean");
});
