/**
 * Humanized copy for the `deadline_calculator` tool row and its expanded
 * panel: the stored input/output keys stay on the wire, the r17 prototype
 * shows readable labels instead ("Start date", "14 calendar days", "Move to
 * the next working day", "Indonesian national holidays and joint leave
 * days, 2027").
 */

export interface DeadlineField {
  readonly label: string;
  readonly value: string;
  /** The headline result the prototype prints in weight 500. */
  readonly strong?: boolean | undefined;
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  // A calendar date ('2027-08-03') is not an instant: pinning UTC keeps the
  // weekday and day stable in every viewer time zone.
  timeZone: 'UTC',
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "Tuesday, 3 August 2027" — en-GB long form of a stored calendar date. */
export function formatCalendarDate(value: string): string {
  if (!ISO_DATE.test(value)) return value;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return longDate.format(date);
}

const prettify = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());

const UNIT_LABELS: Record<string, string> = {
  calendar_days: 'calendar day',
  working_days: 'working day',
  weeks: 'week',
  months: 'month',
};

const NON_WORKING_RULES: Record<string, string> = {
  next_working_day: 'Move to the next working day',
  previous_working_day: 'Move to the previous working day',
  keep: 'Keep the date as calculated',
};

const CALENDAR_LABELS: Record<string, string> = {
  'id-national': 'Indonesian national holidays and joint leave days',
};

function unitLabel(amount: number, unit: string): string {
  const label = UNIT_LABELS[unit] ?? prettify(unit).toLowerCase();
  return amount === 1 ? label : `${label}s`;
}

function calendarLabel(version: string): string {
  const at = version.indexOf('@');
  const id = at >= 0 ? version.slice(0, at) : version;
  const label = CALENDAR_LABELS[id] ?? prettify(id);
  const year = /(\d{4})/.exec(at >= 0 ? version.slice(at + 1) : version)?.[1];
  return year ? `${label}, ${year}` : label;
}

function skippedLabel(days: readonly unknown[]): string | undefined {
  const parts: string[] = [];
  for (const day of days) {
    if (!day || typeof day !== 'object') {
      parts.push(String(day));
      continue;
    }
    const entry = day as Record<string, unknown>;
    const date =
      typeof entry.date === 'string' ? formatCalendarDate(entry.date) : '';
    const name = typeof entry.name === 'string' ? entry.name : '';
    const label = [date, name].filter(Boolean).join(' · ');
    if (label) parts.push(label);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** The row's inline result, e.g. "Wednesday, 18 August 2027". */
export function deadlineDateLabel(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as Record<string, unknown>;
  if (typeof record.deadline === 'string' && ISO_DATE.test(record.deadline))
    return formatCalendarDate(record.deadline);
  if (typeof record.weekday === 'string' && typeof record.deadline === 'string')
    return `${record.weekday}, ${record.deadline}`;
  if (typeof record.weekday === 'string') return record.weekday;
  return undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function deadlineInputFields(
  input: Record<string, unknown> | undefined,
): DeadlineField[] {
  if (!input) return [];
  const fields: DeadlineField[] = [];
  if (typeof input.startDate === 'string')
    fields.push({
      label: 'Start date',
      value: formatCalendarDate(input.startDate),
    });
  if (typeof input.amount === 'number')
    fields.push({
      label: 'Period',
      value:
        typeof input.unit === 'string'
          ? `${input.amount} ${unitLabel(input.amount, input.unit)}`
          : String(input.amount),
    });
  if (typeof input.countStartDay === 'boolean')
    fields.push({
      label: 'Start day counts',
      value: input.countStartDay ? 'Yes' : 'No',
    });
  if (typeof input.nonWorkingDayRule === 'string')
    fields.push({
      label: 'If it ends on a non-working day',
      value:
        NON_WORKING_RULES[input.nonWorkingDayRule] ??
        prettify(input.nonWorkingDayRule),
    });
  const known = new Set([
    'startDate',
    'amount',
    'unit',
    'countStartDay',
    'nonWorkingDayRule',
  ]);
  for (const [key, value] of Object.entries(input))
    if (!known.has(key))
      fields.push({ label: prettify(key), value: String(value) });
  return fields;
}

export function deadlineResultFields(output: unknown): DeadlineField[] {
  if (!isRecord(output)) return [];
  const fields: DeadlineField[] = [];
  const deadline = deadlineDateLabel(output);
  if (deadline !== undefined)
    fields.push({ label: 'Deadline', value: deadline, strong: true });
  if (Array.isArray(output.skippedDays)) {
    const skipped = skippedLabel(output.skippedDays);
    if (skipped !== undefined)
      fields.push({ label: 'Skipped', value: skipped });
  }
  if (typeof output.calendarVersion === 'string')
    fields.push({
      label: 'Calendar',
      value: calendarLabel(output.calendarVersion),
    });
  const known = new Set([
    'deadline',
    'weekday',
    'skippedDays',
    'calendarVersion',
  ]);
  for (const [key, value] of Object.entries(output))
    if (!known.has(key))
      fields.push({ label: prettify(key), value: String(value) });
  return fields;
}
