export const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const clock = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Invitation dates: day, month, year ("25 Nov 2026"). */
export function formatDayMonthYear(value: Date | string): string {
  return dayMonthYear.format(new Date(value)).replace('Sept', 'Sep');
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Chat list dates as in the prototype: the time of day for today ("10:42"),
 * "Yesterday" when `yesterday` is set, otherwise "Nov 4". The search list
 * prints "Today" instead of the time and never says "Yesterday".
 */
export function formatActivityDate(
  value: string,
  options: { todayAs?: 'time' | 'label'; yesterday?: boolean } = {},
  now = new Date(),
): string {
  const date = new Date(value);
  const today = startOfDay(now);
  const day = startOfDay(date);
  if (day.getTime() === today.getTime())
    return options.todayAs === 'label' ? 'Today' : clock.format(date);
  if (options.yesterday) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (day.getTime() === yesterday.getTime()) return 'Yesterday';
  }
  return monthDay.format(date);
}
