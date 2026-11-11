import { z } from 'zod';
import type { TenantSession } from './tenant-session.js';

export type JobQueue = 'ai-interactive' | 'ai-batch';

export function isJobQueue(value: unknown): value is JobQueue {
  return value === 'ai-interactive' || value === 'ai-batch';
}

const contextSchema = z.strictObject({
  orgId: z.uuid(),
  userId: z.uuid().optional(),
});
const runContextSchema = z.strictObject({ orgId: z.uuid(), userId: z.uuid() });
const stepPayloadSchema = z.strictObject({
  runId: z.uuid(),
  sequence: z.number().int().positive().safe(),
  expectedVersion: z.number().int().positive().safe(),
});
const schema = z.discriminatedUnion('type', [
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('platform.noop.v1'),
    ctx: contextSchema,
    payload: z.strictObject({ probeId: z.uuid() }),
  }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('run.start.v1'),
    ctx: runContextSchema,
    payload: stepPayloadSchema,
  }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('run.advance.v1'),
    ctx: runContextSchema,
    payload: stepPayloadSchema,
  }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('run.resume.v1'),
    ctx: runContextSchema,
    payload: stepPayloadSchema,
  }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('chat.title.v1'),
    ctx: runContextSchema,
    payload: z.strictObject({ chatId: z.uuid(), runId: z.uuid() }),
  }),
  z.strictObject({
    outboxId: z.uuid(),
    type: z.literal('chat.cleanup.v1'),
    ctx: runContextSchema,
    payload: z.strictObject({
      chatId: z.uuid(),
      phase: z.enum(['grace', 'purge_db', 'purge_valkey']).optional(),
    }),
  }),
]);
export type JobEnvelope = Readonly<
  | {
      outboxId: string;
      type: 'platform.noop.v1';
      ctx: Readonly<{ orgId: string; userId?: string }>;
      payload: Readonly<{ probeId: string }>;
    }
  | {
      outboxId: string;
      type: 'run.start.v1' | 'run.advance.v1' | 'run.resume.v1';
      ctx: Readonly<{ orgId: string; userId: string }>;
      payload: Readonly<{
        runId: string;
        sequence: number;
        expectedVersion: number;
      }>;
    }
  | {
      outboxId: string;
      type: 'chat.title.v1';
      ctx: Readonly<{ orgId: string; userId: string }>;
      payload: Readonly<{ chatId: string; runId: string }>;
    }
  | {
      outboxId: string;
      type: 'chat.cleanup.v1';
      ctx: Readonly<{ orgId: string; userId: string }>;
      payload: Readonly<{
        chatId: string;
        phase?: 'grace' | 'purge_db' | 'purge_valkey';
      }>;
    }
>;

export type RunStepJobEnvelope = Extract<
  JobEnvelope,
  { type: 'run.start.v1' | 'run.advance.v1' | 'run.resume.v1' }
>;

export function isRunStepJob(job: JobEnvelope): job is RunStepJobEnvelope {
  return (
    job.type === 'run.start.v1' ||
    job.type === 'run.advance.v1' ||
    job.type === 'run.resume.v1'
  );
}

export function parseJobEnvelope(input: unknown): JobEnvelope {
  const result = schema.safeParse(input);
  // Zod issues can contain input values. Never expose them for queue metadata.
  if (!result.success) throw new Error('Invalid job envelope');
  const { outboxId, type, ctx } = result.data;
  const payload =
    result.data.type === 'chat.cleanup.v1'
      ? { ...result.data.payload, phase: result.data.payload.phase ?? 'grace' }
      : result.data.payload;
  return Object.freeze({
    outboxId,
    type,
    ctx: Object.freeze({
      orgId: ctx.orgId,
      ...(ctx.userId === undefined ? {} : { userId: ctx.userId }),
    }),
    payload: Object.freeze(payload),
  }) as JobEnvelope;
}

export type TenantJobHandler = (
  tx: TenantSession,
  job: JobEnvelope,
) => Promise<void>;
