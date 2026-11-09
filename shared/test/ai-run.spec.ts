import { describe, expect, it } from 'vitest';
import {
  OperationStatusSchema,
  RunErrorCodeSchema,
  RunJobSchema,
  RunStatusSchema,
  RunStreamEventSchema,
} from '../src/ai-run.js';

describe('run contracts', () => {
  const orgId = '00000000-0000-4000-8000-000000000011';
  const userId = '00000000-0000-4000-8000-000000000012';
  const runId = '00000000-0000-4000-8000-000000000013';
  const operationId = '00000000-0000-4000-8000-000000000014';
  const ctx = { orgId, userId };

  it('requires a strict UUID tenant context and UUID run id for every run job', () => {
    for (const type of [
      'run.start.v1',
      'run.advance.v1',
      'run.resume.v1',
    ] as const) {
      const job = {
        version: 1,
        type,
        runId,
        sequence: 1,
        expectedVersion: 1,
        ctx,
      };
      expect(RunJobSchema.safeParse(job).success).toBe(true);
      expect(RunJobSchema.safeParse({ ...job, ctx: undefined }).success).toBe(
        false,
      );
      expect(RunJobSchema.safeParse({ ...job, ctx: { orgId } }).success).toBe(
        false,
      );
      expect(
        RunJobSchema.safeParse({ ...job, ctx: { orgId, userId: 'bad' } })
          .success,
      ).toBe(false);
      expect(
        RunJobSchema.safeParse({ ...job, ctx: { orgId: 'bad', userId } })
          .success,
      ).toBe(false);
      expect(
        RunJobSchema.safeParse({
          ...job,
          ctx: { orgId, userId, role: 'owner' },
        }).success,
      ).toBe(false);
      expect(RunJobSchema.safeParse({ ...job, runId: 'run-1' }).success).toBe(
        false,
      );
    }
  });

  it('requires Lexon-generated message and operation ids to be UUIDs', () => {
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'start',
        runId,
        messageId: operationId,
      }).success,
    ).toBe(true);
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'start',
        runId,
        messageId: 'sdk-message',
      }).success,
    ).toBe(false);
    for (const type of ['approval-required', 'operation-status'] as const) {
      const event =
        type === 'approval-required'
          ? { version: 1, type, runId, operationId }
          : { version: 1, type, runId, operationId, status: 'pending' };
      expect(RunStreamEventSchema.safeParse(event).success).toBe(true);
      expect(
        RunStreamEventSchema.safeParse({ ...event, operationId: 'op-1' })
          .success,
      ).toBe(false);
    }
  });

  it('preserves bounded opaque SDK part ids without trimming', () => {
    const sdkId = ' sdk:text/α ';
    const event = { version: 1, type: 'text-start', runId, id: sdkId };
    const parsed = RunStreamEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ id: sdkId });
    expect(
      RunStreamEventSchema.safeParse({ ...event, id: 'x'.repeat(257) }).success,
    ).toBe(false);
    expect(RunStreamEventSchema.safeParse({ ...event, id: '' }).success).toBe(
      false,
    );
    const sdkApprovalId = ' sdk:approval/α ';
    const toolEvent = {
      version: 1,
      type: 'tool-approval-request',
      runId,
      toolCallId: sdkId,
      approvalId: sdkApprovalId,
    };
    const parsedTool = RunStreamEventSchema.safeParse(toolEvent);
    expect(parsedTool.success).toBe(true);
    if (parsedTool.success)
      expect(parsedTool.data).toMatchObject({
        toolCallId: sdkId,
        approvalId: sdkApprovalId,
      });
    expect(
      RunStreamEventSchema.safeParse({
        ...toolEvent,
        toolCallId: 'x'.repeat(257),
      }).success,
    ).toBe(false);
    expect(
      RunStreamEventSchema.safeParse({
        ...toolEvent,
        approvalId: 'x'.repeat(257),
      }).success,
    ).toBe(false);
  });

  it('reject unversioned or content-bearing jobs', () => {
    const base = {
      version: 1,
      type: 'run.start.v1',
      runId,
      sequence: 1,
      expectedVersion: 1,
      ctx,
    };

    expect(RunJobSchema.safeParse(base).success).toBe(true);
    expect(
      RunJobSchema.safeParse({ ...base, version: undefined }).success,
    ).toBe(false);
    expect(
      RunJobSchema.safeParse({ ...base, prompt: 'caller content' }).success,
    ).toBe(false);
    expect(
      RunJobSchema.safeParse({ ...base, model: 'caller/model' }).success,
    ).toBe(false);
    expect(
      RunJobSchema.safeParse({ ...base, queue: 'caller-queue' }).success,
    ).toBe(false);
    expect(RunJobSchema.safeParse({ ...base, priority: 99 }).success).toBe(
      false,
    );
  });

  it('keeps the existing platform no-op envelope compatible', () => {
    expect(
      RunJobSchema.safeParse({
        outboxId: '00000000-0000-4000-8000-000000000001',
        type: 'platform.noop.v1',
        ctx: { orgId: '00000000-0000-4000-8000-000000000002' },
        payload: { probeId: '00000000-0000-4000-8000-000000000003' },
      }).success,
    ).toBe(true);
  });

  it('validates strict title and cleanup jobs with ID-only payloads', () => {
    const title = {
      outboxId: '00000000-0000-4000-8000-000000000021',
      type: 'chat.title.v1',
      ctx,
      payload: {
        chatId: '00000000-0000-4000-8000-000000000022',
        runId,
      },
    };
    const cleanup = {
      outboxId: '00000000-0000-4000-8000-000000000023',
      type: 'chat.cleanup.v1',
      ctx,
      payload: { chatId: '00000000-0000-4000-8000-000000000022' },
    };
    expect(RunJobSchema.safeParse(title).success).toBe(true);
    expect(RunJobSchema.safeParse(cleanup).success).toBe(true);
    expect(
      RunJobSchema.safeParse({
        ...title,
        payload: { ...title.payload, prompt: 'private user text' },
      }).success,
    ).toBe(false);
    expect(
      RunJobSchema.safeParse({
        ...cleanup,
        ctx: { orgId },
      }).success,
    ).toBe(false);
  });

  it('covers all seven run statuses and finite safe codes', () => {
    expect(RunStatusSchema.options).toEqual([
      'queued',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ]);
    expect(RunErrorCodeSchema.options).toEqual([
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
    expect(RunErrorCodeSchema.safeParse('provider raw error').success).toBe(
      false,
    );
  });

  it('validates versioned run stream events', () => {
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'status',
        runId,
        status: 'running',
      }).success,
    ).toBe(true);
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'text-delta',
        runId,
        id: 'text-1',
        delta: 'hello',
      }).success,
    ).toBe(true);
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'status',
        runId,
        status: 'running',
        rawError: 'unsafe provider details',
      }).success,
    ).toBe(false);
  });

  it('decodes historical v1 events and v2 reasoning events without provider metadata', () => {
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'text-delta',
        runId,
        id: 'text-1',
        delta: 'historical',
      }).success,
    ).toBe(true);
    for (const event of [
      { version: 2, type: 'reasoning-start', runId, id: 'reasoning-1' },
      {
        version: 2,
        type: 'reasoning-delta',
        runId,
        id: 'reasoning-1',
        delta: 'summary fragment',
      },
      { version: 2, type: 'reasoning-end', runId, id: 'reasoning-1' },
    ])
      expect(RunStreamEventSchema.safeParse(event).success).toBe(true);
    expect(
      RunStreamEventSchema.safeParse({
        version: 2,
        type: 'reasoning-delta',
        runId,
        id: 'reasoning-1',
        delta: 'summary',
        providerMetadata: { reasoning: 'raw payload' },
      }).success,
    ).toBe(false);
  });

  it('validates stable operation status events with finite safe outcomes', () => {
    const statuses = [
      'pending',
      'awaiting_approval',
      'approved',
      'rejected',
      'completed',
      'failed',
      'outcome_unknown',
    ] as const;
    for (const status of statuses) {
      expect(OperationStatusSchema.safeParse(status).success).toBe(true);
      expect(
        RunStreamEventSchema.safeParse({
          version: 1,
          type: 'operation-status',
          runId,
          operationId: '00000000-0000-4000-8000-000000000004',
          status,
        }).success,
      ).toBe(true);
    }
    expect(OperationStatusSchema.safeParse('provider_error').success).toBe(
      false,
    );
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'operation-status',
        runId,
        status: 'outcome_unknown',
      }).success,
    ).toBe(false);
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'operation-status',
        runId,
        operationId: '00000000-0000-4000-8000-000000000004',
        status: 'outcome_unknown',
        rawError: 'raw provider exception',
      }).success,
    ).toBe(false);
  });
});
