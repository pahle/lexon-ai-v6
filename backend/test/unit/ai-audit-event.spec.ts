import { describe, expect, it } from 'vitest';
import { validateAuditEvent } from '../../src/modules/audit/audit-event.js';

const base = {
  version: 1 as const,
  eventId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-11-07T00:00:00.000Z',
  orgId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '33333333-3333-4333-8333-333333333333',
};

describe('AI audit events', () => {
  it('accepts the safe run, tool, and approval event contracts', () => {
    const events = [
      {
        ...base,
        type: 'chat.run_started.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          model: 'openai/gpt-6-luna',
          provider: 'azure/us',
          status: 'started',
        },
      },
      {
        ...base,
        type: 'chat.run_finished.v1',
        outcome: 'failure',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          model: 'openai/gpt-6-luna',
          provider: 'azure/us',
          status: 'failed',
          safeCode: 'AI_PROVIDER_UNAVAILABLE',
        },
      },
      {
        ...base,
        type: 'chat.tool_operation.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          stepId: '55555555-5555-4555-8555-555555555555',
          operationId: '66666666-6666-4666-8666-666666666666',
          model: 'openai/gpt-6-luna',
          provider: 'azure/us',
          status: 'pending',
        },
      },
      {
        ...base,
        type: 'chat.approval_decided.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'approved',
        },
      },
    ];
    expect(events.map(validateAuditEvent)).toHaveLength(4);
  });

  it('accepts the question decision contract', () => {
    const events = [
      {
        ...base,
        type: 'chat.question_decided.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'answered',
        },
      },
      {
        ...base,
        type: 'chat.question_decided.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'dismissed',
          reason: 'superseded_by_message',
        },
      },
      {
        version: 1 as const,
        eventId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-11-07T00:00:00.000Z',
        orgId: '22222222-2222-4222-8222-222222222222',
        type: 'chat.question_decided.v1',
        outcome: 'failure',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'expired',
        },
      },
    ];
    expect(events.map(validateAuditEvent)).toHaveLength(3);
  });

  it('accepts an expired approval with the superseded reason and no actor', () => {
    const events = [
      {
        version: 1 as const,
        eventId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-11-07T00:00:00.000Z',
        orgId: '22222222-2222-4222-8222-222222222222',
        type: 'chat.approval_decided.v1',
        outcome: 'failure',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'expired',
        },
      },
      {
        ...base,
        type: 'chat.approval_decided.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'rejected',
          reason: 'superseded_by_message',
        },
      },
    ];
    expect(events.map(validateAuditEvent)).toHaveLength(2);
  });

  it('accepts the widened tool operation statuses', () => {
    for (const [status, outcome] of [
      ['answered', 'success'],
      ['dismissed', 'success'],
      ['expired', 'failure'],
    ] as const) {
      expect(
        validateAuditEvent({
          ...base,
          type: 'chat.tool_operation.v1',
          outcome,
          metadata: {
            runId: '44444444-4444-4444-8444-444444444444',
            stepId: '55555555-5555-4555-8555-555555555555',
            operationId: '66666666-6666-4666-8666-666666666666',
            model: 'openai/gpt-6-luna',
            provider: 'azure/us',
            status,
          },
        }).type,
      ).toBe('chat.tool_operation.v1');
    }
  });

  it('keeps K1 content keys out of every operation audit event', () => {
    for (const [type, metadata] of [
      [
        'chat.question_decided.v1',
        {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'answered',
        },
      ],
      [
        'chat.approval_decided.v1',
        {
          runId: '44444444-4444-4444-8444-444444444444',
          operationId: '66666666-6666-4666-8666-666666666666',
          status: 'approved',
        },
      ],
      [
        'chat.tool_operation.v1',
        {
          runId: '44444444-4444-4444-8444-444444444444',
          stepId: '55555555-5555-4555-8555-555555555555',
          operationId: '66666666-6666-4666-8666-666666666666',
          model: 'openai/gpt-6-luna',
          provider: 'azure/us',
          status: 'pending',
        },
      ],
    ] as const) {
      for (const k1 of ['question', 'title', 'args', 'result']) {
        expect(() =>
          validateAuditEvent({
            ...base,
            type,
            outcome: 'success',
            metadata: { ...metadata, [k1]: 'HOSTILE_AUDIT_SENTINEL' },
          }),
        ).toThrow('Invalid audit event');
      }
    }
  });

  it('rejects prompt content and unknown metadata on AI audit events', () => {
    expect(() =>
      validateAuditEvent({
        ...base,
        type: 'chat.run_started.v1',
        outcome: 'success',
        metadata: {
          runId: '44444444-4444-4444-8444-444444444444',
          model: 'openai/gpt-6-luna',
          provider: 'azure/us',
          status: 'started',
          prompt: 'HOSTILE_AUDIT_PROMPT_SENTINEL',
        },
      }),
    ).toThrow('Invalid audit event');
  });
});
