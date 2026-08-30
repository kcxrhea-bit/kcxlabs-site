/** Identifier generation for SnapCal, mirroring server/media-api/_lib/ids.ts's conventions. */
import { randomUUID } from "node:crypto";

export function generateCalendarId(): string {
  return `cal_${randomUUID()}`;
}

export function generateEventId(): string {
  return `evt_${randomUUID()}`;
}
