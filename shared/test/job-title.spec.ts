import { expect, test } from 'vitest';
import { JOB_TITLE_MAX_LENGTH, JobTitleSchema } from '../src/job-title.js';

test('job title is a trimmed string of 1 to 80 characters', () => {
  expect(JOB_TITLE_MAX_LENGTH).toBe(80);
  expect(JobTitleSchema.parse('  Senior Associate ')).toBe('Senior Associate');
  expect(JobTitleSchema.safeParse('').success).toBe(false);
  expect(JobTitleSchema.safeParse('   ').success).toBe(false);
  expect(JobTitleSchema.parse('a')).toBe('a');
  expect(JobTitleSchema.parse('a'.repeat(80))).toHaveLength(80);
  expect(JobTitleSchema.safeParse('a'.repeat(81)).success).toBe(false);
  expect(JobTitleSchema.safeParse(` ${'a'.repeat(80)} `).success).toBe(true);
  expect(JobTitleSchema.safeParse(42).success).toBe(false);
});
