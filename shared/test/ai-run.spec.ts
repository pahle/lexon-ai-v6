import { describe, expect, it } from 'vitest';
import {
  RunErrorCodeSchema,
  RunJobSchema,
  RunStatusSchema,
  RunStreamEventSchema,
} from '../src/ai-run.js';

describe('run contracts', () => {
  it('reject unversioned or content-bearing jobs', () => {
    const base = {
      version: 1,
      type: 'run.start.v1',
      runId: 'run-1',
      sequence: 1,
      expectedVersion: 1,
    };

    expect(RunJobSchema.safeParse({ ...base, version: undefined }).success).toBe(false);
    expect(RunJobSchema.safeParse({ ...base, prompt: 'caller content' }).success).toBe(false);
    expect(RunJobSchema.safeParse({ ...base, model: 'caller/model' }).success).toBe(false);
    expect(RunJobSchema.safeParse({ ...base, queue: 'caller-queue' }).success).toBe(false);
    expect(RunJobSchema.safeParse({ ...base, priority: 99 }).success).toBe(false);
    expect(RunJobSchema.safeParse(base).success).toBe(true);
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
      'AI_INTERNAL',
    ]);
    expect(RunErrorCodeSchema.safeParse('provider raw error').success).toBe(false);
  });

  it('validates versioned run stream events', () => {
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'status',
        runId: 'run-1',
        status: 'running',
      }).success,
    ).toBe(true);
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'text-delta',
        runId: 'run-1',
        id: 'text-1',
        delta: 'hello',
      }).success,
    ).toBe(true);
    expect(
      RunStreamEventSchema.safeParse({
        version: 1,
        type: 'status',
        runId: 'run-1',
        status: 'running',
        rawError: 'unsafe provider details',
      }).success,
    ).toBe(false);
  });
});
