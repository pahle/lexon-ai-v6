import { expect, test } from 'vitest';
import {
  formatLastActive,
  formatLastActiveHeader,
  formatPlatformDateTime,
} from '../../src/components/platform/platform-format';

// Local-time constructors keep every case on the viewer's calendar, whatever
// time zone the test runs in. Now: Saturday 14 Nov 2026, 11:00.
const now = new Date(2026, 10, 14, 11, 0, 0);
const at = (day: number, h = 10, m = 0, s = 0, month = 10) =>
  new Date(2026, month, day, h, m, s);
const minutesBefore = (n: number) => new Date(now.getTime() - n * 60_000);

test('null is Never', () => {
  expect(formatLastActive(null, now)).toBe('Never');
});

test('Active now below five minutes, Today from five minutes', () => {
  expect(formatLastActive(now, now)).toBe('Active now');
  expect(formatLastActive(new Date(now.getTime() - 299_999), now)).toBe(
    'Active now',
  );
  expect(formatLastActive(minutesBefore(5), now)).toBe('Today');
  // A clock a little ahead of the viewer's still reads as active.
  expect(formatLastActive(new Date(now.getTime() + 60_000), now)).toBe(
    'Active now',
  );
});

test('Today is the same calendar day, Yesterday the one before', () => {
  expect(formatLastActive(at(14, 0, 0, 0), now)).toBe('Today');
  expect(formatLastActive(at(14, 10, 42), now)).toBe('Today');
  expect(formatLastActive(at(13, 23, 59, 59), now)).toBe('Yesterday');
  expect(formatLastActive(at(13, 0, 0, 0), now)).toBe('Yesterday');
  expect(formatLastActive(at(12, 23, 59, 59), now)).toBe('2 days ago');
});

test('Active now wins across midnight', () => {
  const justAfterMidnight = new Date(2026, 10, 14, 0, 2, 0);
  expect(formatLastActive(at(13, 23, 58), justAfterMidnight)).toBe(
    'Active now',
  );
  expect(formatLastActive(at(13, 23, 56, 59), justAfterMidnight)).toBe(
    'Yesterday',
  );
});

test('N days ago below 14 days', () => {
  expect(formatLastActive(at(12), now)).toBe('2 days ago');
  expect(formatLastActive(at(9), now)).toBe('5 days ago');
  expect(formatLastActive(at(1, 0, 0, 0), now)).toBe('13 days ago');
});

test('N weeks ago from 14 days, below 8 weeks', () => {
  expect(formatLastActive(at(31, 23, 59, 59, 9), now)).toBe('2 weeks ago');
  expect(formatLastActive(at(31, 10, 0, 0, 9), now)).toBe('2 weeks ago');
  expect(formatLastActive(at(25, 10, 0, 0, 9), now)).toBe('2 weeks ago');
  expect(formatLastActive(at(24, 10, 0, 0, 9), now)).toBe('3 weeks ago');
  // 55 days: 20 Sep. 56 days: 19 Sep.
  expect(formatLastActive(at(20, 0, 0, 0, 8), now)).toBe('7 weeks ago');
  expect(formatLastActive(at(19, 23, 59, 59, 8), now)).toBe('19 Sep 2026');
});

test('older values are the absolute date', () => {
  expect(formatLastActive(new Date(2025, 0, 2, 9, 0), now)).toBe('2 Jan 2025');
});

test('accepts ISO strings and a numeric now; defaults now to the clock', () => {
  const iso = minutesBefore(1).toISOString();
  expect(formatLastActive(iso, now.getTime())).toBe('Active now');
  expect(formatLastActive(new Date().toISOString())).toBe('Active now');
});

test('the record header phrase', () => {
  expect(formatLastActiveHeader(null, now)).toBe('Last active never');
  expect(formatLastActiveHeader(at(14, 10, 42), now)).toBe('Last active today');
  expect(formatLastActiveHeader(at(13), now)).toBe('Last active yesterday');
  expect(formatLastActiveHeader(at(11), now)).toBe('Last active 3 days ago');
  expect(formatLastActiveHeader(at(31, 10, 0, 0, 9), now)).toBe(
    'Last active 2 weeks ago',
  );
  expect(formatLastActiveHeader(now, now)).toBe('Active now');
  expect(formatLastActiveHeader(new Date(2025, 0, 2), now)).toBe(
    'Last active 2 Jan 2025',
  );
});

test('the absolute title is the date and 24-hour time', () => {
  expect(formatPlatformDateTime(at(14, 10, 42))).toBe('14 Nov 2026, 10:42');
});
