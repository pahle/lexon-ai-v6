import { z } from 'zod';

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    issues: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .optional(),
  }),
  requestId: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
