import { z } from 'zod';
import type { DiagnosticInput, DiagnosticResponse } from './diagnostic.js';

export const HealthResponseSchema = z.strictObject({
  status: z.enum(['ok', 'unavailable']),
  version: z.string().min(1),
  dependencies: z.record(z.string(), z.enum(['up', 'down'])),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export interface FoundationApi {
  health(): Promise<HealthResponse>;
  diagnose(input: DiagnosticInput): Promise<DiagnosticResponse>;
}
