import { createDb, eventRepository } from "../../_lib/db.js";
import { generateEventId } from "../../_lib/ids.js";
import { validateNewEvent } from "../../_lib/validate.js";
import {
  internalError,
  isResponse,
  json,
  readJson,
  requestUrl,
  requireDevice,
  toNodeHandler,
} from "../../../media-api/_lib/http.js";

/**
 * GET  /api/snapcal/v1/events?calendarId=...              full listing (excludes tombstones)
 * GET  /api/snapcal/v1/events?calendarId=...&sinceRevision=N   incremental pull since revision N (includes tombstones)
 * POST /api/snapcal/v1/events                              create (body includes calendarId)
 *
 * This single query is the entire sync protocol's pull side — see
 * docs/snapcal-architecture.md. Clients never re-download the whole
 * calendar; they persist the highest revision they've seen and pass it back
 * as `sinceRevision` next time.
 */
async function handler(request: Request): Promise<Response> {
  const context = await requireDevice(request);
  if (isResponse(context)) return context;

  const repo = eventRepository(createDb(context.config.database));

  if (request.method === "GET") {
    const url = requestUrl(request);
    const calendarId = url.searchParams.get("calendarId");
    if (!calendarId) return json(400, { error: { code: "INVALID_REQUEST", message: "calendarId is required." } });

    const sinceRevisionRaw = url.searchParams.get("sinceRevision");
    try {
      if (sinceRevisionRaw !== null) {
        const sinceRevision = Number(sinceRevisionRaw);
        if (!Number.isFinite(sinceRevision) || sinceRevision < 0) {
          return json(400, { error: { code: "INVALID_REQUEST", message: "sinceRevision must be a non-negative number." } });
        }
        const events = await repo.changesSince(context.ownerId, calendarId, sinceRevision);
        const cursor = events.length > 0 ? events[events.length - 1].revision : sinceRevision;
        return json(200, { events, cursor });
      }

      const events = await repo.listForCalendar(context.ownerId, calendarId);
      const cursor = events.reduce((max, event) => Math.max(max, event.revision), 0);
      return json(200, { events, cursor });
    } catch (error) {
      return internalError(error, context.config);
    }
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body) return json(400, { error: { code: "INVALID_REQUEST", message: "Request body must be JSON." } });

    const calendarId = typeof body.calendarId === "string" ? body.calendarId : "";
    if (!calendarId) return json(400, { error: { code: "INVALID_REQUEST", message: "calendarId is required." } });

    const validation = validateNewEvent(body);
    if (!validation.ok) return json(400, { error: { code: "INVALID_REQUEST", message: validation.error } });

    try {
      const { event, duplicate } = await repo.create({
        id: generateEventId(),
        ownerId: context.ownerId,
        calendarId,
        ...validation.value,
      });
      return json(duplicate ? 200 : 201, { event, duplicate });
    } catch (error) {
      return internalError(error, context.config);
    }
  }

  return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, { Allow: "GET, POST" });
}

export default toNodeHandler(handler);
