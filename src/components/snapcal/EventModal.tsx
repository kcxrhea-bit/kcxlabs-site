import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import type { EventDraft, SnapCalEvent } from "./snapcalApi";
import { SnapCalApiError, SnapCalConflictError } from "./snapcalApi";

const REMINDER_PRESETS = [
  { label: "None", value: "" },
  { label: "At time of event", value: "0" },
  { label: "5 minutes before", value: "5" },
  { label: "15 minutes before", value: "15" },
  { label: "30 minutes before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "1 day before", value: "1440" },
];

const RECURRENCE_FREQUENCIES = [
  { label: "Does not repeat", value: "" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
];

const browserTimezone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

/** Converts an absolute UTC ISO instant into a value a `datetime-local` input can render, in the browser's local time. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string {
  const date = new Date(value);
  return date.toISOString();
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function draftFromEvent(event: SnapCalEvent): EventDraft {
  return {
    title: event.title,
    status: event.status,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    timezone: event.timezone,
    categoryId: event.categoryId,
    reminderOffsetMinutes: event.reminderOffsetMinutes,
    recurrenceFrequency: event.recurrenceFrequency,
    recurrenceInterval: event.recurrenceInterval,
    recurrenceUntilDate: event.recurrenceUntilDate,
    recurrenceOccurrenceCount: event.recurrenceOccurrenceCount,
  };
}

function draftFromDay(day: Date): EventDraft {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(day);
  end.setHours(10, 0, 0, 0);
  return {
    title: "",
    status: "SCHEDULED",
    description: null,
    location: null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: false,
    timezone: browserTimezone,
    categoryId: null,
    reminderOffsetMinutes: null,
    recurrenceFrequency: null,
    recurrenceInterval: null,
    recurrenceUntilDate: null,
    recurrenceOccurrenceCount: null,
  };
}

export type EventModalProps = {
  /** Editing an existing event, or null when creating a new one. */
  existing: SnapCalEvent | null;
  /** The day a new event was started from (create mode only). */
  initialDay: Date | null;
  onClose: () => void;
  onCreate: (draft: EventDraft) => Promise<void>;
  onUpdate: (id: string, expectedRevision: number, patch: EventDraft) => Promise<void>;
  onDelete: (id: string, expectedRevision: number) => Promise<void>;
};

export function EventModal({ existing, initialDay, onClose, onCreate, onUpdate, onDelete }: EventModalProps) {
  const [draft, setDraft] = useState<EventDraft>(() =>
    existing ? draftFromEvent(existing) : draftFromDay(initialDay ?? new Date()),
  );
  const [revision, setRevision] = useState<number | null>(existing?.revision ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SnapCalEvent | null>(null);

  useEffect(() => {
    setDraft(existing ? draftFromEvent(existing) : draftFromDay(initialDay ?? new Date()));
    setRevision(existing?.revision ?? null);
  }, [existing, initialDay]);

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!draft.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (new Date(draft.endAt).getTime() < new Date(draft.startAt).getTime()) {
      setError("End must not be before start.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setConflict(null);
    try {
      if (existing) {
        await onUpdate(existing.id, revision ?? existing.revision, draft);
      } else {
        await onCreate(draft);
      }
      onClose();
    } catch (err) {
      if (err instanceof SnapCalConflictError) {
        setConflict(err.current);
      } else {
        setError(err instanceof SnapCalApiError ? err.message : "Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!existing || deleting) return;
    setDeleting(true);
    setError(null);
    setConflict(null);
    try {
      await onDelete(existing.id, revision ?? existing.revision);
      onClose();
    } catch (err) {
      if (err instanceof SnapCalConflictError) {
        setConflict(err.current);
      } else {
        setError(err instanceof SnapCalApiError ? err.message : "Could not delete this event.");
      }
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  function reloadFromConflict() {
    if (!conflict) return;
    setDraft(draftFromEvent(conflict));
    setRevision(conflict.revision);
    setConflict(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapcal-event-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="studio-panel w-full max-w-lg p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="snapcal-event-modal-title" className="text-lg font-semibold text-white">
            {existing ? "Edit Event" : "New Event"}
          </h2>
          <button type="button" onClick={onClose} className="icon-chip focus-ring" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {conflict ? (
          <div className="mb-5 border border-kcx-orange/40 bg-kcx-orange/10 p-4 text-sm leading-6 text-kcx-steel">
            <div className="mb-2 flex items-center gap-2 font-semibold text-kcx-orange">
              <AlertTriangle size={16} />
              This event changed elsewhere
            </div>
            <p className="text-kcx-ash">
              Someone (another device, or you in another tab) updated this event since you opened it. The server now
              has &ldquo;{conflict.title}&rdquo; at revision {conflict.revision}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={reloadFromConflict} className="button-secondary focus-ring">
                Load Latest Version
              </button>
              <button type="button" onClick={onClose} className="button-secondary focus-ring">
                Discard My Change
              </button>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="grid gap-4">
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Title
            <input
              type="text"
              required
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              className="snapcal-input focus-ring"
            />
          </label>

          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Status
            <select
              value={draft.status}
              onChange={(event) => update("status", event.target.value as EventDraft["status"])}
              className="snapcal-input focus-ring"
            >
              <option value="SCHEDULED">Scheduled</option>
              <option value="COMPLETED">Completed</option>
              <option value="MISSED">Missed</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(event) => update("allDay", event.target.checked)}
              className="size-4 accent-kcx-orange"
            />
            All-day
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
              {draft.allDay ? "Start Date" : "Start"}
              <input
                type={draft.allDay ? "date" : "datetime-local"}
                required
                value={draft.allDay ? toDateInputValue(draft.startAt) : toLocalInputValue(draft.startAt)}
                onChange={(event) =>
                  update("startAt", draft.allDay ? new Date(`${event.target.value}T00:00:00`).toISOString() : fromLocalInputValue(event.target.value))
                }
                className="snapcal-input focus-ring"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
              {draft.allDay ? "End Date" : "End"}
              <input
                type={draft.allDay ? "date" : "datetime-local"}
                required
                value={draft.allDay ? toDateInputValue(draft.endAt) : toLocalInputValue(draft.endAt)}
                onChange={(event) =>
                  update("endAt", draft.allDay ? new Date(`${event.target.value}T23:59:59`).toISOString() : fromLocalInputValue(event.target.value))
                }
                className="snapcal-input focus-ring"
              />
            </label>
          </div>

          {!draft.allDay ? (
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
              Timezone
              <input
                type="text"
                value={draft.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                className="snapcal-input focus-ring"
                placeholder={browserTimezone}
              />
            </label>
          ) : null}

          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Location
            <input
              type="text"
              value={draft.location ?? ""}
              onChange={(event) => update("location", event.target.value || null)}
              className="snapcal-input focus-ring"
            />
          </label>

          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Description
            <textarea
              rows={3}
              value={draft.description ?? ""}
              onChange={(event) => update("description", event.target.value || null)}
              className="snapcal-input focus-ring resize-y"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
              Category
              <input
                type="text"
                value={draft.categoryId ?? ""}
                onChange={(event) => update("categoryId", event.target.value || null)}
                className="snapcal-input focus-ring"
                placeholder="e.g. work, personal"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
              Reminder
              <select
                value={draft.reminderOffsetMinutes === null ? "" : String(draft.reminderOffsetMinutes)}
                onChange={(event) => update("reminderOffsetMinutes", event.target.value === "" ? null : Number(event.target.value))}
                className="snapcal-input focus-ring"
              >
                {REMINDER_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="grid gap-3 border border-white/10 p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">Repeat</legend>
            <select
              value={draft.recurrenceFrequency ?? ""}
              onChange={(event) => update("recurrenceFrequency", event.target.value || null)}
              className="snapcal-input focus-ring"
            >
              {RECURRENCE_FREQUENCIES.map((freq) => (
                <option key={freq.label} value={freq.value}>
                  {freq.label}
                </option>
              ))}
            </select>

            {draft.recurrenceFrequency ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
                  Every
                  <input
                    type="number"
                    min={1}
                    value={draft.recurrenceInterval ?? 1}
                    onChange={(event) => update("recurrenceInterval", Math.max(1, Number(event.target.value) || 1))}
                    className="snapcal-input focus-ring"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
                  Until
                  <input
                    type="date"
                    value={draft.recurrenceUntilDate ?? ""}
                    onChange={(event) => update("recurrenceUntilDate", event.target.value || null)}
                    className="snapcal-input focus-ring"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
                  Occurrences
                  <input
                    type="number"
                    min={1}
                    value={draft.recurrenceOccurrenceCount ?? ""}
                    onChange={(event) => update("recurrenceOccurrenceCount", event.target.value === "" ? null : Number(event.target.value))}
                    className="snapcal-input focus-ring"
                  />
                </label>
              </div>
            ) : null}
          </fieldset>

          {error ? (
            <div className="flex items-start gap-2 border border-kcx-red/40 bg-kcx-red/10 p-3 text-sm text-kcx-steel">
              <AlertTriangle className="mt-0.5 shrink-0 text-kcx-red" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            {existing ? (
              confirmingDelete ? (
                <div className="flex items-center gap-2 text-sm text-kcx-ash">
                  Delete this event?
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="button-secondary focus-ring border-kcx-red/50 text-kcx-red disabled:opacity-60"
                  >
                    {deleting ? "Deleting…" : "Confirm"}
                  </button>
                  <button type="button" onClick={() => setConfirmingDelete(false)} className="button-secondary focus-ring">
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="button-secondary focus-ring inline-flex items-center gap-2 text-kcx-red"
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              )
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="button-secondary focus-ring">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="button-primary focus-ring disabled:opacity-60">
                {submitting ? "Saving…" : existing ? "Save Changes" : "Create Event"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
