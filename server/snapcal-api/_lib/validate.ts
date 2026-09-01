/** Request-body validation for SnapCal event mutations. Fails closed: anything unrecognized or malformed is rejected, never coerced into a best guess. */
import { SNAPCAL_EVENT_STATUSES, type NewSnapCalEventInput, type SnapCalEventStatus, type UpdateSnapCalEventInput } from "./types.js";

const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 4000;
const MAX_LOCATION_LENGTH = 500;
const MAX_MUTATION_ID_LENGTH = 100;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function optionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined; // signals invalid via a separate check by the caller
  return value.slice(0, maxLength);
}

function eventStatus(value: unknown): SnapCalEventStatus | null {
  return typeof value === "string" && SNAPCAL_EVENT_STATUSES.includes(value as SnapCalEventStatus)
    ? (value as SnapCalEventStatus)
    : null;
}

/** Validates a full new-event payload. All required fields must be present and well-formed. */
export function validateNewEvent(body: Record<string, unknown>): ValidationResult<NewSnapCalEventInput> {
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return { ok: false, error: "title is required" };
  }
  if (!isIsoTimestamp(body.startAt)) return { ok: false, error: "startAt must be an ISO timestamp" };
  if (!isIsoTimestamp(body.endAt)) return { ok: false, error: "endAt must be an ISO timestamp" };
  if (Date.parse(body.endAt as string) < Date.parse(body.startAt as string)) {
    return { ok: false, error: "endAt must not be before startAt" };
  }
  if (body.allDay !== undefined && typeof body.allDay !== "boolean") {
    return { ok: false, error: "allDay must be a boolean" };
  }
  if (body.timezone !== undefined && typeof body.timezone !== "string") {
    return { ok: false, error: "timezone must be a string" };
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
    return { ok: false, error: "description must be a string or null" };
  }
  if (body.location !== undefined && body.location !== null && typeof body.location !== "string") {
    return { ok: false, error: "location must be a string or null" };
  }
  if (body.categoryId !== undefined && body.categoryId !== null && typeof body.categoryId !== "string") {
    return { ok: false, error: "categoryId must be a string or null" };
  }
  if (
    body.reminderOffsetMinutes !== undefined &&
    body.reminderOffsetMinutes !== null &&
    typeof body.reminderOffsetMinutes !== "number"
  ) {
    return { ok: false, error: "reminderOffsetMinutes must be a number or null" };
  }
  if (
    body.clientMutationId !== undefined &&
    body.clientMutationId !== null &&
    (typeof body.clientMutationId !== "string" || body.clientMutationId.length > MAX_MUTATION_ID_LENGTH)
  ) {
    return { ok: false, error: "clientMutationId must be a short string" };
  }
  if (body.status !== undefined && eventStatus(body.status) === null) {
    return { ok: false, error: "status must be a supported event status" };
  }

  return {
    ok: true,
    value: {
      title: body.title.trim().slice(0, MAX_TITLE_LENGTH),
      status: eventStatus(body.status) ?? "SCHEDULED",
      description: (optionalString(body.description, MAX_TEXT_LENGTH) ?? null) as string | null,
      location: (optionalString(body.location, MAX_LOCATION_LENGTH) ?? null) as string | null,
      startAt: new Date(body.startAt as string).toISOString(),
      endAt: new Date(body.endAt as string).toISOString(),
      allDay: body.allDay === true,
      timezone: typeof body.timezone === "string" && body.timezone.length > 0 ? body.timezone.slice(0, 100) : "UTC",
      categoryId: (body.categoryId as string | null | undefined) ?? null,
      reminderOffsetMinutes: (body.reminderOffsetMinutes as number | null | undefined) ?? null,
      recurrenceFrequency: typeof body.recurrenceFrequency === "string" ? body.recurrenceFrequency.slice(0, 40) : null,
      recurrenceInterval: typeof body.recurrenceInterval === "number" ? body.recurrenceInterval : null,
      recurrenceUntilDate: typeof body.recurrenceUntilDate === "string" ? body.recurrenceUntilDate.slice(0, 40) : null,
      recurrenceOccurrenceCount:
        typeof body.recurrenceOccurrenceCount === "number" ? body.recurrenceOccurrenceCount : null,
      clientMutationId: typeof body.clientMutationId === "string" ? body.clientMutationId : null,
    },
  };
}

/** Validates a partial update payload — every field optional, but any field present must be well-formed. */
export function validateEventPatch(body: Record<string, unknown>): ValidationResult<UpdateSnapCalEventInput> {
  const value: UpdateSnapCalEventInput = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return { ok: false, error: "title must be a non-empty string" };
    }
    value.title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
  }
  if (body.status !== undefined) {
    const status = eventStatus(body.status);
    if (status === null) return { ok: false, error: "status must be a supported event status" };
    value.status = status;
  }
  if (body.startAt !== undefined) {
    if (!isIsoTimestamp(body.startAt)) return { ok: false, error: "startAt must be an ISO timestamp" };
    value.startAt = new Date(body.startAt).toISOString();
  }
  if (body.endAt !== undefined) {
    if (!isIsoTimestamp(body.endAt)) return { ok: false, error: "endAt must be an ISO timestamp" };
    value.endAt = new Date(body.endAt).toISOString();
  }
  if (value.startAt !== undefined && value.endAt !== undefined && Date.parse(value.endAt) < Date.parse(value.startAt)) {
    return { ok: false, error: "endAt must not be before startAt" };
  }
  if (body.allDay !== undefined) {
    if (typeof body.allDay !== "boolean") return { ok: false, error: "allDay must be a boolean" };
    value.allDay = body.allDay;
  }
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || body.timezone.length === 0) return { ok: false, error: "timezone must be a non-empty string" };
    value.timezone = body.timezone.slice(0, 100);
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") return { ok: false, error: "description must be a string or null" };
    value.description = body.description === null ? null : body.description.slice(0, MAX_TEXT_LENGTH);
  }
  if (body.location !== undefined) {
    if (body.location !== null && typeof body.location !== "string") return { ok: false, error: "location must be a string or null" };
    value.location = body.location === null ? null : body.location.slice(0, MAX_LOCATION_LENGTH);
  }
  if (body.categoryId !== undefined) {
    if (body.categoryId !== null && typeof body.categoryId !== "string") return { ok: false, error: "categoryId must be a string or null" };
    value.categoryId = body.categoryId;
  }
  if (body.reminderOffsetMinutes !== undefined) {
    if (body.reminderOffsetMinutes !== null && typeof body.reminderOffsetMinutes !== "number") {
      return { ok: false, error: "reminderOffsetMinutes must be a number or null" };
    }
    value.reminderOffsetMinutes = body.reminderOffsetMinutes;
  }

  return { ok: true, value };
}

/** A request body's `expectedRevision` is required for update/delete — optimistic concurrency has no default. */
export function parseExpectedRevision(body: Record<string, unknown>): number | null {
  return typeof body.expectedRevision === "number" && Number.isFinite(body.expectedRevision)
    ? body.expectedRevision
    : null;
}
