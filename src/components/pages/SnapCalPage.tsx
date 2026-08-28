import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LogOut, Plus, RefreshCcw } from "lucide-react";
import { CalendarGrid } from "../snapcal/CalendarGrid";
import { EventModal } from "../snapcal/EventModal";
import { LoginGate } from "../snapcal/LoginGate";
import {
  createEvent,
  deleteEvent,
  generateClientMutationId,
  getCalendars,
  getEvents,
  logout,
  updateEvent,
  SnapCalApiError,
  type EventDraft,
  type SnapCalCalendar,
  type SnapCalEvent,
} from "../snapcal/snapcalApi";

type SessionState = "checking" | "signed-out" | "signed-in";

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

export function SnapCalPage() {
  const [session, setSession] = useState<SessionState>("checking");
  const [calendars, setCalendars] = useState<SnapCalCalendar[]>([]);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [events, setEvents] = useState<SnapCalEvent[]>([]);
  const [cursor, setCursor] = useState(new Date());
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{ existing: SnapCalEvent | null; day: Date | null } | null>(null);

  const loadCalendars = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await getCalendars();
      setCalendars(list);
      setCalendarId((prev) => prev ?? list[0]?.id ?? null);
      setSession("signed-in");
    } catch (error) {
      if (error instanceof SnapCalApiError && error.status === 401) {
        setSession("signed-out");
        return;
      }
      setSession("signed-in");
      setLoadError(error instanceof SnapCalApiError ? error.message : "Could not load calendars.");
    }
  }, []);

  useEffect(() => {
    loadCalendars();
  }, [loadCalendars]);

  const loadEvents = useCallback(async () => {
    if (!calendarId) return;
    setLoadingEvents(true);
    setLoadError(null);
    try {
      const list = await getEvents(calendarId);
      setEvents(list.filter((event) => event.deletedAt === null));
    } catch (error) {
      setLoadError(error instanceof SnapCalApiError ? error.message : "Could not load events.");
    } finally {
      setLoadingEvents(false);
    }
  }, [calendarId]);

  useEffect(() => {
    if (session === "signed-in" && calendarId) {
      loadEvents();
    }
  }, [session, calendarId, loadEvents]);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setSession("signed-out");
      setCalendars([]);
      setCalendarId(null);
      setEvents([]);
    }
  }

  function goToMonth(delta: number) {
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function goToToday() {
    setCursor(new Date());
  }

  async function handleCreate(draft: EventDraft) {
    if (!calendarId) return;
    await createEvent(calendarId, draft, generateClientMutationId());
    await loadEvents();
  }

  async function handleUpdate(id: string, expectedRevision: number, patch: EventDraft) {
    if (!calendarId) return;
    await updateEvent(id, calendarId, expectedRevision, patch);
    await loadEvents();
  }

  async function handleDelete(id: string, expectedRevision: number) {
    if (!calendarId) return;
    await deleteEvent(id, calendarId, expectedRevision);
    await loadEvents();
  }

  if (session === "checking") {
    return (
      <section className="section-shell pt-32 lg:pt-36" aria-labelledby="snapcal-title">
        <p className="text-center text-sm text-kcx-ash">Loading SnapCal…</p>
      </section>
    );
  }

  if (session === "signed-out") {
    return (
      <section className="section-shell pt-32 lg:pt-36" aria-labelledby="snapcal-title">
        <h1 id="snapcal-title" className="sr-only">
          SnapCal
        </h1>
        <LoginGate onSignedIn={loadCalendars} />
      </section>
    );
  }

  return (
    <section className="section-shell pt-32 lg:pt-36" aria-labelledby="snapcal-title">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 border border-kcx-cyan/30 bg-kcx-cyan/10 px-3 py-2 text-[0.7rem] font-bold uppercase tracking-[0.2em] text-kcx-cyan">
              <CalendarDays size={15} />
              SnapCal — Hosted Calendar
            </div>
            <h1 id="snapcal-title" className="text-3xl font-semibold text-white sm:text-4xl">
              {MONTH_LABEL.format(cursor)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {calendars.length > 1 ? (
              <select
                value={calendarId ?? ""}
                onChange={(event) => setCalendarId(event.target.value)}
                className="snapcal-input focus-ring"
                aria-label="Select calendar"
              >
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="button" onClick={handleLogout} className="button-secondary focus-ring">
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => goToMonth(-1)} className="icon-chip focus-ring" aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={goToToday} className="button-secondary focus-ring">
              Today
            </button>
            <button type="button" onClick={() => goToMonth(1)} className="icon-chip focus-ring" aria-label="Next month">
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={loadEvents}
              className="icon-chip focus-ring"
              aria-label="Refresh events"
              disabled={loadingEvents}
            >
              <RefreshCcw size={16} className={loadingEvents ? "animate-spin" : ""} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setModalState({ existing: null, day: cursor })}
            className="button-primary focus-ring"
            disabled={!calendarId}
          >
            <Plus size={16} />
            Add Event
          </button>
        </div>

        {loadError ? (
          <div className="mb-4 border border-kcx-red/40 bg-kcx-red/10 p-3 text-sm text-kcx-steel">{loadError}</div>
        ) : null}

        {!calendarId ? (
          <div className="studio-panel p-8 text-center text-sm text-kcx-ash">No calendar available yet.</div>
        ) : loadingEvents && events.length === 0 ? (
          <div className="studio-panel p-8 text-center text-sm text-kcx-ash">Loading events…</div>
        ) : (
          <CalendarGrid
            year={cursor.getFullYear()}
            month={cursor.getMonth()}
            events={events}
            onSelectDay={(day) => setModalState({ existing: null, day })}
            onSelectEvent={(event) => setModalState({ existing: event, day: null })}
          />
        )}
      </div>

      {modalState ? (
        <EventModal
          existing={modalState.existing}
          initialDay={modalState.day}
          onClose={() => setModalState(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ) : null}
    </section>
  );
}
