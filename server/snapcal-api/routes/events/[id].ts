import { createDb, eventRepository } from "../../_lib/db.js";
import { parseExpectedRevision, validateEventPatch } from "../../_lib/validate.js";
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
 * GET    /api/snapcal/v1/events/:id?calendarId=...                        retrieve one event
 * PATCH  /api/snapcal/v1/events/:id  { calendarId, expectedRevision, ...patch }   update (optimistic concurrency)
 * DELETE /api/snapcal/v1/events/:id  { calendarId, expectedRevision }             tombstone
 *
 * Every mutation requires `expectedRevision` — the revision the client last
 * saw for this event. A mismatch means someone else changed it first; the
 * server refuses the write and returns 409 with the current server state,
 * rather than silently overwriting newer data. See
 * docs/snapcal-architecture.md's conflict-semantics section.
 */
async function handler(request: Request): Promise<Response> {
  const context = await requireDevice(request);
  if (isResponse(context)) return context;

  const id = requestUrl(request).pathname.split("/").pop() ?? "";
  if (!id) return json(400, { error: { code: "INVALID_REQUEST", message: "Missing event id." } });

  const repo = eventRepository(createDb(context.config.database));

  if (request.method === "GET") {
    const calendarId = requestUrl(request).searchParams.get("calendarId");
    if (!calendarId) return json(400, { error: { code: "INVALID_REQUEST", message: "calendarId is required." } });
    try {
      const event = await repo.getById(context.ownerId, calendarId, id);
      return event ? json(200, { event }) : json(404, { error: { code: "EVENT_NOT_FOUND", message: "No such event." } });
    } catch (error) {
      return internalError(error, context.config);
    }
  }

  if (request.method === "PATCH") {
    const body = await readJson(request);
    if (!body) return json(400, { error: { code: "INVALID_REQUEST", message: "Request body must be JSON." } });

    const calendarId = typeof body.calendarId === "string" ? body.calendarId : "";
    if (!calendarId) return json(400, { error: { code: "INVALID_REQUEST", message: "calendarId is required." } });

    const expectedRevision = parseExpectedRevision(body);
    if (expectedRevision === null) {
      return json(400, { error: { code: "INVALID_REQUEST", message: "expectedRevision is required." } });
    }

    const validation = validateEventPatch(body);
    if (!validation.ok) return json(400, { error: { code: "INVALID_REQUEST", message: validation.error } });

    try {
      const result = await repo.update({ id, ownerId: context.ownerId, calendarId, expectedRevision, ...validation.value });
      if (result.status === "not_found") return json(404, { error: { code: "EVENT_NOT_FOUND", message: "No such event." } });
      if (result.status === "conflict") {
        return json(409, { error: { code: "REVISION_CONFLICT", message: "The event changed since you last saw it." }, current: result.current });
      }
      return json(200, { event: result.event });
    } catch (error) {
      return internalError(error, context.config);
    }
  }

  if (request.method === "DELETE") {
    const body = await readJson(request);
    const calendarId = typeof body?.calendarId === "string" ? body.calendarId : requestUrl(request).searchParams.get("calendarId");
    if (!calendarId) return json(400, { error: { code: "INVALID_REQUEST", message: "calendarId is required." } });

    const expectedRevision = body ? parseExpectedRevision(body) : null;
    if (expectedRevision === null) {
      return json(400, { error: { code: "INVALID_REQUEST", message: "expectedRevision is required." } });
    }

    try {
      const result = await repo.softDelete({ id, ownerId: context.ownerId, calendarId, expectedRevision });
      if (result.status === "not_found") return json(404, { error: { code: "EVENT_NOT_FOUND", message: "No such event." } });
      if (result.status === "conflict") {
        return json(409, { error: { code: "REVISION_CONFLICT", message: "The event changed since you last saw it." }, current: result.current });
      }
      return json(200, { event: result.event });
    } catch (error) {
      return internalError(error, context.config);
    }
  }

  return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET, PATCH, or DELETE." } }, { Allow: "GET, PATCH, DELETE" });
}

export default toNodeHandler(handler);
