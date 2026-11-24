import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CalendarDataSchema,
  ID_NATIONAL_CALENDAR,
} from '../../shared/src/calendar/id-national-holidays.ts';

const DAY_MS = 86_400_000;
const GUARD_WINDOW_DAYS = 90;

const coveredYears = Object.keys(ID_NATIONAL_CALENDAR.years)
  .map(Number)
  .filter(Number.isSafeInteger)
  .sort((a, b) => a - b);
const lastCoveredYear = coveredYears[coveredYears.length - 1];
const horizonMs = Date.UTC(lastCoveredYear, 11, 31);

// The annual-update guard (spec §11): once the last covered year's end is at
// most 90 days away, CI must fail until the next year's SKB is added.
function assertCalendarCoverage(today) {
  const todayMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const daysLeft = Math.floor((horizonMs - todayMs) / DAY_MS);
  assert.ok(
    daysLeft > GUARD_WINDOW_DAYS,
    `Add year ${lastCoveredYear + 1} to id-national-holidays.ts — the update needs the official SKB 3 Menteri decree for that year`,
  );
}

test('calendar data parses against CalendarDataSchema', () => {
  const parsed = CalendarDataSchema.parse(ID_NATIONAL_CALENDAR);
  assert.equal(parsed.version, ID_NATIONAL_CALENDAR.version);
});

test('every calendar day carries an ISO date and a known kind', () => {
  for (const [year, entry] of Object.entries(ID_NATIONAL_CALENDAR.years)) {
    assert.ok(entry.days.length > 0, `year ${year} has no days`);
    const seen = new Set();
    for (const day of entry.days) {
      assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/, day.date);
      assert.equal(
        Number.isNaN(Date.parse(`${day.date}T00:00:00Z`)),
        false,
        day.date,
      );
      assert.equal(
        new Date(`${day.date}T00:00:00Z`).toISOString().slice(0, 10),
        day.date,
        `${day.date} must be a real calendar date`,
      );
      assert.ok(
        day.kind === 'holiday' || day.kind === 'cuti_bersama',
        `${day.date} kind ${day.kind}`,
      );
      assert.ok(day.name.trim().length > 0, `${day.date} has no name`);
      assert.equal(day.date.slice(0, 4), year, `${day.date} outside ${year}`);
      assert.equal(seen.has(day.date), false, `duplicate ${day.date}`);
      seen.add(day.date);
    }
  }
});

test('every year cites a decree with non-empty fields and https sources', () => {
  for (const [year, entry] of Object.entries(ID_NATIONAL_CALENDAR.years)) {
    const { decree } = entry;
    assert.ok(
      Array.isArray(decree.numbers) && decree.numbers.length > 0,
      `year ${year} has no decree numbers`,
    );
    for (const number of decree.numbers)
      assert.ok(number.trim().length > 0, `year ${year} empty decree number`);
    assert.match(decree.issued, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(decree.title.trim().length > 0, `year ${year} empty title`);
    assert.ok(decree.sources.length > 0, `year ${year} has no sources`);
    for (const source of decree.sources)
      assert.ok(source.startsWith('https://'), `${year} source ${source}`);
  }
});

test('the 90-day guard passes more than 90 days before the covered horizon', () => {
  // With 2026+2027 covered, 2027-10-01 is 91 days before 2027-12-31 → passes.
  assert.doesNotThrow(() => assertCalendarCoverage(new Date('2027-10-01')));
});

test('the 90-day guard fails 90 days before the covered horizon', () => {
  // With 2026+2027 covered, 2027-10-02 is 90 days before 2027-12-31 → fails.
  assert.throws(
    () => assertCalendarCoverage(new Date('2027-10-02')),
    new RegExp(
      `Add year ${lastCoveredYear + 1} to id-national-holidays\\.ts.*SKB`,
    ),
  );
});

test('the calendar covers a horizon more than 90 days out', () => {
  assertCalendarCoverage(new Date());
});
