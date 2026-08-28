/** SnapCal domain types, shared by the data layer, routes, and the web calendar client. */

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

/** Fields a client may set when creating an event. */
export type NewSnapCalEventInput = {
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
};

/** Fields a client may change when updating an event — all optional, undefined means "leave unchanged". */
export type UpdateSnapCalEventInput = Partial<NewSnapCalEventInput>;
