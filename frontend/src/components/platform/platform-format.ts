// Dates on platform pages read like the prototype: "21 Nov 2026" and
// "14 Nov 2026, 11:00" (24-hour clock, the viewer's time zone).

const month = new Intl.DateTimeFormat('en-US', { month: 'short' });
const day = new Intl.DateTimeFormat('en-US', { day: 'numeric' });
const year = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
const clock = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatPlatformDate(value: string | Date) {
  const date = new Date(value);
  return `${day.format(date)} ${month.format(date)} ${year.format(date)}`;
}

export function formatPlatformTime(value: string | Date) {
  return clock.format(new Date(value));
}

export function formatPlatformDateTime(value: string | Date) {
  const date = new Date(value);
  return `${formatPlatformDate(date)}, ${clock.format(date)}`;
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Calendar days between two instants on the viewer's (local) calendar. */
function calendarDaysBetween(earlier: Date, later: Date) {
  const start = new Date(
    earlier.getFullYear(),
    earlier.getMonth(),
    earlier.getDate(),
  );
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  // Rounded: a daylight-saving day is 23 or 25 hours long.
  return Math.round((end.getTime() - start.getTime()) / DAY);
}

/**
 * Last active, relative (spec §13 entry 7): "Active now" below 5 minutes,
 * "Today" and "Yesterday" by the viewer's calendar day, "N days ago" below
 * 14 days, "N weeks ago" below 8 weeks, then the date; null is "Never".
 * `now` is a parameter so tests and captures run on a fixed clock.
 */
export function formatLastActive(
  value: string | Date | null,
  now: number | Date = Date.now(),
): string {
  if (value === null) return 'Never';
  const date = new Date(value);
  const current = new Date(now);
  if (current.getTime() - date.getTime() < 5 * MINUTE) return 'Active now';
  const days = calendarDaysBetween(date, current);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 56) return `${Math.floor(days / 7)} weeks ago`;
  return formatPlatformDate(date);
}

/** The record header phrase: "Last active today", "Last active never", "Active now". */
export function formatLastActiveHeader(
  value: string | Date | null,
  now: number | Date = Date.now(),
): string {
  const relative = formatLastActive(value, now);
  if (relative === 'Active now') return relative;
  const word = ['Today', 'Yesterday', 'Never'].includes(relative)
    ? relative.toLowerCase()
    : relative;
  return `Last active ${word}`;
}
