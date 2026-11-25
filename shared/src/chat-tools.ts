import { z } from 'zod';

// Input schemas for the three F5 chat tools (spec §10 + brief decision 8).
// These are advertised to the model as JSON Schema and re-validated
// server-side on every tool proposal — the bounds are the contract.

const askUserOptionSchema = z.strictObject({
  label: z
    .string()
    .min(1)
    .max(80)
    .describe('Short option label shown to the user (max 80 characters).'),
  description: z
    .string()
    .max(140)
    .optional()
    .describe('Optional helper text under the label (max 140 characters).'),
});

const askUserQuestionBase = {
  questionId: z
    .string()
    .min(1)
    .describe(
      'Stable id for this question; echoed back in the answer payload.',
    ),
  text: z
    .string()
    .min(1)
    .max(300)
    .describe('The question shown to the user (max 300 characters).'),
};

const askUserOptionQuestion = (kind: 'single' | 'multiple') =>
  z.strictObject({
    ...askUserQuestionBase,
    kind: z
      .literal(kind)
      .describe(
        kind === 'single'
          ? 'The user picks exactly one option.'
          : 'The user may pick several options.',
      ),
    options: z
      .array(askUserOptionSchema)
      .min(2)
      .max(5)
      .describe('Two to five options the user can pick from.'),
    allowFreeText: z
      .boolean()
      .default(true)
      .describe(
        'Whether the user may also answer in free text. Defaults to true.',
      ),
  });

export const AskUserToolInputSchema = z.strictObject({
  questions: z
    .array(
      z.discriminatedUnion('kind', [
        askUserOptionQuestion('single'),
        askUserOptionQuestion('multiple'),
        z.strictObject({
          ...askUserQuestionBase,
          kind: z
            .literal('text')
            .describe('The user answers in free text; no options.'),
          // Present-but-undefined is allowed; any real value is refused
          // (`z.never()` advertises as `{"not":{}}` in JSON Schema).
          options: z
            .never()
            .optional()
            .describe('Must be absent for text questions.'),
          allowFreeText: z
            .never()
            .optional()
            .describe('Must be absent for text questions.'),
        }),
      ]),
    )
    .min(1)
    .max(5)
    .describe('One to five questions asked together in one panel.'),
});
export type AskUserToolInput = z.infer<typeof AskUserToolInputSchema>;

export const DeadlineCalculatorToolInputSchema = z.strictObject({
  startDate: z.iso
    .date()
    .describe(
      'Start date as ISO YYYY-MM-DD within the covered calendar years.',
    ),
  amount: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .describe('How many units to add; an integer from 1 to 3650.'),
  unit: z
    .enum(['calendar_days', 'working_days', 'months', 'years'])
    .describe(
      'The unit to add: calendar days, working days, months, or years.',
    ),
  countStartDay: z
    .boolean()
    .describe(
      'For calendar_days and working_days only: whether the start date counts as day one. Ignored for months and years.',
    ),
  nonWorkingDayRule: z
    .enum(['next_working_day', 'none'])
    .describe(
      'Whether a result landing on a weekend or holiday moves to the next working day.',
    ),
});
export type DeadlineCalculatorToolInput = z.infer<
  typeof DeadlineCalculatorToolInputSchema
>;

export const RenameChatToolInputSchema = z.strictObject({
  newTitle: z
    .string()
    .trim()
    .min(1)
    .refine((value) => Array.from(value).length <= 120)
    .describe('The new chat title: 1-120 characters after trimming.'),
});
export type RenameChatToolInput = z.infer<typeof RenameChatToolInputSchema>;
