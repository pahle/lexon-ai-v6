import { z } from 'zod';

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunErrorCodeSchema = z.enum([
  'AI_BUDGET_EXCEEDED',
  'AI_ATTEMPT_LIMIT',
  'AI_ITERATION_LIMIT',
  'AI_ACCESS_REVOKED',
  'AI_MODEL_FORBIDDEN',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_AUTH',
  'AI_INVALID_TOOL',
  'AI_TOOL_TIMEOUT',
  'AI_TOOL_OUTCOME_UNKNOWN',
  'AI_CAPACITY_EXCEEDED',
  'AI_INTERNAL',
]);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

const identifier = z.string().trim().min(1);
const sequence = z.number().int().positive();
const version = z.number().int().positive();

const runJob = z.strictObject({
  version: z.literal(1),
  type: z.enum(['run.start.v1', 'run.advance.v1', 'run.resume.v1']),
  runId: identifier,
  sequence,
  expectedVersion: version,
});

export const RunJobSchema = z.discriminatedUnion('type', [
  runJob.extend({ type: z.literal('run.start.v1') }),
  runJob.extend({ type: z.literal('run.advance.v1') }),
  runJob.extend({ type: z.literal('run.resume.v1') }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('platform.noop.v1'),
    ctx: z.strictObject({ orgId: z.uuid(), userId: z.uuid().optional() }),
    payload: z.strictObject({ probeId: z.uuid() }),
  }),
]);
export type RunJob = z.infer<typeof RunJobSchema>;

const eventBase = { version: z.literal(1), runId: identifier };
export const RunStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...eventBase, type: z.literal('start'), messageId: identifier }),
  z.strictObject({ ...eventBase, type: z.literal('status'), status: RunStatusSchema }),
  z.strictObject({ ...eventBase, type: z.literal('reset'), sequence }),
  z.strictObject({ ...eventBase, type: z.literal('approval-required'), operationId: identifier }),
  z.strictObject({ ...eventBase, type: z.literal('finish') }),
  z.strictObject({ ...eventBase, type: z.literal('error'), code: RunErrorCodeSchema }),
  z.strictObject({ ...eventBase, type: z.literal('start-step') }),
  z.strictObject({ ...eventBase, type: z.literal('finish-step') }),
  z.strictObject({ ...eventBase, type: z.literal('reset-step') }),
  z.strictObject({ ...eventBase, type: z.literal('text-start'), id: identifier }),
  z.strictObject({ ...eventBase, type: z.literal('text-delta'), id: identifier, delta: z.string() }),
  z.strictObject({ ...eventBase, type: z.literal('text-end'), id: identifier }),
  z.strictObject({ ...eventBase, type: z.literal('tool-input-start'), toolCallId: identifier, toolName: identifier,
    inputEncoding: z.enum(['json', 'text']).optional() }),
  z.strictObject({ ...eventBase, type: z.literal('tool-input-delta'), toolCallId: identifier, inputTextDelta: z.string() }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-input-available'),
    toolCallId: identifier,
    toolName: identifier,
    input: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-approval-request'),
    toolCallId: identifier,
    approvalId: identifier,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-approval-response'),
    approvalId: identifier,
    approved: z.boolean(),
  }),
  z.strictObject({ ...eventBase, type: z.literal('tool-output-available'), toolCallId: identifier, output: z.unknown() }),
  z.strictObject({ ...eventBase, type: z.literal('tool-output-denied'), toolCallId: identifier }),
]);
export type RunStreamEvent = z.infer<typeof RunStreamEventSchema>;
