import { expect, test } from 'vitest';
import { formatActivityDate, formatDayMonthYear } from '../src/lib/date-time';

const now = new Date(2026, 10, 14, 11, 0);

test('chat list dates read as in the prototype', () => {
  expect(
    formatActivityDate(new Date(2026, 10, 14, 10, 42).toISOString(), {}, now),
  ).toBe('10:42');
  expect(
    formatActivityDate(
      new Date(2026, 10, 13, 9, 0).toISOString(),
      { yesterday: true },
      now,
    ),
  ).toBe('Yesterday');
  expect(
    formatActivityDate(
      new Date(2026, 10, 4, 9, 0).toISOString(),
      { yesterday: true },
      now,
    ),
  ).toBe('Nov 4');
});

test('the search list prints Today instead of the time and has no Yesterday', () => {
  const today = new Date(2026, 10, 14, 10, 42).toISOString();
  expect(formatActivityDate(today, { todayAs: 'label' }, now)).toBe('Today');
  expect(
    formatActivityDate(
      new Date(2026, 10, 13, 9, 0).toISOString(),
      { todayAs: 'label' },
      now,
    ),
  ).toBe('Nov 13');
});

test('invitation dates are day, month, year', () => {
  expect(formatDayMonthYear(new Date(2026, 10, 25, 11, 0))).toBe('25 Nov 2026');
  expect(formatDayMonthYear(new Date(2026, 8, 5, 11, 0))).toBe('5 Sep 2026');
});
