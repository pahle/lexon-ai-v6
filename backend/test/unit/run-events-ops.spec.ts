import { describe, expect, it } from 'vitest';
import {
  ChatOperationSnapshotSchema,
  ChatSnapshotFrameSchema,
  RunStreamEventSchema,
} from '@lexon/contracts';
import {
  capRequiredEvent,
  capSnapshotOperation,
  encodeStreamParts,
} from '../../src/infrastructure/queue/run-stream-parts.js';

const runId = '40000000-0000-4000-8000-000000000001';
const operationId = '50000000-0000-4000-8000-000000000002';
const sha = 'a'.repeat(64);

// §9 byte-cap fallback: a maximal ask_user payload (Indonesian, multibyte —
// the 4096 bound is BYTES, not characters) keeps ids/status/hash on every
// artifact while dropping the oversized blocks.
const multibyteQuestions = {
  questions: Array.from({ length: 5 }, (_, index) => ({
    questionId: `q${index}`,
    text:
      'Apakah penggugat berhak mengajukan gugatan pembatalan kontrak ' +
      'berdasarkan Pasal 1320 KUHPerdata — §'.repeat(40),
    kind: 'text' as const,
  })),
};

const oversizedOperation = ChatOperationSnapshotSchema.parse({
  operationId,
  kind: 'question',
  status: 'awaiting_approval',
  approvalRequired: true,
  snapshotHash: sha,
  expiresAt: '2026-01-01T01:00:00Z',
  decidedAt: null,
  toolName: 'ask_user',
  input: multibyteQuestions,
  display: { note: 'y'.repeat(2000) },
  output: { pad: 'z'.repeat(2000) },
});

expect(
  Buffer.byteLength(JSON.stringify(oversizedOperation.input), 'utf8'),
).toBeGreaterThan(4096);

describe('byte-cap fallback (spec §9)', () => {
  it('snapshot-operation drops input/display/output and keeps ids, status and hash', () => {
    const frame = capSnapshotOperation(oversizedOperation, 0);
    const parsed = ChatSnapshotFrameSchema.parse(frame);
    expect(parsed).toMatchObject({ type: 'snapshot-operation', index: 0 });
    const operation = (parsed as { operation: Record<string, unknown> })
      .operation;
    expect(operation).toMatchObject({
      operationId,
      toolName: 'ask_user',
      status: 'awaiting_approval',
      snapshotHash: sha,
    });
    expect(operation).not.toHaveProperty('input');
    expect(operation).not.toHaveProperty('display');
    expect(operation).not.toHaveProperty('output');
    expect(
      Buffer.byteLength(JSON.stringify(frame), 'utf8'),
    ).toBeLessThanOrEqual(4096);
  });

  it('snapshot-operation keeps the full operation when it fits', () => {
    const small = {
      ...oversizedOperation,
      input: { newTitle: 'T' },
      display: { currentTitle: 'Old' },
      output: { renamed: true },
    };
    const frame = capSnapshotOperation(small, 0);
    const parsed = ChatSnapshotFrameSchema.parse(frame) as {
      operation: { input?: unknown };
    };
    expect(parsed.operation.input).toEqual({ newTitle: 'T' });
  });

  it('question-required drops the operation summary to {operationId,kind}', () => {
    const events = capRequiredEvent({
      version: 1,
      runId,
      type: 'question-required',
      operationId,
      kind: 'question',
      operation: { ...oversizedOperation, kind: 'question' as const },
    });
    for (const event of events) {
      const parsed = RunStreamEventSchema.parse(event);
      expect(
        Buffer.byteLength(JSON.stringify(parsed), 'utf8'),
      ).toBeLessThanOrEqual(4096);
    }
    const required = events.at(-1)! as Record<string, unknown>;
    expect(required).toMatchObject({
      type: 'question-required',
      operationId,
      kind: 'question',
    });
    expect(required).not.toHaveProperty('operation');
  });

  it('approval-required keeps the operation summary when the frame fits', () => {
    const fitting = {
      ...oversizedOperation,
      kind: 'approval' as const,
      input: { newTitle: 'T' },
      display: { currentTitle: 'Old' },
      output: undefined,
    };
    const events = capRequiredEvent({
      version: 1,
      runId,
      type: 'approval-required',
      operationId,
      kind: 'approval',
      operation: fitting,
    });
    const required = events.at(-1)! as {
      operation?: { operationId?: string };
    };
    expect(required.operation).toMatchObject({ operationId });
  });

  it('tool-input-available for the same payload emits an available frame without the input block', () => {
    const events = encodeStreamParts({
      version: 1,
      runId,
      type: 'tool-input-available',
      toolCallId: operationId,
      toolName: 'ask_user',
      operationId,
      input: multibyteQuestions,
    });
    const available = events.filter(
      (event) => event.type === 'tool-input-available',
    );
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      toolCallId: operationId,
      toolName: 'ask_user',
      operationId,
    });
    expect((available[0] as { input?: unknown }).input).toBeUndefined();
    for (const event of events) {
      expect(
        Buffer.byteLength(JSON.stringify(event), 'utf8'),
      ).toBeLessThanOrEqual(4096);
      expect(RunStreamEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('tool-output-available oversized drops output and keeps ids instead of rewriting to operation-status', () => {
    const events = encodeStreamParts({
      version: 1,
      runId,
      type: 'tool-output-available',
      toolCallId: operationId,
      operationId,
      output: { verdict: 'x'.repeat(8192) },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: operationId,
      operationId,
    });
    expect((events[0] as { output?: unknown }).output).toBeUndefined();
  });

  it('tool-output-available keeps a fitting output payload', () => {
    const events = encodeStreamParts({
      version: 1,
      runId,
      type: 'tool-output-available',
      toolCallId: operationId,
      operationId,
      output: { renamed: true, previousTitle: 'Old' },
    });
    expect(events).toEqual([
      {
        version: 1,
        runId,
        type: 'tool-output-available',
        toolCallId: operationId,
        operationId,
        output: { renamed: true, previousTitle: 'Old' },
      },
    ]);
  });
});

describe('snapshot-part tool frames (spec §9 tool replay)', () => {
  it('the snapshot-part frame schema accepts a tool part payload', () => {
    const parsed = ChatSnapshotFrameSchema.safeParse({
      version: 1,
      type: 'snapshot-part',
      partIndex: 1,
      chunkIndex: 0,
      partType: 'tool',
      id: operationId,
      toolCallId: operationId,
      toolName: 'ask_user',
      operationId,
      input: { questions: [] },
      outcome: 'awaiting_approval',
      final: true,
    });
    expect(parsed.success).toBe(true);
  });
});
