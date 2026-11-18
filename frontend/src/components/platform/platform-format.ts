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

export function formatPlatformDateTime(value: string | Date) {
  const date = new Date(value);
  return `${formatPlatformDate(date)}, ${clock.format(date)}`;
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
