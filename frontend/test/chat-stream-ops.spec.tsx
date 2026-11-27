import { expect, it, vi } from 'vitest';
import type {
  ChatStreamHandlers,
  UIMessageChunk,
} from '../src/lib/chat-stream.js';

const runId = '33333333-3333-4333-8333-333333333333';
const assistantId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const otherOperationId = '66666666-6666-4666-8666-666666666666';
const snapshotHash = 'a'.repeat(
  64,
) as `${string & { readonly __brand?: never }}`;

const questionSummary = {
  operationId,
  kind: 'question' as const,
  status: 'awaiting_approval' as const,
  approvalRequired: true,
  snapshotHash,
  expiresAt: '2026-11-25T10:42:00.000Z',
  decidedAt: null,
  toolName: 'ask_user',
  input: {
    questions: [
      {
        questionId: 'q1',
        text: 'Which filing deadline applies?',
        kind: 'single',
        options: [{ label: '30 days' }, { label: '60 days' }],
      },
    ],
  },
};

const renameSummary = {
  operationId,
  kind: 'approval' as const,
  status: 'awaiting_approval' as const,
  approvalRequired: true,
  snapshotHash,
  expiresAt: '2026-11-25T10:42:00.000Z',
  decidedAt: null,
  toolName: 'rename_chat',
  input: { newTitle: 'Somasi PT Sinar' },
  display: { currentTitle: 'Draf somasi wanprestasi' },
};

function streamChunks(
  frames: readonly unknown[],
  handlers: ChatStreamHandlers = {},
): Promise<UIMessageChunk[]> {
  return import('../src/lib/chat-stream.js').then(
    async ({ createChatUIMessageStream }) => {
      const response = new Response(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
      const reader = createChatUIMessageStream(response, handlers).getReader();
      const chunks: UIMessageChunk[] = [];
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }
      return chunks;
    },
  );
}

it('maps tool-input-available to an SDK tool-input-available chunk and reports the operation', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'deadline_calculator',
        operationId,
        input: { startDate: '2027-08-03', amount: 14 },
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-input-available',
    toolCallId: operationId,
    toolName: 'deadline_calculator',
    input: { startDate: '2027-08-03', amount: 14 },
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId,
      toolCallId: operationId,
      toolName: 'deadline_calculator',
      input: { startDate: '2027-08-03', amount: 14 },
    }),
  );
});

it('maps a capped tool-input-available (input dropped) and reports the missing input', async () => {
  const onOperation = vi.fn();
  const onOperationSummaryMissing = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'ask_user',
        operationId,
      },
    ],
    { onOperation, onOperationSummaryMissing },
  );
  expect(chunks).toContainEqual({
    type: 'tool-input-available',
    toolCallId: operationId,
    toolName: 'ask_user',
    input: {},
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({ operationId, toolName: 'ask_user' }),
  );
  expect(onOperationSummaryMissing).toHaveBeenCalledWith(operationId);
});

it('keeps the delta-reassembled input when a capped tool-input-available drops the wire input', async () => {
  const onOperation = vi.fn();
  const onOperationSummaryMissing = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-start',
        runId,
        toolCallId: operationId,
        toolName: 'rename_chat',
      },
      {
        version: 1,
        type: 'tool-input-delta',
        runId,
        toolCallId: operationId,
        inputTextDelta: '{"newTitle":"Somasi',
      },
      {
        version: 1,
        type: 'tool-input-delta',
        runId,
        toolCallId: operationId,
        inputTextDelta: ' PT Sinar"}',
      },
      // §9 over-cap fallback: the available frame arrives without `input`.
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'rename_chat',
        operationId,
      },
    ],
    { onOperation, onOperationSummaryMissing },
  );
  expect(chunks).toContainEqual({
    type: 'tool-input-available',
    toolCallId: operationId,
    toolName: 'rename_chat',
    input: { newTitle: 'Somasi PT Sinar' },
  });
  expect(onOperationSummaryMissing).toHaveBeenCalledWith(operationId);
});

it('maps approval-required to a tool-approval-request carrying the summary and reports it', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'rename_chat',
        operationId,
        input: { newTitle: 'Somasi PT Sinar' },
      },
      {
        version: 1,
        type: 'approval-required',
        runId,
        operationId,
        kind: 'approval',
        operation: renameSummary,
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-approval-request',
    approvalId: operationId,
    toolCallId: operationId,
    approvalDescriptor: renameSummary,
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId,
      kind: 'approval',
      status: 'awaiting_approval',
      snapshotHash,
      input: { newTitle: 'Somasi PT Sinar' },
      display: { currentTitle: 'Draf somasi wanprestasi' },
    }),
  );
});

it('maps question-required to a tool-approval-request carrying the summary', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'ask_user',
        operationId,
        input: questionSummary.input,
      },
      {
        version: 1,
        type: 'question-required',
        runId,
        operationId,
        kind: 'question',
        operation: questionSummary,
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-approval-request',
    approvalId: operationId,
    toolCallId: operationId,
    approvalDescriptor: questionSummary,
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({ operationId, kind: 'question' }),
  );
});

it('keeps the panel visible when a summary-less required event needs the tree fetch fallback', async () => {
  const onOperation = vi.fn();
  const onOperationSummaryMissing = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'ask_user',
        operationId,
      },
      // §9 cap fallback: over-4096-byte payloads arrive as {operationId, kind}
      {
        version: 1,
        type: 'question-required',
        runId,
        operationId,
        kind: 'question',
      },
    ],
    { onOperation, onOperationSummaryMissing },
  );
  expect(chunks).toContainEqual({
    type: 'tool-approval-request',
    approvalId: operationId,
    toolCallId: operationId,
  });
  expect(onOperationSummaryMissing).toHaveBeenCalledWith(operationId);
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId,
      kind: 'question',
      status: 'awaiting_approval',
    }),
  );
});

it('maps operation-status decisions to approval responses and denied outputs', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'rename_chat',
        operationId,
        input: { newTitle: 'Somasi PT Sinar' },
      },
      {
        version: 1,
        type: 'approval-required',
        runId,
        operationId,
        kind: 'approval',
        operation: renameSummary,
      },
      {
        version: 1,
        type: 'operation-status',
        runId,
        operationId,
        status: 'approved',
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-approval-response',
    approvalId: operationId,
    approved: true,
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({ operationId, status: 'approved' }),
  );
});

it('maps rejected/dismissed/expired operation-status to a denied output after the approval response', async () => {
  const onOperation = vi.fn();
  for (const status of ['rejected', 'dismissed', 'expired'] as const) {
    const chunks = await streamChunks(
      [
        { version: 1, type: 'start', runId, messageId: assistantId },
        {
          version: 1,
          type: 'tool-input-available',
          runId,
          toolCallId: operationId,
          toolName: 'ask_user',
          operationId,
          input: {},
        },
        {
          version: 1,
          type: 'question-required',
          runId,
          operationId,
          kind: 'question',
          operation: questionSummary,
        },
        {
          version: 1,
          type: 'operation-status',
          runId,
          operationId,
          status,
        },
      ],
      { onOperation },
    );
    expect(chunks).toContainEqual({
      type: 'tool-approval-response',
      approvalId: operationId,
      approved: false,
    });
    expect(chunks).toContainEqual({
      type: 'tool-output-denied',
      toolCallId: operationId,
    });
    expect(onOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operationId, status }),
    );
  }
});

it('leaves pending and awaiting operation-status events without output chunks', async () => {
  const chunks = await streamChunks([
    { version: 1, type: 'start', runId, messageId: assistantId },
    {
      version: 1,
      type: 'tool-input-available',
      runId,
      toolCallId: operationId,
      toolName: 'deadline_calculator',
      operationId,
      input: {},
    },
    {
      version: 1,
      type: 'operation-status',
      runId,
      operationId,
      status: 'pending',
    },
  ]);
  expect(
    chunks.filter(
      (chunk) =>
        chunk.type === 'tool-output-available' ||
        chunk.type === 'tool-output-denied' ||
        chunk.type === 'tool-approval-response',
    ),
  ).toEqual([]);
});

it('maps tool-output-available to an output chunk and reports the stored result', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'deadline_calculator',
        operationId,
        input: { amount: 14 },
      },
      {
        version: 1,
        type: 'tool-output-available',
        runId,
        toolCallId: operationId,
        operationId,
        output: { deadline: '2027-08-18', weekday: 'Wednesday' },
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-output-available',
    toolCallId: operationId,
    output: { deadline: '2027-08-18', weekday: 'Wednesday' },
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId,
      output: { deadline: '2027-08-18', weekday: 'Wednesday' },
    }),
  );
});

it('maps tool-output-denied by toolCallId and reports the denial', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'rename_chat',
        operationId,
        input: {},
      },
      {
        version: 1,
        type: 'tool-output-denied',
        runId,
        toolCallId: operationId,
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-output-denied',
    toolCallId: operationId,
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({ operationId, denied: true }),
  );
});

const snapshotPrefix = (partCount: number, operationCount: number) => ({
  version: 1,
  type: 'snapshot-start',
  reset: true,
  snapshot: {
    runId,
    messageId: assistantId,
    attemptId: '77777777-7777-4777-8777-777777777777',
    generation: 1,
    revision: 3,
    eventId: '1783814400000-2',
    status: 'awaiting_approval',
    errorCode: null,
    reasoningDurationMs: null,
  },
  partCount,
  operationCount,
});

it('replays a paused tool part from a snapshot and rebuilds the approval part', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      snapshotPrefix(1, 1),
      {
        version: 1,
        type: 'snapshot-part',
        partIndex: 0,
        chunkIndex: 0,
        partType: 'tool',
        id: operationId,
        toolCallId: operationId,
        toolName: 'ask_user',
        operationId,
        input: questionSummary.input,
        outcome: 'awaiting_approval',
        final: true,
      },
      {
        version: 1,
        type: 'snapshot-operation',
        index: 0,
        operation: questionSummary,
      },
      {
        version: 1,
        type: 'snapshot-end',
        partCount: 1,
        operationCount: 1,
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-input-available',
    toolCallId: operationId,
    toolName: 'ask_user',
    input: questionSummary.input,
  });
  // The summary lands on the operation store after the part — the replay
  // approval-request carries ids only; the panel resolves it from the store.
  expect(chunks).toContainEqual({
    type: 'tool-approval-request',
    approvalId: operationId,
    toolCallId: operationId,
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({ operationId, kind: 'question' }),
  );
});

it('replays decided tool parts with their stored outputs', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      snapshotPrefix(1, 1),
      {
        version: 1,
        type: 'snapshot-part',
        partIndex: 0,
        chunkIndex: 0,
        partType: 'tool',
        id: operationId,
        toolCallId: operationId,
        toolName: 'ask_user',
        operationId,
        input: questionSummary.input,
        output: {
          answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
        },
        outcome: 'answered',
        final: true,
      },
      {
        version: 1,
        type: 'snapshot-operation',
        index: 0,
        operation: { ...questionSummary, status: 'answered' },
      },
      {
        version: 1,
        type: 'snapshot-end',
        partCount: 1,
        operationCount: 1,
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-output-available',
    toolCallId: operationId,
    output: {
      answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
    },
  });
});

it('replays a denied tool part without dropping it', async () => {
  const chunks = await streamChunks([
    snapshotPrefix(1, 0),
    {
      version: 1,
      type: 'snapshot-part',
      partIndex: 0,
      chunkIndex: 0,
      partType: 'tool',
      id: operationId,
      toolCallId: operationId,
      toolName: 'rename_chat',
      operationId,
      outcome: 'rejected',
      final: true,
    },
    { version: 1, type: 'snapshot-end', partCount: 1, operationCount: 0 },
  ]);
  expect(chunks).toContainEqual({
    type: 'tool-output-denied',
    toolCallId: operationId,
  });
});

it('reports capped snapshot-operation frames and requests the tree fetch fallback', async () => {
  const onOperation = vi.fn();
  const onOperationSummaryMissing = vi.fn();
  const capped = {
    operationId,
    kind: 'question' as const,
    status: 'awaiting_approval' as const,
    approvalRequired: true,
    snapshotHash,
    expiresAt: '2026-11-25T10:42:00.000Z',
    decidedAt: null,
    toolName: 'ask_user',
  };
  await streamChunks(
    [
      snapshotPrefix(0, 1),
      { version: 1, type: 'snapshot-operation', index: 0, operation: capped },
      { version: 1, type: 'snapshot-end', partCount: 0, operationCount: 1 },
    ],
    { onOperation, onOperationSummaryMissing },
  );
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({ operationId, snapshotHash }),
  );
  expect(onOperationSummaryMissing).toHaveBeenCalledWith(operationId);
});

it('maps a second operation on the same run without mixing up toolCallIds', async () => {
  const onOperation = vi.fn();
  const chunks = await streamChunks(
    [
      { version: 1, type: 'start', runId, messageId: assistantId },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: operationId,
        toolName: 'ask_user',
        operationId,
        input: {},
      },
      {
        version: 1,
        type: 'tool-input-available',
        runId,
        toolCallId: otherOperationId,
        toolName: 'fixture-read',
        operationId: otherOperationId,
        input: {},
      },
      {
        version: 1,
        type: 'operation-status',
        runId,
        operationId: otherOperationId,
        status: 'failed',
      },
      {
        version: 1,
        type: 'tool-output-available',
        runId,
        toolCallId: otherOperationId,
        operationId: otherOperationId,
        output: { not_run: 'superseded_by_message' },
      },
      {
        version: 1,
        type: 'operation-status',
        runId,
        operationId,
        status: 'dismissed',
      },
      {
        version: 1,
        type: 'tool-output-denied',
        runId,
        toolCallId: operationId,
      },
    ],
    { onOperation },
  );
  expect(chunks).toContainEqual({
    type: 'tool-output-available',
    toolCallId: otherOperationId,
    output: { not_run: 'superseded_by_message' },
  });
  expect(chunks).toContainEqual({
    type: 'tool-output-denied',
    toolCallId: operationId,
  });
  expect(onOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId: otherOperationId,
      status: 'failed',
    }),
  );
});
