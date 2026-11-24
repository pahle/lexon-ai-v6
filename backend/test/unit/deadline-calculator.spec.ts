import { describe, expect, it } from 'vitest';
import {
  calculateDeadline,
  DeadlineCalculatorRefusalError,
  executeDeadlineCalculation,
  type DeadlineCalculatorInput,
} from '../../src/modules/chat/deadline-calculator.js';

const input = (
  overrides: Partial<DeadlineCalculatorInput> = {},
): DeadlineCalculatorInput => ({
  startDate: '2026-12-01',
  amount: 1,
  unit: 'calendar_days',
  countStartDay: false,
  nonWorkingDayRule: 'none',
  ...overrides,
});

describe('deadline calculator', () => {
  describe('calendar_days', () => {
    it('counts every day starting the day after the start date', () => {
      expect(
        calculateDeadline(
          input({ amount: 14, unit: 'calendar_days', countStartDay: false }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-12-15',
          weekday: 'Tuesday',
          skippedDays: [],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('counts the start date itself when countStartDay is set', () => {
      expect(
        calculateDeadline(
          input({ amount: 14, unit: 'calendar_days', countStartDay: true }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-12-14',
          weekday: 'Monday',
          skippedDays: [],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });
  });

  describe('working_days', () => {
    it('counts only working days starting the day after the start date', () => {
      expect(
        calculateDeadline(
          input({ amount: 5, unit: 'working_days', countStartDay: false }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-12-08',
          weekday: 'Tuesday',
          skippedDays: [
            { date: '2026-12-05', name: 'Saturday' },
            { date: '2026-12-06', name: 'Sunday' },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('counts the start date itself when countStartDay is set', () => {
      expect(
        calculateDeadline(
          input({ amount: 5, unit: 'working_days', countStartDay: true }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-12-07',
          weekday: 'Monday',
          skippedDays: [
            { date: '2026-12-05', name: 'Saturday' },
            { date: '2026-12-06', name: 'Sunday' },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('records a non-working start day when countStartDay is set', () => {
      expect(
        calculateDeadline(
          input({
            startDate: '2026-03-21',
            amount: 1,
            unit: 'working_days',
            countStartDay: true,
          }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-03-25',
          weekday: 'Wednesday',
          skippedDays: [
            { date: '2026-03-21', name: 'Idulfitri 1447 H' },
            { date: '2026-03-22', name: 'Idulfitri 1447 H' },
            { date: '2026-03-23', name: 'Idulfitri 1447 H' },
            { date: '2026-03-24', name: 'Idulfitri 1447 H' },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('skips the 2026 Idulfitri cuti bersama week and lists every skipped day', () => {
      expect(
        calculateDeadline(
          input({
            startDate: '2026-03-13',
            amount: 4,
            unit: 'working_days',
            countStartDay: false,
          }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-03-26',
          weekday: 'Thursday',
          skippedDays: [
            { date: '2026-03-14', name: 'Saturday' },
            { date: '2026-03-15', name: 'Sunday' },
            {
              date: '2026-03-18',
              name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)',
            },
            {
              date: '2026-03-19',
              name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)',
            },
            { date: '2026-03-20', name: 'Idulfitri 1447 H' },
            { date: '2026-03-21', name: 'Idulfitri 1447 H' },
            { date: '2026-03-22', name: 'Idulfitri 1447 H' },
            { date: '2026-03-23', name: 'Idulfitri 1447 H' },
            { date: '2026-03-24', name: 'Idulfitri 1447 H' },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });
  });

  describe('months and years', () => {
    it('clamps month addition to the target month last day', () => {
      for (const countStartDay of [false, true]) {
        expect(
          calculateDeadline(
            input({
              startDate: '2026-01-31',
              amount: 1,
              unit: 'months',
              countStartDay,
            }),
          ),
        ).toEqual({
          status: 'succeeded',
          result: {
            deadline: '2026-02-28',
            weekday: 'Saturday',
            skippedDays: [],
            calendarVersion: 'id-national@2027.1',
          },
        });
      }
    });

    it('ignores countStartDay for year addition', () => {
      for (const countStartDay of [false, true]) {
        expect(
          calculateDeadline(
            input({
              startDate: '2026-06-30',
              amount: 1,
              unit: 'years',
              countStartDay,
            }),
          ),
        ).toEqual({
          status: 'succeeded',
          result: {
            deadline: '2027-06-30',
            weekday: 'Wednesday',
            skippedDays: [],
            calendarVersion: 'id-national@2027.1',
          },
        });
      }
    });
  });

  describe('nonWorkingDayRule', () => {
    it('keeps a holiday landing with rule none', () => {
      expect(
        calculateDeadline(
          input({
            startDate: '2026-05-20',
            amount: 7,
            unit: 'calendar_days',
            nonWorkingDayRule: 'none',
          }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-05-27',
          weekday: 'Wednesday',
          skippedDays: [],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('adjusts a holiday landing to the next working day and records the skips', () => {
      expect(
        calculateDeadline(
          input({
            startDate: '2026-05-20',
            amount: 7,
            unit: 'calendar_days',
            nonWorkingDayRule: 'next_working_day',
          }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-05-29',
          weekday: 'Friday',
          skippedDays: [
            { date: '2026-05-27', name: 'Iduladha 1447 H' },
            { date: '2026-05-28', name: 'Iduladha 1447 H' },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('adjusts a weekend landing past Saturday and Sunday', () => {
      expect(
        calculateDeadline(
          input({
            startDate: '2026-12-03',
            amount: 2,
            unit: 'calendar_days',
            nonWorkingDayRule: 'next_working_day',
          }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2026-12-07',
          weekday: 'Monday',
          skippedDays: [
            { date: '2026-12-05', name: 'Saturday' },
            { date: '2026-12-06', name: 'Sunday' },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });

    it('adjusts a year landing past both 2027 year-end holidays', () => {
      expect(
        calculateDeadline(
          input({
            startDate: '2026-12-25',
            amount: 1,
            unit: 'years',
            nonWorkingDayRule: 'next_working_day',
          }),
        ),
      ).toEqual({
        status: 'succeeded',
        result: {
          deadline: '2027-12-27',
          weekday: 'Monday',
          skippedDays: [
            { date: '2027-12-25', name: 'Kelahiran Yesus Kristus' },
            {
              date: '2027-12-26',
              name: 'Isra Mikraj Nabi Muhammad SAW 1449 Hijriah',
            },
          ],
          calendarVersion: 'id-national@2027.1',
        },
      });
    });
  });

  describe('outside the covered calendar years', () => {
    const refused = {
      status: 'failed',
      result: {
        refused: 'outside_calendar_range',
        coveredYears: [2026, 2027],
      },
    };

    it.each([
      [
        'a start date before the covered years',
        input({ startDate: '2025-01-15' }),
      ],
      [
        'a start date after the covered years',
        input({ startDate: '2028-01-10' }),
      ],
      [
        'a calendar_days landing past the covered years',
        input({ startDate: '2027-12-30', amount: 5 }),
      ],
      [
        'a months landing past the covered years',
        input({ startDate: '2027-12-15', amount: 1, unit: 'months' }),
      ],
      [
        'a years landing past the covered years',
        input({ startDate: '2027-06-30', amount: 1, unit: 'years' }),
      ],
      [
        'a working_days count crossing the covered horizon',
        input({ startDate: '2027-12-31', amount: 1, unit: 'working_days' }),
      ],
      [
        'a calendar_days landing on the first day past the horizon',
        input({ startDate: '2027-12-31', amount: 1, unit: 'calendar_days' }),
      ],
    ])('returns a failed op result for %s', (_name, value) => {
      expect(calculateDeadline(value)).toEqual(refused);
    });

    it('execute signals the same refusal as a typed refusal error', async () => {
      const refusal = await executeDeadlineCalculation(
        input({ startDate: '2028-01-10' }),
      ).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(DeadlineCalculatorRefusalError);
      expect((refusal as DeadlineCalculatorRefusalError).refusal).toEqual({
        refused: 'outside_calendar_range',
        coveredYears: [2026, 2027],
      });
    });

    it('execute returns the computed result for covered dates', async () => {
      await expect(
        executeDeadlineCalculation(input({ amount: 14 })),
      ).resolves.toEqual({
        deadline: '2026-12-15',
        weekday: 'Tuesday',
        skippedDays: [],
        calendarVersion: 'id-national@2027.1',
      });
    });
  });
});
