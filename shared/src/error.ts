import { z } from 'zod';
import { RunErrorCodeSchema } from './ai-run.js';

export const ChatErrorCodeSchema = z.enum(['CHAT_CONFLICT', 'CHAT_NOT_FOUND']);
export type ChatErrorCode = z.infer<typeof ChatErrorCodeSchema>;

export const SafeErrorCodeSchema = z.union([
  RunErrorCodeSchema,
  ChatErrorCodeSchema,
]);
export type SafeErrorCode = z.infer<typeof SafeErrorCodeSchema>;

export const SafeErrorMessages = {
  AI_BUDGET_EXCEEDED: 'This request exceeds the available AI budget.',
  AI_ATTEMPT_LIMIT: 'The AI could not complete this request. Please try again.',
  AI_ITERATION_LIMIT:
    'The AI could not complete this request. Please try again.',
  AI_ACCESS_REVOKED: 'Your access changed. Refresh and try again.',
  AI_MODEL_FORBIDDEN: 'This AI model is unavailable for this request.',
  AI_PROVIDER_UNAVAILABLE:
    'The AI service is temporarily unavailable. Please try again.',
  AI_PROVIDER_AUTH:
    'The AI service is temporarily unavailable. Please try again.',
  AI_INVALID_TOOL: 'The AI could not complete this request. Please try again.',
  AI_TOOL_TIMEOUT: 'The AI could not complete this request. Please try again.',
  AI_TOOL_OUTCOME_UNKNOWN:
    'The AI could not complete this request. Please try again.',
  AI_CAPACITY_EXCEEDED: 'The AI service is busy. Please try again shortly.',
  AI_OUTPUT_LIMIT: 'The response reached its length limit. Please try again.',
  AI_INTERNAL: 'The AI could not complete this request. Please try again.',
  CHAT_CONFLICT:
    'This chat is busy. Try again when the current answer finishes.',
  CHAT_NOT_FOUND: 'Chat not found.',
} as const satisfies Record<SafeErrorCode, string>;

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
