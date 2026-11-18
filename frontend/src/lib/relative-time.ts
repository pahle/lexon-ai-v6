const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const unit = (count: number, name: string) =>
  `${count} ${name}${count === 1 ? '' : 's'} ago`;

/**
 * Elapsed time as the prototype writes it: "3 days ago", "2 months ago".
 * `now` is a parameter so tests (and frozen visual captures) control the clock.
 * Returns "" for an unparsable value.
 */
export function formatRelativeTime(value: string, now = new Date()): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return unit(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return unit(Math.floor(elapsed / HOUR), 'hour');
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return unit(days, 'day');
  if (days < 365) return unit(Math.floor(days / 30), 'month');
  return unit(Math.floor(days / 365), 'year');
}
