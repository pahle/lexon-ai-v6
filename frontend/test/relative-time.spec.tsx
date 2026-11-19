import { expect, test } from 'vitest';
import { formatRelativeTime } from '../src/lib/relative-time';

const now = new Date('2026-11-18T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test.each([
  [0, 'just now'],
  [59_000, 'just now'],
  [minute, '1 minute ago'],
  [5 * minute, '5 minutes ago'],
  [hour, '1 hour ago'],
  [23 * hour, '23 hours ago'],
  [day, '1 day ago'],
  [3 * day, '3 days ago'],
  [9 * day, '9 days ago'],
  [29 * day, '29 days ago'],
  [30 * day, '1 month ago'],
  [60 * day, '2 months ago'],
  [364 * day, '12 months ago'],
  [365 * day, '1 year ago'],
  [800 * day, '2 years ago'],
])('%i ms ago reads %s', (elapsed, text) => {
  expect(formatRelativeTime(ago(elapsed), now)).toBe(text);
});

test('a time slightly in the future (clock skew) reads as just now', () => {
  expect(formatRelativeTime(ago(-30_000), now)).toBe('just now');
});

test('an invalid time is empty so the caller can leave it out', () => {
  expect(formatRelativeTime('not a date', now)).toBe('');
});
