/**
 * SnapCal Neon (Postgres) access layer.
 *
 * Reuses the same `Db`/`createDb` connection primitive as the Media API
 * (`server/media-api/_lib/db.ts`) — there is exactly one way this codebase
 * talks to Neon. All SnapCal SQL lives here; route handlers never write SQL
 * themselves. See `db/migrations/002_snapcal_init.sql` for the schema and
 * sync-design rationale this layer implements.
 */

import { createDb, type Db } from "../../media-api/_lib/db.js";
import type { NewSnapCalEventInput, SnapCalCalendar, SnapCalEvent, UpdateSnapCalEventInput } from "./types.js";

export { createDb, type Db };

type Row = Record<string, unknown>;

const asString = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
/** Postgres BIGINT arrives as a string; Number() would silently lose precision above 2^53, but revisions realistically never get that large. */
const asRevision = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const asDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? "");
const asNullableDate = (value: unknown): string | null =>
  value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);

function mapCalendarRow(row: Row): SnapCalCalendar {
  return {
    id: asString(row.id),
    ownerId: asString(row.owner_id),
    name: asString(row.name),
    color: asString(row.color),
    revision: asRevision(row.revision),
    deletedAt: asNullableDate(row.deleted_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function mapEventRow(row: Row): SnapCalEvent {
  return {
    id: asString(row.id),
    calendarId: asString(row.calendar_id),
    ownerId: asString(row.owner_id),
    title: asString(row.title),
    status: asString(row.status) as SnapCalEvent["status"],
    description: asNullableString(row.description),
    location: asNullableString(row.location),
    startAt: asDate(row.start_at),
    endAt: asDate(row.end_at),
    allDay: row.all_day === true,
    timezone: asString(row.timezone),
    categoryId: asNullableString(row.category_id),
    reminderOffsetMinutes: asNullableNumber(row.reminder_offset_minutes),
    recurrenceFrequency: asNullableString(row.recurrence_frequency),
    recurrenceInterval: asNullableNumber(row.recurrence_interval),
    recurrenceUntilDate: asNullableString(row.recurrence_until_date),
    recurrenceOccurrenceCount: asNullableNumber(row.recurrence_occurrence_count),
    clientMutationId: asNullableString(row.client_mutation_id),
    revision: asRevision(row.revision),
    deletedAt: asNullableDate(row.deleted_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

// ─── Calendar repository ─────────────────────────────────────────────────────

export function calendarRepository(db: Db) {
  return {
    async listForOwner(ownerId: string): Promise<SnapCalCalendar[]> {
      const rows = await db`
        SELECT * FROM snapcal_calendars
        WHERE owner_id = ${ownerId} AND deleted_at IS NULL
        ORDER BY created_at ASC
      `;
      return rows.map(mapCalendarRow);
    },

    async getById(ownerId: string, id: string): Promise<SnapCalCalendar | null> {
      const rows = await db`
        SELECT * FROM snapcal_calendars WHERE id = ${id} AND owner_id = ${ownerId} AND deleted_at IS NULL
      `;
      return rows.length === 0 ? null : mapCalendarRow(rows[0]);
    },

    /**
     * Get-or-create the owner's default calendar. Idempotent: safe to call on
     * every request that needs a calendar to exist, mirroring KsnapCalx
     * desktop's own "seed a default calendar on first launch" behavior.
     */
    async ensureDefault(input: { id: string; ownerId: string; name: string; color: string }): Promise<SnapCalCalendar> {
      const existing = await db`
        SELECT * FROM snapcal_calendars WHERE owner_id = ${input.ownerId} AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1
      `;
      if (existing.length > 0) return mapCalendarRow(existing[0]);

      const rows = await db`
        INSERT INTO snapcal_calendars (id, owner_id, name, color, revision)
        VALUES (${input.id}, ${input.ownerId}, ${input.name}, ${input.color}, nextval('snapcal_revision_seq'))
        RETURNING *
      `;
      return mapCalendarRow(rows[0]);
    },
  };
}

// ─── Event repository ────────────────────────────────────────────────────────

export type EventMutationResult =
  | { status: "ok"; event: SnapCalEvent }
  | { status: "not_found" }
  | { status: "conflict"; current: SnapCalEvent };

export function eventRepository(db: Db) {
  return {
    async listForCalendar(ownerId: string, calendarId: string, limit = 500): Promise<SnapCalEvent[]> {
      const rows = await db`
        SELECT * FROM snapcal_events
        WHERE owner_id = ${ownerId} AND calendar_id = ${calendarId} AND deleted_at IS NULL
        ORDER BY start_at ASC
        LIMIT ${Math.min(limit, 2000)}
      `;
      return rows.map(mapEventRow);
    },

    async getById(ownerId: string, calendarId: string, id: string): Promise<SnapCalEvent | null> {
      const rows = await db`
        SELECT * FROM snapcal_events
        WHERE id = ${id} AND owner_id = ${ownerId} AND calendar_id = ${calendarId} AND deleted_at IS NULL
      `;
      return rows.length === 0 ? null : mapEventRow(rows[0]);
    },

    /**
     * Incremental pull: every row (including tombstones) with a revision
     * greater than the client's cursor. This is the ONLY sync query — clients
     * never re-download the whole calendar. Ordered by revision so a client
     * that stops partway through a large batch can resume with
     * `sinceRevision = lastSeenRevision` safely.
     */
    async changesSince(ownerId: string, calendarId: string, sinceRevision: number, limit = 500): Promise<SnapCalEvent[]> {
      const rows = await db`
        SELECT * FROM snapcal_events
        WHERE owner_id = ${ownerId} AND calendar_id = ${calendarId} AND revision > ${sinceRevision}
        ORDER BY revision ASC
        LIMIT ${Math.min(limit, 2000)}
      `;
      return rows.map(mapEventRow);
    },

    /**
     * Idempotent create: retrying the same `clientMutationId` against the
     * same calendar returns the already-created event instead of inserting a
     * duplicate. `duplicate: true` tells the caller this was a retry, not a
     * new event — mirrors the desktop's exact-image-hash duplicate signal.
     */
    async create(input: { id: string; ownerId: string; calendarId: string } & NewSnapCalEventInput): Promise<{ event: SnapCalEvent; duplicate: boolean }> {
      const rows = await db`
        INSERT INTO snapcal_events (
          id, calendar_id, owner_id, title, status, description, location,
          start_at, end_at, all_day, timezone, category_id,
          reminder_offset_minutes, recurrence_frequency, recurrence_interval,
          recurrence_until_date, recurrence_occurrence_count,
          client_mutation_id, revision
        ) VALUES (
          ${input.id}, ${input.calendarId}, ${input.ownerId}, ${input.title}, ${input.status}, ${input.description}, ${input.location},
          ${input.startAt}, ${input.endAt}, ${input.allDay}, ${input.timezone}, ${input.categoryId},
          ${input.reminderOffsetMinutes}, ${input.recurrenceFrequency}, ${input.recurrenceInterval},
          ${input.recurrenceUntilDate}, ${input.recurrenceOccurrenceCount},
          ${input.clientMutationId}, nextval('snapcal_revision_seq')
        )
        ON CONFLICT (calendar_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL DO NOTHING
        RETURNING *
      `;
      if (rows.length > 0) return { event: mapEventRow(rows[0]), duplicate: false };

      // Conflict on client_mutation_id: this is a retry. Return the original.
      const existing = await db`
        SELECT * FROM snapcal_events
        WHERE calendar_id = ${input.calendarId} AND client_mutation_id = ${input.clientMutationId}
      `;
      return { event: mapEventRow(existing[0]), duplicate: true };
    },

    /**
     * Optimistic-concurrency update. `expectedRevision` must match the
     * event's current revision or the write is refused — see
     * docs/snapcal-architecture.md's conflict-semantics section for why a
     * simple compare-and-set was chosen over a merge strategy.
     */
    async update(input: { id: string; ownerId: string; calendarId: string; expectedRevision: number } & UpdateSnapCalEventInput): Promise<EventMutationResult> {
      const rows = await db`
        UPDATE snapcal_events SET
          title = COALESCE(${input.title ?? null}, title),
          status = COALESCE(${input.status ?? null}, status),
          description = CASE WHEN ${input.description !== undefined} THEN ${input.description ?? null} ELSE description END,
          location = CASE WHEN ${input.location !== undefined} THEN ${input.location ?? null} ELSE location END,
          start_at = COALESCE(${input.startAt ?? null}, start_at),
          end_at = COALESCE(${input.endAt ?? null}, end_at),
          all_day = COALESCE(${input.allDay ?? null}, all_day),
          timezone = COALESCE(${input.timezone ?? null}, timezone),
          category_id = CASE WHEN ${input.categoryId !== undefined} THEN ${input.categoryId ?? null} ELSE category_id END,
          reminder_offset_minutes = CASE WHEN ${input.reminderOffsetMinutes !== undefined} THEN ${input.reminderOffsetMinutes ?? null} ELSE reminder_offset_minutes END,
          recurrence_frequency = CASE WHEN ${input.recurrenceFrequency !== undefined} THEN ${input.recurrenceFrequency ?? null} ELSE recurrence_frequency END,
          recurrence_interval = CASE WHEN ${input.recurrenceInterval !== undefined} THEN ${input.recurrenceInterval ?? null} ELSE recurrence_interval END,
          recurrence_until_date = CASE WHEN ${input.recurrenceUntilDate !== undefined} THEN ${input.recurrenceUntilDate ?? null} ELSE recurrence_until_date END,
          recurrence_occurrence_count = CASE WHEN ${input.recurrenceOccurrenceCount !== undefined} THEN ${input.recurrenceOccurrenceCount ?? null} ELSE recurrence_occurrence_count END,
          revision = nextval('snapcal_revision_seq'),
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND calendar_id = ${input.calendarId}
          AND deleted_at IS NULL AND revision = ${input.expectedRevision}
        RETURNING *
      `;
      if (rows.length > 0) return { status: "ok", event: mapEventRow(rows[0]) };

      const current = await db`
        SELECT * FROM snapcal_events
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND calendar_id = ${input.calendarId}
      `;
      if (current.length === 0) return { status: "not_found" };
      return { status: "conflict", current: mapEventRow(current[0]) };
    },

    /** Tombstone, not DELETE — see the migration's design notes for why. */
    async softDelete(input: { id: string; ownerId: string; calendarId: string; expectedRevision: number }): Promise<EventMutationResult> {
      const rows = await db`
        UPDATE snapcal_events SET
          deleted_at = now(),
          revision = nextval('snapcal_revision_seq'),
          updated_at = now()
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND calendar_id = ${input.calendarId}
          AND deleted_at IS NULL AND revision = ${input.expectedRevision}
        RETURNING *
      `;
      if (rows.length > 0) return { status: "ok", event: mapEventRow(rows[0]) };

      const current = await db`
        SELECT * FROM snapcal_events
        WHERE id = ${input.id} AND owner_id = ${input.ownerId} AND calendar_id = ${input.calendarId}
      `;
      if (current.length === 0) return { status: "not_found" };
      if (current[0].deleted_at !== null) return { status: "ok", event: mapEventRow(current[0]) }; // already deleted: idempotent
      return { status: "conflict", current: mapEventRow(current[0]) };
    },
  };
}
