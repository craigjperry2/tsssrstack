import { type Brand, err, ok, type Result } from './shared.ts';

// A day on the calendar, with no time or zone, written YYYY-MM-DD. Comparing two as strings
// orders them by date.
export type CalendarDate = Brand<string, 'CalendarDate'>;

export function parseCalendarDate(raw: string): Result<CalendarDate, 'invalid'> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  if (!match) return err('invalid');
  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC would map years 0–99 to 1900–1999, so set the full year explicitly. Rolled-over
  // dates such as 2027-02-29 come back as a different day and are rejected.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ? ok(raw as CalendarDate)
    : err('invalid');
}

// The calendar date of an instant in UTC: the zone this application uses to decide what
// "today" is (see docs/adr/0003-due-dates-use-utc-calendar-days.md).
export const utcDateOf = (instant: Date): CalendarDate =>
  instant.toISOString().slice(0, 10) as CalendarDate;
