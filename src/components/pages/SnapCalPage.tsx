import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LogOut, Plus, RefreshCcw } from "lucide-react";
import { CalendarGrid } from "../snapcal/CalendarGrid";
import { EventModal } from "../snapcal/EventModal";
import { eventMatchesDay } from "../snapcal/calendarMath";
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
const DEFAULT_BACKGROUND = "/snapcal/background.png";

export function SnapCalPage() {
  const [session, setSession] = useState<SessionState>("checking");
  const [calendars, setCalendars] = useState<SnapCalCalendar[]>([]);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [events, setEvents] = useState<SnapCalEvent[]>([]);
  const [cursor, setCursor] = useState(new Date());
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{ existing: SnapCalEvent | null; day: Date | null } | null>(null);
  const [defaultBackground, setDefaultBackground] = useState(DEFAULT_BACKGROUND);
  const [monthBackgrounds, setMonthBackgrounds] = useState<Record<string, string>>({});
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.42);
  const backgroundUrls = useRef(new Set<string>());

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

  function monthKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
  }

  function backgroundForCursor(): string {
    return monthBackgrounds[monthKey(cursor)] ?? defaultBackground;
  }

  function chooseBackground(file: File | undefined, monthOverride: boolean) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    backgroundUrls.current.add(url);
    if (monthOverride) {
      const key = monthKey(cursor);
      const previous = monthBackgrounds[key];
      if (previous?.startsWith("blob:")) {
        URL.revokeObjectURL(previous);
        backgroundUrls.current.delete(previous);
      }
      setMonthBackgrounds((current) => ({ ...current, [key]: url }));
    } else {
      setDefaultBackground((current) => {
        if (current.startsWith("blob:")) URL.revokeObjectURL(current);
        backgroundUrls.current.delete(current);
        return url;
      });
    }
  }

  function removeMonthBackground() {
    const key = monthKey(cursor);
    const existing = monthBackgrounds[key];
    if (existing?.startsWith("blob:")) {
      URL.revokeObjectURL(existing);
      backgroundUrls.current.delete(existing);
    }
    setMonthBackgrounds((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function restoreDefaultBackground() {
    if (defaultBackground.startsWith("blob:")) {
      URL.revokeObjectURL(defaultBackground);
      backgroundUrls.current.delete(defaultBackground);
    }
    setDefaultBackground(DEFAULT_BACKGROUND);
  }

  useEffect(() => () => {
    backgroundUrls.current.forEach((url) => URL.revokeObjectURL(url));
    backgroundUrls.current.clear();
  }, []);

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

  async function handleStatus(event: SnapCalEvent, status: SnapCalEvent["status"]) {
    try {
      await updateEvent(event.id, event.calendarId, event.revision, { status });
      await loadEvents();
    } catch (error) {
      setLoadError(error instanceof SnapCalApiError ? error.message : "Could not update event status.");
    }
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
    <section className="section-shell snapcal-stage pt-32 lg:pt-36" aria-labelledby="snapcal-title">
      <div
        className="snapcal-art-layer"
        aria-hidden="true"
        style={{ backgroundImage: backgroundForCursor() === "none" ? "none" : `url("${backgroundForCursor()}")`, opacity: backgroundOpacity }}
      />
      <div className="relative z-10 mx-auto max-w-6xl">
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

        {!loadingEvents && events.some((event) => eventMatchesDay(event, new Date())) ? (
          <section className="studio-panel mb-6 p-5" aria-labelledby="snapcal-today-title">
            <h2 id="snapcal-today-title" className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-kcx-cyan">Today</h2>
            <div className="grid gap-3">
              {events.filter((event) => eventMatchesDay(event, new Date())).map((event) => (
                <div key={event.id} className={`snapcal-event snapcal-event--${event.status.toLowerCase()} border-l-2 p-3`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong>{event.title}</strong><span className="text-xs uppercase">{event.status.toLowerCase()}</span></div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="button-secondary focus-ring" onClick={() => void handleStatus(event, "COMPLETED")}>Completed</button>
                    <button type="button" className="button-secondary focus-ring" onClick={() => void handleStatus(event, "MISSED")}>Missed</button>
                    <button type="button" className="button-secondary focus-ring" onClick={() => void handleStatus(event, "DISMISSED")}>Dismiss</button>
                    <button type="button" className="button-secondary focus-ring" onClick={() => setModalState({ existing: { ...event, status: "SCHEDULED" }, day: null })}>Reschedule</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
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

        <details className="studio-panel mt-6 p-5">
          <summary className="cursor-pointer text-sm font-bold uppercase tracking-[0.14em] text-kcx-cyan">SnapCal Help</summary>
          <div className="mt-4 space-y-3 text-sm leading-6 text-kcx-steel">
            <p><strong>Getting started:</strong> Sign in with the KCx Labs owner account, choose a calendar, then use Previous, Next, Today, Refresh, or Add Event.</p>
            <p><strong>Shared calendar:</strong> SnapCal Cloud automatically synchronizes event details and the explicit Scheduled, Completed, Missed, Dismissed, or Cancelled status between the website, KsnapCalx Desktop, and KsnapCalxBuddy Android. Phone and PC do not need to be online at the same time.</p>
            <p><strong>Status actions:</strong> Open an event and choose its status. Completed events stay visible with a dimmed, struck-through treatment. Nothing is marked Missed automatically, and Cancelled is different from deleting the event.</p>
            <p><strong>Offline clients:</strong> Desktop and Android keep local calendar data and queue changes while offline. A pending change syncs after reconnecting; failures remain queued so Retry/Sync can recover without recreating the event. Conflicts must be reviewed rather than silently overwritten.</p>
            <p><strong>Device calendars:</strong> Android&apos;s selected Google/device calendar is a separate, explicit copy bridge. SnapCal automatic sync does not automatically modify that device calendar. Select one writable destination in Android Settings; read-only calendars cannot be selected.</p>
            <p><strong>Images:</strong> The calendar uses the shared KCx background by default. You can preview a replacement or a month-specific image in this browser session; these local selections are not uploaded or shared yet. Event pictures and scan uploads are not currently available.</p>
            <p><strong>Common recovery:</strong> Use Refresh after a connection interruption. If a session expires, sign in again. If an event conflict appears, review the current server version before saving changes.</p>
          </div>
          <div className="mt-5 grid gap-4 border-t border-white/10 pt-5 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-kcx-cyan">Calendar artwork</p>
              <label className="mb-2 block text-sm text-kcx-steel">
                Choose default background
                <input className="mt-2 block w-full text-xs text-kcx-ash" type="file" accept="image/*" onChange={(event) => chooseBackground(event.target.files?.[0], false)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="button-secondary focus-ring" onClick={restoreDefaultBackground}>Restore default</button>
                <button type="button" className="button-secondary focus-ring" onClick={() => { if (defaultBackground.startsWith("blob:")) { URL.revokeObjectURL(defaultBackground); backgroundUrls.current.delete(defaultBackground); } setDefaultBackground("none"); }} disabled={defaultBackground === "none"}>Remove custom</button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-kcx-cyan">This month</p>
              <label className="mb-2 block text-sm text-kcx-steel">
                Choose {MONTH_LABEL.format(cursor)} artwork
                <input className="mt-2 block w-full text-xs text-kcx-ash" type="file" accept="image/*" onChange={(event) => chooseBackground(event.target.files?.[0], true)} />
              </label>
              <button type="button" className="button-secondary focus-ring" onClick={removeMonthBackground} disabled={!monthBackgrounds[monthKey(cursor)]}>Use calendar default for this month</button>
            </div>
          </div>
          <label className="mt-4 block text-sm text-kcx-steel">
            Artwork visibility: {Math.round(backgroundOpacity * 100)}%
            <input className="mt-2 w-full accent-kcx-orange" type="range" min="0" max="0.8" step="0.02" value={backgroundOpacity} onChange={(event) => setBackgroundOpacity(Number(event.target.value))} />
          </label>
        </details>
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
