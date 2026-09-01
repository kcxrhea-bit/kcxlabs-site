import { Clock } from "lucide-react";
import type { SnapCalEvent } from "./snapcalApi";
import { buildMonthGrid, eventMatchesDay } from "./calendarMath";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DayCell = {
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
};

function eventsForDay(events: SnapCalEvent[], day: Date): SnapCalEvent[] {
  return events
    .filter((event) => eventMatchesDay(event, day))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export type CalendarGridProps = {
  year: number;
  month: number; // 0-indexed
  events: SnapCalEvent[];
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: SnapCalEvent) => void;
};

export function CalendarGrid({ year, month, events, onSelectDay, onSelectEvent }: CalendarGridProps) {
  const cells = buildMonthGrid(year, month);

  return (
    <div className="studio-panel overflow-hidden">
      <div className="grid grid-cols-7 border-b border-white/10 bg-black/20 text-center text-[0.65rem] font-bold uppercase tracking-[0.18em] text-kcx-ash">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const dayEvents = eventsForDay(events, cell.date);
          return (
            <button
              key={cell.date.toISOString()}
              type="button"
              onClick={() => onSelectDay(cell.date)}
              className={`focus-ring flex min-h-[5.5rem] flex-col items-stretch gap-1 border-b border-r border-white/5 p-1.5 text-left transition-colors last:border-r-0 sm:min-h-[7rem] sm:p-2 ${
                cell.inCurrentMonth ? "bg-transparent hover:bg-white/5" : "bg-black/20 hover:bg-black/10"
              }`}
              aria-label={`${cell.date.toDateString()}${dayEvents.length > 0 ? `, ${dayEvents.length} event(s)` : ""}`}
            >
              <span
                className={`inline-flex size-6 items-center justify-center self-start text-xs font-semibold ${
                  cell.isToday
                    ? "bg-kcx-orange text-kcx-black"
                    : cell.inCurrentMonth
                      ? "text-kcx-steel"
                      : "text-kcx-ash/60"
                }`}
              >
                {cell.date.getDate()}
              </span>
              <div className="flex flex-col gap-1 overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onSelectEvent(event);
                    }}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                        keyEvent.stopPropagation();
                        keyEvent.preventDefault();
                        onSelectEvent(event);
                      }
                    }}
                    className={`focus-ring snapcal-event snapcal-event--${event.status.toLowerCase()} truncate border-l-2 px-1.5 py-0.5 text-[0.68rem] hover:bg-kcx-cyan/20`}
                    title={`${event.title} — ${event.status.toLowerCase()}`}
                  >
                    {event.allDay ? (
                      `${event.title} · ${event.status.toLowerCase()}`
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} className="shrink-0 text-kcx-cyan" />
                        {formatTime(event.startAt)} {event.title} · {event.status.toLowerCase()}
                      </span>
                    )}
                  </span>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="text-[0.65rem] text-kcx-ash">+{dayEvents.length - 3} more</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
