import { z } from 'zod';
import { JobTitleSchema } from '@lexon/contracts';

export const accountProfileBodySchema = z
  .object({
    userId: z.uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    jobTitle: JobTitleSchema.nullable().optional(),
    completeOnboarding: z.literal(true).optional(),
  })
  .strict();
