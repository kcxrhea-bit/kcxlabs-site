export type CalendarDayCell = { date: Date; inCurrentMonth: boolean; isToday: boolean };

export function buildMonthGrid(year: number, month: number, now = new Date()): CalendarDayCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const todayKey = now.toDateString();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return { date, inCurrentMonth: date.getFullYear() === year && date.getMonth() === month, isToday: date.toDateString() === todayKey };
  });
}

export function eventMatchesDay(event: { startAt: string; endAt: string; allDay: boolean }, day: Date): boolean {
  if (event.allDay) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    const dayUtc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
    return dayUtc >= Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) && dayUtc <= Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  }
  return new Date(event.startAt).toDateString() === day.toDateString();
}
