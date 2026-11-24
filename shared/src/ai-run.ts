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
  'AI_OUTPUT_LIMIT',
  'AI_INTERNAL',
]);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

export const OperationStatusSchema = z.enum([
  'pending',
  'awaiting_approval',
  'approved',
  'rejected',
  'answered',
  'dismissed',
  'expired',
  'completed',
  'failed',
  'outcome_unknown',
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const OperationKindSchema = z.enum(['approval', 'question']);
export type OperationKind = z.infer<typeof OperationKindSchema>;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

// The wire operation summary: `input` is the verbatim args the snapshot hash
// binds, `display` carries server-stamped informational fields that are not
// hash-bound, and `output` is the stored result for decided ops. Under the
// event-byte cap emitters drop `input`/`display`/`output` and keep the
// ids/status/hash core; the client fetches the tree for the rest.
export const ChatOperationSnapshotSchema = z.strictObject({
  operationId: z.uuid(),
  kind: OperationKindSchema,
  status: OperationStatusSchema,
  approvalRequired: z.boolean(),
  snapshotHash: sha256Hex,
  expiresAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  toolName: z.string().trim().min(1).max(256),
  input: z.record(z.string(), z.unknown()).optional(),
  display: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
});
export type ChatOperationSnapshot = z.infer<typeof ChatOperationSnapshotSchema>;

const identifier = z.string().trim().min(1);
const sdkPartId = z.string().min(1).max(256);
const sequence = z.number().int().positive();
const version = z.number().int().positive();
const tenantContext = z.strictObject({ orgId: z.uuid(), userId: z.uuid() });

const runJob = z.strictObject({
  version: z.literal(1),
  type: z.enum(['run.start.v1', 'run.advance.v1', 'run.resume.v1']),
  runId: z.uuid(),
  sequence,
  expectedVersion: version,
  ctx: tenantContext,
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
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('chat.title.v1'),
    ctx: tenantContext,
    payload: z.strictObject({ chatId: z.uuid(), runId: z.uuid() }),
  }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('chat.cleanup.v1'),
    ctx: tenantContext,
    payload: z.strictObject({ chatId: z.uuid() }),
  }),
  // BullMQ-scheduled sweep (upsertJobScheduler): no outbox id and no tenant
  // ctx — the sweep discovers expiring operations cross-tenant per candidate.
  z.strictObject({
    type: z.literal('ai.operation-expiry.v1'),
    data: z.strictObject({}),
  }),
]);
export type RunJob = z.infer<typeof RunJobSchema>;

const eventBase = { version: z.literal(1), runId: z.uuid() };
const RunStreamEventV1Schema = z.discriminatedUnion('type', [
  z.strictObject({
    ...eventBase,
    type: z.literal('start'),
    messageId: z.uuid(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('status'),
    status: RunStatusSchema,
  }),
  z.strictObject({ ...eventBase, type: z.literal('reset'), sequence }),
  z.strictObject({
    ...eventBase,
    type: z.literal('approval-required'),
    operationId: z.uuid(),
    // The kind selects the panel; the cap-fallback sends {operationId, kind}
    // only (old stored events carry neither).
    kind: z.literal('approval').optional(),
    operation: ChatOperationSnapshotSchema.extend({
      kind: z.literal('approval'),
    }).optional(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('question-required'),
    operationId: z.uuid(),
    kind: z.literal('question').optional(),
    operation: ChatOperationSnapshotSchema.extend({
      kind: z.literal('question'),
    }).optional(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('operation-status'),
    operationId: z.uuid(),
    status: OperationStatusSchema,
  }),
  z.strictObject({ ...eventBase, type: z.literal('finish') }),
  z.strictObject({
    ...eventBase,
    type: z.literal('error'),
    code: RunErrorCodeSchema,
  }),
  z.strictObject({ ...eventBase, type: z.literal('start-step') }),
  z.strictObject({ ...eventBase, type: z.literal('finish-step') }),
  z.strictObject({ ...eventBase, type: z.literal('reset-step') }),
  z.strictObject({
    ...eventBase,
    type: z.literal('text-start'),
    id: sdkPartId,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('text-delta'),
    id: sdkPartId,
    delta: z.string(),
  }),
  z.strictObject({ ...eventBase, type: z.literal('text-end'), id: sdkPartId }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-input-start'),
    toolCallId: sdkPartId,
    toolName: identifier,
    inputEncoding: z.enum(['json', 'text']).optional(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-input-delta'),
    toolCallId: sdkPartId,
    inputTextDelta: z.string(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-input-available'),
    toolCallId: sdkPartId,
    toolName: identifier,
    operationId: z.uuid().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-approval-request'),
    toolCallId: sdkPartId,
    approvalId: sdkPartId,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-approval-response'),
    approvalId: sdkPartId,
    approved: z.boolean(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-output-available'),
    toolCallId: sdkPartId,
    operationId: z.uuid().optional(),
    output: z.unknown(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool-output-denied'),
    toolCallId: sdkPartId,
  }),
]);
const runStreamEventV2Schema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(2),
    type: z.literal('reasoning-start'),
    runId: z.uuid(),
    id: sdkPartId,
  }),
  z.strictObject({
    version: z.literal(2),
    type: z.literal('reasoning-delta'),
    runId: z.uuid(),
    id: sdkPartId,
    delta: z.string(),
  }),
  z.strictObject({
    version: z.literal(2),
    type: z.literal('reasoning-end'),
    runId: z.uuid(),
    id: sdkPartId,
    durationMs: z.number().int().nonnegative().safe().nullable(),
  }),
]);
export const RunStreamEventSchema = z.union([
  RunStreamEventV1Schema,
  runStreamEventV2Schema,
]);
export type RunStreamEvent = z.infer<typeof RunStreamEventSchema>;
