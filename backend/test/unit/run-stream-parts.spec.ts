import { describe, expect, it } from 'vitest';
import { RunStreamEventSchema } from '@lexon/contracts';
import { encodeStreamParts } from '../../src/infrastructure/queue/index.js';

const base = {
  version: 1 as const,
  runId: '40000000-0000-4000-8000-000000000001',
};

describe('encodeStreamParts', () => {
  it('preserves large text as schema-valid UTF-8 bounded parts', () => {
    const parts = encodeStreamParts({
      ...base,
      type: 'text-delta',
      id: 'part',
      delta: '🙂\\"'.repeat(3000),
    });
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(RunStreamEventSchema.safeParse(part).success).toBe(true);
      expect(
        Buffer.byteLength(JSON.stringify(part), 'utf8'),
      ).toBeLessThanOrEqual(4096);
    }
    expect(
      parts
        .map((part) => (part.type === 'text-delta' ? part.delta : ''))
        .join(''),
    ).toBe('🙂\\"'.repeat(3000));
  });

  it('keeps tool input fragments and available operation metadata', () => {
    const callId = 'sdk-call';
    const fragments = encodeStreamParts({
      ...base,
      type: 'tool-input-delta',
      toolCallId: callId,
      inputTextDelta: '😀'.repeat(5000),
    });
    expect(fragments.every((part) => part.type === 'tool-input-delta')).toBe(
      true,
    );
    expect(
      fragments
        .map((part) =>
          part.type === 'tool-input-delta' ? part.inputTextDelta : '',
        )
        .join(''),
    ).toBe('😀'.repeat(5000));
    const available = encodeStreamParts({
      ...base,
      type: 'tool-input-available',
      toolCallId: callId,
      toolName: 'updateDocument',
      operationId: '40000000-0000-4000-8000-000000000002',
      input: { title: 'approved', nested: { value: '😀' } },
    } as never);
    expect(available).toHaveLength(1);
    expect(JSON.stringify(available[0])).toContain('operationId');
  });

  it('converts a tool whole result into durable operation metadata', () => {
    const parts = encodeStreamParts({
      ...base,
      type: 'tool-output-available',
      toolCallId: 'sdk-call',
      operationId: '40000000-0000-4000-8000-000000000002',
      output: { secretText: 'must not be copied into the stream' },
    });
    expect(parts).toEqual([
      {
        ...base,
        type: 'operation-status',
        operationId: '40000000-0000-4000-8000-000000000002',
        status: 'completed',
      },
    ]);
  });

  it('fragments oversized structured tool input without losing the completion part', () => {
    const event = {
      ...base,
      type: 'tool-input-available' as const,
      toolCallId: 'sdk-call',
      toolName: 'updateDocument',
      operationId: '40000000-0000-4000-8000-000000000002',
      input: { text: '😀\\"'.repeat(3000) },
    };
    const parts = encodeStreamParts(event);
    expect(parts[0]).toMatchObject({
      type: 'tool-input-start',
      toolCallId: 'sdk-call',
    });
    expect(parts.at(-1)).toMatchObject({
      type: 'tool-input-available',
      operationId: event.operationId,
    });
    const json = parts
      .filter((part) => part.type === 'tool-input-delta')
      .map((part) =>
        part.type === 'tool-input-delta' ? part.inputTextDelta : '',
      )
      .join('');
    expect(JSON.parse(json)).toEqual(event.input);
    for (const part of parts) {
      expect(RunStreamEventSchema.safeParse(part).success).toBe(true);
      expect(
        Buffer.byteLength(JSON.stringify(part), 'utf8'),
      ).toBeLessThanOrEqual(4096);
    }
  });

  it('refuses structured values JSON would silently omit', () => {
    expect(() =>
      encodeStreamParts({
        ...base,
        type: 'tool-input-available',
        toolCallId: 'sdk-call',
        toolName: 'updateDocument',
        operationId: '40000000-0000-4000-8000-000000000002',
        input: { required: undefined },
      }),
    ).toThrow('Tool input is not JSON serializable');
  });
});
