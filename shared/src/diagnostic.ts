import { z } from 'zod';
import { UuidSchema } from './identity.js';

export const DiagnosticInputSchema = z.strictObject({ probeId: UuidSchema });
export const DiagnosticResponseSchema = z.strictObject({
  probeId: UuidSchema,
  accepted: z.literal(true),
});

export type DiagnosticInput = z.infer<typeof DiagnosticInputSchema>;
export type DiagnosticResponse = z.infer<typeof DiagnosticResponseSchema>;
