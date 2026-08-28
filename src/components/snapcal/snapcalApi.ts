/**
 * Typed client for the SnapCal API (`/api/snapcal/v1/*`), matching the exact
 * contract in `docs/snapcal-architecture.md` and `server/snapcal-api/_lib/types.ts`.
 *
 * Types are duplicated here rather than imported from `server/` on purpose:
 * `src/` and `server/` are separate TypeScript project references
 * (`tsconfig.app.json` only includes `src`), and this module never imports
 * anything from `server/` at runtime either — the browser bundle must never
 * pull in Node-only code.
 *
 * Every request is same-origin (`kcxlabs.org` calling its own `/api/...`) and
 * sent with `credentials: "include"` so the `snapcal_session` cookie set by
 * `POST /api/snapcal/v1/auth/login` is attached automatically. No CORS
 * configuration is needed or used here.
 */

const BASE = "/api/snapcal/v1";

export type SnapCalCalendar = {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SnapCalEvent = {
  id: string;
  calendarId: string;
  ownerId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  categoryId: string | null;
  reminderOffsetMinutes: number | null;
  recurrenceFrequency: string | null;
  recurrenceInterval: number | null;
  recurrenceUntilDate: string | null;
  recurrenceOccurrenceCount: number | null;
  clientMutationId: string | null;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Fields the create/edit form collects. `clientMutationId` is generated once per create action. */
export type EventDraft = {
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  categoryId: string | null;
  reminderOffsetMinutes: number | null;
  recurrenceFrequency: string | null;
  recurrenceInterval: number | null;
  recurrenceUntilDate: string | null;
  recurrenceOccurrenceCount: number | null;
};

export type ApiErrorShape = { code: string; message: string } | string;

export class SnapCalApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, shape: ApiErrorShape | undefined) {
    const message = typeof shape === "string" ? shape : (shape?.message ?? `Request failed (${status})`);
    super(message);
    this.name = "SnapCalApiError";
    this.status = status;
    this.code = typeof shape === "string" ? shape : (shape?.code ?? null);
  }
}

/** Thrown specifically for a 409 REVISION_CONFLICT so callers can offer "reload" vs. "discard" without string-matching an error message. */
export class SnapCalConflictError extends SnapCalApiError {
  readonly current: SnapCalEvent;

  constructor(current: SnapCalEvent) {
    super(409, { code: "REVISION_CONFLICT", message: "This event changed elsewhere." });
    this.name = "SnapCalConflictError";
    this.current = current;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const parsed = body as { error?: ApiErrorShape; current?: SnapCalEvent } | null;
    if (response.status === 409 && parsed?.current) {
      throw new SnapCalConflictError(parsed.current);
    }
    throw new SnapCalApiError(response.status, parsed?.error);
  }

  return body as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export function login(email: string, password: string): Promise<{ ok: true }> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function logout(): Promise<{ ok: true }> {
  return request("/auth/logout", { method: "POST" });
}

// ─── Calendars ───────────────────────────────────────────────────────────────

export async function getCalendars(): Promise<SnapCalCalendar[]> {
  const { calendars } = await request<{ calendars: SnapCalCalendar[] }>("/calendars", { method: "GET" });
  return calendars;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export async function getEvents(calendarId: string): Promise<SnapCalEvent[]> {
  const { events } = await request<{ events: SnapCalEvent[] }>(
    `/events?calendarId=${encodeURIComponent(calendarId)}`,
    { method: "GET" },
  );
  return events;
}

export function createEvent(calendarId: string, draft: EventDraft, clientMutationId: string): Promise<{ event: SnapCalEvent; duplicate: boolean }> {
  return request("/events", {
    method: "POST",
    body: JSON.stringify({ calendarId, ...draft, clientMutationId }),
  });
}

export async function updateEvent(
  id: string,
  calendarId: string,
  expectedRevision: number,
  patch: Partial<EventDraft>,
): Promise<SnapCalEvent> {
  const { event } = await request<{ event: SnapCalEvent }>(`/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ calendarId, expectedRevision, ...patch }),
  });
  return event;
}

export async function deleteEvent(id: string, calendarId: string, expectedRevision: number): Promise<SnapCalEvent> {
  const { event } = await request<{ event: SnapCalEvent }>(`/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ calendarId, expectedRevision }),
  });
  return event;
}

/** A short random id, generated once per create action, for the idempotent-write contract. */
export function generateClientMutationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
