/**
 * Pure-logic unit tests for the SnapCal event-body validator
 * (server/snapcal-api/_lib/validate.ts) — no HTTP, no database, mirroring
 * the style of tests/sql-statements.test.mjs for logic that doesn't need
 * either.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { validateNewEvent, validateEventPatch, parseExpectedRevision } from "../dist-electron/lib/snapcal-validate.cjs";

test("validateNewEvent: a well-formed minimal event is accepted", () => {
  const result = validateNewEvent({
    title: "Dentist",
    startAt: "2026-09-01T10:00:00.000Z",
    endAt: "2026-09-01T10:30:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.title, "Dentist");
  assert.equal(result.value.allDay, false);
  assert.equal(result.value.timezone, "UTC");
});

test("validateNewEvent: missing title is rejected", () => {
  const result = validateNewEvent({ startAt: "2026-09-01T10:00:00.000Z", endAt: "2026-09-01T10:30:00.000Z" });
  assert.equal(result.ok, false);
});

test("validateNewEvent: blank title is rejected", () => {
  const result = validateNewEvent({ title: "   ", startAt: "2026-09-01T10:00:00.000Z", endAt: "2026-09-01T10:30:00.000Z" });
  assert.equal(result.ok, false);
});

test("validateNewEvent: malformed startAt is rejected", () => {
  const result = validateNewEvent({ title: "X", startAt: "not-a-date", endAt: "2026-09-01T10:30:00.000Z" });
  assert.equal(result.ok, false);
});

test("validateNewEvent: endAt before startAt is rejected", () => {
  const result = validateNewEvent({
    title: "X",
    startAt: "2026-09-01T10:30:00.000Z",
    endAt: "2026-09-01T10:00:00.000Z",
  });
  assert.equal(result.ok, false);
});

test("validateNewEvent: endAt equal to startAt is accepted (zero-duration event)", () => {
  const result = validateNewEvent({
    title: "X",
    startAt: "2026-09-01T10:00:00.000Z",
    endAt: "2026-09-01T10:00:00.000Z",
  });
  assert.equal(result.ok, true);
});

test("validateNewEvent: wrong-typed optional fields are rejected, not coerced", () => {
  assert.equal(
    validateNewEvent({ title: "X", startAt: "2026-09-01T10:00:00.000Z", endAt: "2026-09-01T10:30:00.000Z", allDay: "yes" }).ok,
    false,
  );
  assert.equal(
    validateNewEvent({ title: "X", startAt: "2026-09-01T10:00:00.000Z", endAt: "2026-09-01T10:30:00.000Z", reminderOffsetMinutes: "15" }).ok,
    false,
  );
});

test("validateNewEvent: overlong title is truncated, not rejected", () => {
  const result = validateNewEvent({
    title: "x".repeat(500),
    startAt: "2026-09-01T10:00:00.000Z",
    endAt: "2026-09-01T10:30:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.title.length, 300);
});

test("validateEventPatch: empty patch is valid (no-op update)", () => {
  const result = validateEventPatch({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {});
});

test("validateEventPatch: only supplied fields are validated/returned", () => {
  const result = validateEventPatch({ title: "New title" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { title: "New title" });
});

test("validateEventPatch: partial start/end where only one is supplied is not cross-checked", () => {
  // Only startAt supplied — cannot compare against an endAt that isn't changing here.
  const result = validateEventPatch({ startAt: "2026-09-01T10:00:00.000Z" });
  assert.equal(result.ok, true);
});

test("validateEventPatch: supplying both start and end enforces end >= start", () => {
  const result = validateEventPatch({
    startAt: "2026-09-01T10:30:00.000Z",
    endAt: "2026-09-01T10:00:00.000Z",
  });
  assert.equal(result.ok, false);
});

test("validateEventPatch: description can be explicitly cleared with null", () => {
  const result = validateEventPatch({ description: null });
  assert.equal(result.ok, true);
  assert.equal(result.value.description, null);
});

test("parseExpectedRevision: accepts a finite number", () => {
  assert.equal(parseExpectedRevision({ expectedRevision: 5 }), 5);
});

test("parseExpectedRevision: rejects missing/non-numeric values", () => {
  assert.equal(parseExpectedRevision({}), null);
  assert.equal(parseExpectedRevision({ expectedRevision: "5" }), null);
  assert.equal(parseExpectedRevision({ expectedRevision: NaN }), null);
});
