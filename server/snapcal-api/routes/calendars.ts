import { calendarRepository, createDb } from "../_lib/db.js";
import { generateCalendarId } from "../_lib/ids.js";
import { internalError, isResponse, json, requireMethod, requireOwnerOrDevice, toNodeHandler } from "../../media-api/_lib/http.js";

/**
 * GET /api/snapcal/v1/calendars — the authenticated owner's calendars.
 * Auto-provisions a default calendar on first call so a brand-new client
 * never sees an empty "no calendar" state, mirroring KsnapCalx desktop's
 * own first-launch seeding.
 */
async function handler(request: Request): Promise<Response> {
  const methodError = requireMethod(request, "GET");
  if (methodError) return methodError;

  const context = await requireOwnerOrDevice(request);
  if (isResponse(context)) return context;

  try {
    const repo = calendarRepository(createDb(context.config.database));
    await repo.ensureDefault({ id: generateCalendarId(), ownerId: context.ownerId, name: "My Calendar", color: "#8b5cf6" });
    const calendars = await repo.listForOwner(context.ownerId);
    return json(200, { calendars });
  } catch (error) {
    return internalError(error, context.config);
  }
}

export default toNodeHandler(handler);
