import { z } from 'zod';
import { ID_NATIONAL_CALENDAR, type CalendarData } from '@lexon/contracts';

// `deadline_calculator` tool implementation (spec §10) — pure date arithmetic
// on the Indonesian national calendar (shared/src/calendar). Non-working days
// are Saturdays, Sundays, and every SKB holiday and cuti bersama day.
//
// Surface contract for task 4's registration:
// - `calculateDeadline` is the pure core: a refusal is the discriminated
//   outcome `{status:'failed', result:{refused:'outside_calendar_range',
//   coveredYears}}` — a `failed` op result, never a throw past the module
//   boundary (approach F).
// - `executeDeadlineCalculation` is the registerable `execute`: it returns the
//   bare result on success and throws `DeadlineCalculatorRefusalError` for a
//   refusal — the typed refusal the engine persists as the `failed` op result
//   (the same "safe error the model can see" contract as the F3 timeout path).
//   Input outside the documented contract throws a plain Error (a wiring bug —
//   the registered Zod schema makes it unreachable in production).

const DAY_MS = 86_400_000;
const MAX_AMOUNT = 3650;
const UNITS = ['calendar_days', 'working_days', 'months', 'years'] as const;
const NON_WORKING_DAY_RULES = ['next_working_day', 'none'] as const;
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const isoDate = z.iso.date();

export type DeadlineCalculatorUnit = (typeof UNITS)[number];
export type NonWorkingDayRule = (typeof NON_WORKING_DAY_RULES)[number];

export interface DeadlineCalculatorInput {
  readonly startDate: string;
  readonly amount: number;
  readonly unit: DeadlineCalculatorUnit;
  readonly countStartDay: boolean;
  readonly nonWorkingDayRule: NonWorkingDayRule;
}

export interface DeadlineSkippedDay {
  readonly date: string;
  readonly name: string;
}

export interface DeadlineCalculatorResult {
  readonly deadline: string;
  readonly weekday: string;
  readonly skippedDays: readonly DeadlineSkippedDay[];
  readonly calendarVersion: string;
}

export interface DeadlineCalculatorRefusal {
  readonly refused: 'outside_calendar_range';
  readonly coveredYears: readonly number[];
}

export type DeadlineCalculatorOutcome =
  | {
      readonly status: 'succeeded';
      readonly result: DeadlineCalculatorResult;
    }
  | {
      readonly status: 'failed';
      readonly result: DeadlineCalculatorRefusal;
    };

/** Carries the safe refusal result the engine stores on the `failed` op. */
export class DeadlineCalculatorRefusalError extends Error {
  readonly refusal: DeadlineCalculatorRefusal;
  constructor(refusal: DeadlineCalculatorRefusal) {
    super(refusal.refused);
    this.name = 'DeadlineCalculatorRefusalError';
    this.refusal = refusal;
  }
}

function assertDeadlineCalculatorInput(
  input: unknown,
): asserts input is DeadlineCalculatorInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Invalid deadline calculator input');
  const value = input as Record<string, unknown>;
  if (
    typeof value.startDate !== 'string' ||
    !isoDate.safeParse(value.startDate).success ||
    !Number.isSafeInteger(value.amount) ||
    (value.amount as number) < 1 ||
    (value.amount as number) > MAX_AMOUNT ||
    !UNITS.includes(value.unit as DeadlineCalculatorUnit) ||
    typeof value.countStartDay !== 'boolean' ||
    !NON_WORKING_DAY_RULES.includes(
      value.nonWorkingDayRule as NonWorkingDayRule,
    )
  )
    throw new Error('Invalid deadline calculator input');
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addMonthsClamped(startMs: number, months: number): number {
  const start = new Date(startMs);
  const target = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay));
}

export function calculateDeadline(
  input: DeadlineCalculatorInput,
  calendar: CalendarData = ID_NATIONAL_CALENDAR,
): DeadlineCalculatorOutcome {
  assertDeadlineCalculatorInput(input);
  const coveredYears = Object.keys(calendar.years)
    .map(Number)
    .filter(Number.isSafeInteger)
    .sort((a, b) => a - b);
  const firstYear = coveredYears[0];
  const lastYear = coveredYears[coveredYears.length - 1];
  if (firstYear === undefined || lastYear === undefined)
    throw new Error('Calendar data covers no years');
  const minCovered = Date.UTC(firstYear, 0, 1);
  const maxCovered = Date.UTC(lastYear, 11, 31);
  const namedDays = new Map<string, string>();
  for (const year of Object.values(calendar.years))
    for (const day of year.days) namedDays.set(day.date, day.name);
  const refused = (): DeadlineCalculatorOutcome => ({
    status: 'failed',
    result: { refused: 'outside_calendar_range', coveredYears },
  });
  // A calendar-listed day keeps its decree name even when it coincides with a
  // weekend — the decree name is the more specific reason the day is skipped.
  const nonWorkingName = (ms: number): string | null => {
    const name = namedDays.get(toIsoDate(ms));
    if (name !== undefined) return name;
    const day = new Date(ms).getUTCDay();
    if (day === 6) return 'Saturday';
    if (day === 0) return 'Sunday';
    return null;
  };

  const startMs = Date.parse(`${input.startDate}T00:00:00Z`);
  if (startMs < minCovered || startMs > maxCovered) return refused();

  const skippedDays: DeadlineSkippedDay[] = [];
  let landing: number;
  switch (input.unit) {
    case 'calendar_days': {
      // Day 0 is the start date or the day after, per countStartDay.
      landing =
        startMs +
        (input.countStartDay ? input.amount - 1 : input.amount) * DAY_MS;
      if (landing < minCovered || landing > maxCovered) return refused();
      break;
    }
    case 'working_days': {
      let cursor = startMs + (input.countStartDay ? 0 : 1) * DAY_MS;
      let counted = 0;
      let found: number | null = null;
      while (found === null) {
        if (cursor > maxCovered) return refused();
        const name = nonWorkingName(cursor);
        if (name === null) {
          counted += 1;
          if (counted === input.amount) found = cursor;
        } else {
          skippedDays.push({ date: toIsoDate(cursor), name });
        }
        cursor += DAY_MS;
      }
      landing = found;
      break;
    }
    case 'months':
    case 'years': {
      // countStartDay is ignored: the anchor is always the start date, and the
      // day-of-month clamps to the target month's last day.
      landing = addMonthsClamped(
        startMs,
        input.amount * (input.unit === 'years' ? 12 : 1),
      );
      if (landing < minCovered || landing > maxCovered) return refused();
      break;
    }
  }

  if (input.nonWorkingDayRule === 'next_working_day') {
    let cursor = landing;
    for (;;) {
      if (cursor > maxCovered) return refused();
      const name = nonWorkingName(cursor);
      if (name === null) break;
      skippedDays.push({ date: toIsoDate(cursor), name });
      cursor += DAY_MS;
    }
    landing = cursor;
  }

  return {
    status: 'succeeded',
    result: {
      deadline: toIsoDate(landing),
      weekday: WEEKDAYS[new Date(landing).getUTCDay()]!,
      skippedDays,
      calendarVersion: calendar.version,
    },
  };
}

export async function executeDeadlineCalculation(
  input: unknown,
): Promise<DeadlineCalculatorResult> {
  const outcome = calculateDeadline(input as DeadlineCalculatorInput);
  if (outcome.status === 'failed')
    throw new DeadlineCalculatorRefusalError(outcome.result);
  return outcome.result;
}
