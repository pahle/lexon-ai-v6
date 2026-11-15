import { z } from 'zod';

export const JOB_TITLE_MAX_LENGTH = 80;
export const JobTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(JOB_TITLE_MAX_LENGTH);
export type JobTitle = z.infer<typeof JobTitleSchema>;
