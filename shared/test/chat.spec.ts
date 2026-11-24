import { describe, expect, it } from 'vitest';
import {
  ChatAuditEventSchema,
  ChatInvalidationEventSchema,
  ChatFeedbackSchema,
  ChatMutationResultSchema,
  ChatOperationSnapshotSchema,
  ChatPageSchema,
  ChatSearchPageSchema,
  ChatEffortSchema,
  ChatMessageSchema,
  ChatSearchRequestSchema,
  ChatSnapshotSchema,
  ChatSnapshotFrameSchema,
  ChatTreeSchema,
  CreateChatInputSchema,
  EditMessageInputSchema,
  OperationDecisionInputSchema,
  OperationDecisionResultSchema,
  RegenerateInputSchema,
  SendMessageInputSchema,
  ViewedLeafInputSchema,
} from '../src/chat.js';
import { ChatErrorCodeSchema, SafeErrorMessages } from '../src/error.js';

const chatId = '00000000-0000-4000-8000-000000000001';
const userMessageId = '00000000-0000-4000-8000-000000000002';
const assistantMessageId = '00000000-0000-4000-8000-000000000003';
const runId = '00000000-0000-4000-8000-000000000004';
const parentMessageId = '00000000-0000-4000-8000-000000000005';
const editedAssistantMessageId = '00000000-0000-4000-8000-000000000006';
const validSend = {
  userMessageId,
  parentMessageId: null,
  text: 'What does this clause mean?',
  effort: 'high',
};

describe('chat contracts', () => {
  it('rejects blank text without normalizing valid Unicode or surrounding whitespace', () => {
    const validCreate = {
      chatId,
      userMessageId,
      requestId: runId,
      text: 'First question',
      effort: 'high',
    };
    const validEdit = {
      messageId: userMessageId,
      newMessageId: parentMessageId,
      text: 'Edited question',
      effort: 'high',
    };
    for (const text of ['', ' ', '\t\n']) {
      expect(
        CreateChatInputSchema.safeParse({ ...validCreate, text }).success,
      ).toBe(false);
      expect(
        SendMessageInputSchema.safeParse({ ...validSend, text }).success,
      ).toBe(false);
      expect(
        EditMessageInputSchema.safeParse({ ...validEdit, text }).success,
      ).toBe(false);
    }
    const preserved = '  Pertanyaan hukum 😀\n ';
    expect(
      CreateChatInputSchema.parse({ ...validCreate, text: preserved }).text,
    ).toBe(preserved);
    expect(
      SendMessageInputSchema.parse({ ...validSend, text: preserved }).text,
    ).toBe(preserved);
    expect(
      EditMessageInputSchema.parse({ ...validEdit, text: preserved }).text,
    ).toBe(preserved);
  });

  it('measures message text by UTF-8 bytes, including multibyte characters', () => {
    expect(
      SendMessageInputSchema.safeParse({
        ...validSend,
        text: 'a'.repeat(16_384),
      }).success,
    ).toBe(true);
    expect(
      SendMessageInputSchema.safeParse({
        ...validSend,
        text: 'a'.repeat(16_385),
      }).success,
    ).toBe(false);
    expect(
      SendMessageInputSchema.safeParse({
        ...validSend,
        text: 'a'.repeat(16_380) + '😀',
      }).success,
    ).toBe(true);
    expect(
      SendMessageInputSchema.safeParse({
        ...validSend,
        text: 'a'.repeat(16_381) + '😀',
      }).success,
    ).toBe(false);
  });

  it('requires UUID identities and permits only immutable user messages', () => {
    expect(SendMessageInputSchema.safeParse(validSend).success).toBe(true);
    for (const forged of [
      { role: 'assistant' },
      { transcript: [] },
      { tool: { name: 'search' } },
      { provider: 'openrouter' },
      { orgId: chatId, userId: userMessageId },
    ])
      expect(
        SendMessageInputSchema.safeParse({ ...validSend, ...forged }).success,
      ).toBe(false);
    expect(
      SendMessageInputSchema.safeParse({
        ...validSend,
        userMessageId: 'message-1',
      }).success,
    ).toBe(false);
    expect(ChatEffortSchema.safeParse('max').success).toBe(true);
    expect(ChatEffortSchema.safeParse('medium').success).toBe(false);
  });

  it('defines a strict create-chat request with client retry identities', () => {
    const validCreate = {
      chatId,
      userMessageId,
      requestId: runId,
      text: 'First question',
      effort: 'high',
    };
    expect(CreateChatInputSchema.safeParse(validCreate).success).toBe(true);
    for (const forged of [
      { role: 'assistant' },
      { transcript: [] },
      { tool: { name: 'search' } },
      { provider: 'openrouter' },
      { orgId: chatId, userId: userMessageId },
    ])
      expect(
        CreateChatInputSchema.safeParse({ ...validCreate, ...forged }).success,
      ).toBe(false);
    for (const field of ['chatId', 'userMessageId', 'requestId'] as const)
      expect(
        CreateChatInputSchema.safeParse({ ...validCreate, [field]: 'bad-id' })
          .success,
      ).toBe(false);
  });

  it('validates a parent-linked message tree and a leaf within that tree', () => {
    const userMessage = {
      id: userMessageId,
      role: 'user',
      parentId: null,
      text: 'Question',
      effort: 'high',
      createdAt: '2026-11-09T00:00:00.000Z',
    };
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      parentId: userMessageId,
      runId,
      text: 'Answer',
      status: 'completed',
      reasoningSummary: null,
      reasoningDurationMs: null,
      feedback: null,
      operations: [],
      createdAt: '2026-11-09T00:00:01.000Z',
    };
    expect(ChatMessageSchema.safeParse(userMessage).success).toBe(true);
    expect(ChatMessageSchema.safeParse(assistantMessage).success).toBe(true);
    const tree = {
      id: chatId,
      title: 'Question',
      messages: [userMessage, assistantMessage],
      viewedLeafId: assistantMessageId,
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:01.000Z',
    };
    expect(ChatTreeSchema.safeParse(tree).success).toBe(true);
    expect(
      ChatTreeSchema.safeParse({
        ...tree,
        messages: [
          userMessage,
          assistantMessage,
          { ...userMessage, id: parentMessageId, text: 'Edited root' },
          {
            ...assistantMessage,
            id: editedAssistantMessageId,
            parentId: parentMessageId,
          },
        ],
        viewedLeafId: editedAssistantMessageId,
      }).success,
    ).toBe(true);
    expect(
      ChatTreeSchema.safeParse({ ...tree, viewedLeafId: parentMessageId })
        .success,
    ).toBe(false);
    expect(
      ChatTreeSchema.safeParse({
        ...tree,
        messages: [
          { ...userMessage, parentId: assistantMessageId },
          { ...assistantMessage, parentId: userMessageId },
        ],
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({ ...assistantMessage, role: 'user' })
        .success,
    ).toBe(false);
    expect(ChatMessageSchema.safeParse({ ...userMessage, runId }).success).toBe(
      false,
    );
  });

  it('rejects unsafe editable fields and validates mutation identities', () => {
    const edit = {
      messageId: userMessageId,
      newMessageId: parentMessageId,
      text: 'Edited question',
      effort: 'max',
    };
    expect(EditMessageInputSchema.safeParse(edit).success).toBe(true);
    const regenerate = { messageId: assistantMessageId, requestId: runId };
    expect(RegenerateInputSchema.safeParse(regenerate).success).toBe(true);
    expect(
      RegenerateInputSchema.safeParse({
        ...regenerate,
        requestId: parentMessageId,
      }).success,
    ).toBe(true);
    expect(
      RegenerateInputSchema.safeParse({ messageId: assistantMessageId })
        .success,
    ).toBe(false);
    expect(
      ViewedLeafInputSchema.safeParse({ leafId: assistantMessageId }).success,
    ).toBe(true);
    expect(
      EditMessageInputSchema.safeParse({ ...edit, role: 'assistant' }).success,
    ).toBe(false);
    expect(
      RegenerateInputSchema.safeParse({ messageId: 'assistant-1' }).success,
    ).toBe(false);
  });

  it('validates server mutation results and opaque list/search cursors', () => {
    expect(
      ChatMutationResultSchema.safeParse({
        chatId,
        userMessageId,
        assistantMessageId,
        runId,
      }).success,
    ).toBe(true);
    expect(
      ChatMutationResultSchema.safeParse({ chatId, userMessageId, runId })
        .success,
    ).toBe(false);
    expect(
      ChatPageSchema.safeParse({
        items: [
          {
            id: chatId,
            title: 'Question',
            updatedAt: '2026-11-09T00:00:00.000Z',
            lastMessageAt: null,
            awaitingUser: false,
          },
          {
            id: parentMessageId,
            title: 'Waiting',
            updatedAt: '2026-11-09T00:00:00.000Z',
            lastMessageAt: '2026-11-09T00:00:00.000Z',
            awaitingUser: true,
          },
        ],
        pageInfo: { nextCursor: 'cursor/opaque' },
      }).success,
    ).toBe(true);
    // awaitingUser is a required boolean — clients must always find it.
    expect(
      ChatPageSchema.safeParse({
        items: [
          {
            id: chatId,
            title: 'Question',
            updatedAt: '2026-11-09T00:00:00.000Z',
            lastMessageAt: null,
          },
        ],
        pageInfo: { nextCursor: 'cursor/opaque' },
      }).success,
    ).toBe(false);
    expect(
      ChatSearchPageSchema.safeParse({
        items: [
          {
            chatId,
            title: 'Question',
            messageId: userMessageId,
            excerpt: 'A safe excerpt',
            matchStart: 2,
            matchEnd: 8,
            updatedAt: '2026-11-09T00:00:00.000Z',
          },
        ],
        pageInfo: { nextCursor: null },
      }).success,
    ).toBe(true);
  });

  it('validates bounded opaque search cursors and POST request fields', () => {
    expect(
      ChatSearchRequestSchema.safeParse({ query: 'contracts', limit: 20 })
        .success,
    ).toBe(true);
    expect(
      ChatSearchRequestSchema.safeParse({
        query: 'contracts',
        cursor: 'opaque/cursor.α',
        limit: 50,
      }).success,
    ).toBe(true);
    expect(
      ChatSearchRequestSchema.safeParse({
        query: 'contracts',
        cursor: 'x'.repeat(257),
        limit: 20,
      }).success,
    ).toBe(false);
    expect(
      ChatSearchRequestSchema.safeParse({ query: 'contracts', method: 'GET' })
        .success,
    ).toBe(false);
  });

  it('validates reasoning snapshots without inventing duration or provider data', () => {
    const snapshot = {
      runId,
      messageId: assistantMessageId,
      attemptId: parentMessageId,
      generation: 1,
      revision: 1,
      eventId: null,
      parts: [],
      operations: [],
      status: 'running',
      errorCode: null,
      reasoningDurationMs: null,
    };
    expect(ChatSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      ChatSnapshotSchema.safeParse({
        ...snapshot,
        parts: [{ type: 'reasoning', id: 'opaque:α', text: 'Summary' }],
      }).success,
    ).toBe(true);
    expect(
      ChatSnapshotSchema.safeParse({
        ...snapshot,
        parts: [{ type: 'reasoning', id: 'x'.repeat(257), text: 'Summary' }],
      }).success,
    ).toBe(false);
    expect(
      ChatSnapshotSchema.safeParse({ ...snapshot, providerMetadata: {} })
        .success,
    ).toBe(false);
    const pendingNoAttempt = {
      ...snapshot,
      attemptId: null,
      generation: null,
      revision: 0,
      eventId: null,
    };
    expect(ChatSnapshotSchema.safeParse(pendingNoAttempt).success).toBe(true);
    expect(
      ChatSnapshotSchema.safeParse({ ...pendingNoAttempt, eventId: '1-1' })
        .success,
    ).toBe(false);
    expect(
      ChatSnapshotSchema.safeParse({
        ...snapshot,
        attemptId: null,
        eventId: '1-1',
      }).success,
    ).toBe(false);
    expect(
      ChatSnapshotSchema.safeParse({ ...pendingNoAttempt, revision: -1 })
        .success,
    ).toBe(false);
    const snapshotMetadata = Object.fromEntries(
      Object.entries(pendingNoAttempt).filter(
        ([key]) => key !== 'parts' && key !== 'operations',
      ),
    );
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-start',
        reset: true,
        snapshot: snapshotMetadata,
        partCount: 0,
        operationCount: 0,
      }).success,
    ).toBe(true);
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-start',
        reset: true,
        snapshot: { ...snapshotMetadata, eventId: '1-1' },
        partCount: 0,
        operationCount: 0,
      }).success,
    ).toBe(false);
    const safeOperation = {
      operationId: parentMessageId,
      kind: 'approval',
      status: 'awaiting_approval',
      approvalRequired: true,
      snapshotHash: 'c'.repeat(64),
      expiresAt: '2026-11-10T00:00:00.000Z',
      decidedAt: null,
      toolName: 'rename_chat',
    };
    expect(
      ChatSnapshotSchema.safeParse({
        ...pendingNoAttempt,
        operations: [safeOperation],
      }).success,
    ).toBe(true);
    expect(
      ChatSnapshotSchema.safeParse({
        ...pendingNoAttempt,
        operations: [{ ...safeOperation, args: { token: 'hidden' } }],
      }).success,
    ).toBe(false);
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-operation',
        index: 0,
        operation: safeOperation,
      }).success,
    ).toBe(true);
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-end',
        partCount: 0,
        operationCount: 1,
      }).success,
    ).toBe(true);
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-part',
        partIndex: 0,
        chunkIndex: 0,
        partType: 'text',
        id: runId,
        text: 'x'.repeat(24_001),
        final: true,
      }).success,
    ).toBe(false);
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-reset',
        reason: 'cursor-gap',
        debug: 'private',
      }).success,
    ).toBe(false);
  });

  it('round-trips the operation summary and its event-cap core', () => {
    const summary = {
      operationId: parentMessageId,
      kind: 'question',
      status: 'awaiting_approval',
      approvalRequired: true,
      snapshotHash: 'b'.repeat(64),
      expiresAt: '2026-11-10T00:00:00.000Z',
      decidedAt: '2026-11-09T12:00:00.000Z',
      toolName: 'ask_user',
      input: {
        questions: [
          {
            questionId: 'q1',
            text: 'Pertanyaan?',
            kind: 'single',
            options: [{ label: 'Ya' }, { label: 'Tidak' }],
          },
        ],
      },
      display: { note: 'server-stamped informational fields' },
      output: { unanswered: true },
    };
    const parsed = ChatOperationSnapshotSchema.parse(summary);
    expect(parsed.snapshotHash).toBe('b'.repeat(64));
    expect(parsed.input).toEqual(summary.input);
    // The event-cap core keeps ids/status/hash without the payload blocks.
    const core = {
      operationId: summary.operationId,
      kind: summary.kind,
      status: summary.status,
      approvalRequired: summary.approvalRequired,
      snapshotHash: summary.snapshotHash,
      expiresAt: summary.expiresAt,
      decidedAt: summary.decidedAt,
      toolName: summary.toolName,
    };
    expect(ChatOperationSnapshotSchema.safeParse(core).success).toBe(true);
    // kind, hash, tool and the timestamps are required on every summary.
    for (const key of [
      'kind',
      'snapshotHash',
      'toolName',
      'expiresAt',
      'decidedAt',
      'status',
      'approvalRequired',
    ] as const)
      expect(
        ChatOperationSnapshotSchema.safeParse({ ...core, [key]: undefined })
          .success,
      ).toBe(false);
    expect(
      ChatOperationSnapshotSchema.safeParse({
        ...core,
        expiresAt: null,
        decidedAt: null,
      }).success,
    ).toBe(true);
    expect(
      ChatOperationSnapshotSchema.safeParse({
        ...core,
        snapshotHash: 'not-a-sha256',
      }).success,
    ).toBe(false);
    expect(
      ChatOperationSnapshotSchema.safeParse({ ...core, kind: 'write' }).success,
    ).toBe(false);
    // snapshot-operation frames accept both the full summary and the core.
    for (const operation of [summary, core])
      expect(
        ChatSnapshotFrameSchema.safeParse({
          version: 1,
          type: 'snapshot-operation',
          index: 0,
          operation,
        }).success,
      ).toBe(true);
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-operation',
        index: 0,
        operation: { operationId: parentMessageId },
      }).success,
    ).toBe(false);
  });

  it('accepts a tool snapshot part with its operation binding', () => {
    const toolPart = {
      type: 'tool',
      id: 'part-tool-1',
      toolCallId: 'call-1',
      toolName: 'rename_chat',
      operationId: parentMessageId,
      input: { newTitle: 'Proposed' },
      output: { renamed: true, previousTitle: 'Old' },
      outcome: 'approved',
    };
    const snapshot = {
      runId,
      messageId: assistantMessageId,
      attemptId: null,
      generation: null,
      revision: 0,
      eventId: null,
      parts: [toolPart],
      operations: [],
      status: 'completed',
      errorCode: null,
      reasoningDurationMs: null,
    };
    expect(ChatSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      ChatSnapshotSchema.safeParse({
        ...snapshot,
        parts: [{ ...toolPart, input: undefined, output: undefined }],
      }).success,
    ).toBe(true);
    for (const key of ['toolCallId', 'toolName', 'operationId', 'outcome'])
      expect(
        ChatSnapshotSchema.safeParse({
          ...snapshot,
          parts: [{ ...toolPart, [key]: undefined }],
        }).success,
      ).toBe(false);
    // A tool part without its operation binding is incomplete.
    expect(
      ChatSnapshotSchema.safeParse({
        ...snapshot,
        parts: [{ ...toolPart, operationId: 'call-1' }],
      }).success,
    ).toBe(false);
    // snapshot-part frames still carry streamed text/reasoning chunks only.
    expect(
      ChatSnapshotFrameSchema.safeParse({
        version: 1,
        type: 'snapshot-part',
        partIndex: 0,
        chunkIndex: 0,
        partType: 'tool',
        id: 'part-tool-1',
        text: '',
        final: true,
      }).success,
    ).toBe(false);
  });

  it('carries the run operation list on tree assistant messages', () => {
    const userMessage = {
      id: userMessageId,
      role: 'user',
      parentId: null,
      text: 'Question',
      effort: 'high',
      createdAt: '2026-11-09T00:00:00.000Z',
    };
    const operation = {
      operationId: parentMessageId,
      kind: 'approval',
      status: 'approved',
      approvalRequired: true,
      snapshotHash: 'd'.repeat(64),
      expiresAt: null,
      decidedAt: '2026-11-09T00:00:30.000Z',
      toolName: 'rename_chat',
      input: { newTitle: 'Renamed' },
      output: { renamed: true, previousTitle: 'Old' },
    };
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      parentId: userMessageId,
      runId,
      text: 'Done',
      status: 'completed',
      reasoningSummary: null,
      reasoningDurationMs: null,
      feedback: null,
      operations: [operation],
      createdAt: '2026-11-09T00:00:01.000Z',
    };
    expect(ChatMessageSchema.safeParse(assistantMessage).success).toBe(true);
    const tree = {
      id: chatId,
      title: 'Question',
      messages: [userMessage, assistantMessage],
      viewedLeafId: assistantMessageId,
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:01.000Z',
    };
    expect(ChatTreeSchema.safeParse(tree).success).toBe(true);
    // The operations list is required on assistant messages.
    const withoutOperations = Object.fromEntries(
      Object.entries(assistantMessage).filter(([key]) => key !== 'operations'),
    );
    expect(ChatMessageSchema.safeParse(withoutOperations).success).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        ...assistantMessage,
        operations: [{ operationId: parentMessageId }],
      }).success,
    ).toBe(false);
  });

  it('validates the operation decision input and stored outcome shapes', () => {
    const snapshotHash = 'e'.repeat(64);
    for (const action of ['approve', 'reject', 'dismiss'] as const)
      expect(
        OperationDecisionInputSchema.safeParse({ snapshotHash, action })
          .success,
      ).toBe(true);
    // answers cover every question of the call, one choice each.
    const answers = [
      { questionId: 'q1', choice: { kind: 'option', index: 0 } },
      { questionId: 'q2', choice: { kind: 'options', indexes: [0, 2] } },
      { questionId: 'q3', choice: { kind: 'text', text: 'Jawaban bebas' } },
      { questionId: 'q4', choice: { kind: 'skipped' } },
    ];
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash,
        action: 'answer',
        answers,
      }).success,
    ).toBe(true);
    // action: 'answer' requires the answers array.
    expect(
      OperationDecisionInputSchema.safeParse({ snapshotHash, action: 'answer' })
        .success,
    ).toBe(false);
    // A non-answer payload on another action is rejected (strict keys).
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash,
        action: 'approve',
        answers,
      }).success,
    ).toBe(false);
    // Choice payloads validate their wire shape.
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash,
        action: 'answer',
        answers: [
          { questionId: 'q1', choice: { kind: 'options', indexes: [] } },
        ],
      }).success,
    ).toBe(false);
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash,
        action: 'answer',
        answers: [
          { questionId: 'q1', choice: { kind: 'options', indexes: [1, 1] } },
        ],
      }).success,
    ).toBe(false);
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash,
        action: 'answer',
        answers: [{ questionId: 'q1', choice: { kind: 'other' } }],
      }).success,
    ).toBe(false);
    // Each question is covered exactly once.
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash,
        action: 'answer',
        answers: [answers[0], answers[0]],
      }).success,
    ).toBe(false);
    // The hash binds the stored snapshot — a malformed hash never parses.
    expect(
      OperationDecisionInputSchema.safeParse({
        snapshotHash: 'not-a-hash',
        action: 'approve',
      }).success,
    ).toBe(false);
    // The idempotent result echoes the stored outcome.
    for (const outcome of [
      {
        operationId: parentMessageId,
        status: 'answered',
        decision: 'answer',
        decidedAt: '2026-11-09T00:00:30.000Z',
      },
      {
        operationId: parentMessageId,
        status: 'expired',
        decision: null,
        decidedAt: '2026-11-09T00:00:30.000Z',
      },
      {
        operationId: parentMessageId,
        status: 'failed',
        decision: null,
        decidedAt: null,
      },
    ])
      expect(OperationDecisionResultSchema.safeParse(outcome).success).toBe(
        true,
      );
    expect(
      OperationDecisionResultSchema.safeParse({
        operationId: parentMessageId,
        status: 'answered',
      }).success,
    ).toBe(false);
  });

  it('exports fixed safe chat error codes and English copy', () => {
    expect(ChatErrorCodeSchema.safeParse('CHAT_CONFLICT').success).toBe(true);
    expect(ChatErrorCodeSchema.safeParse('provider failure').success).toBe(
      false,
    );
    expect(SafeErrorMessages.CHAT_CONFLICT).toBe(
      'This chat is busy. Try again when the current answer finishes.',
    );
    expect(SafeErrorMessages.CHAT_NOT_FOUND).toBe('Chat not found.');
  });

  it('allows good, bad, or no message feedback', () => {
    expect(ChatFeedbackSchema.safeParse('good').success).toBe(true);
    expect(ChatFeedbackSchema.safeParse('bad').success).toBe(true);
    expect(ChatFeedbackSchema.safeParse(null).success).toBe(true);
    expect(ChatFeedbackSchema.safeParse('neutral').success).toBe(false);
  });

  it('accepts only ID-only deletion audit events', () => {
    for (const type of [
      'chat.deletion_requested.v1',
      'chat.deletion_completed.v1',
    ]) {
      expect(
        ChatAuditEventSchema.safeParse({
          version: 1,
          type,
          eventId: runId,
          chatId,
        }).success,
      ).toBe(true);
      expect(
        ChatAuditEventSchema.safeParse({
          version: 1,
          type,
          eventId: runId,
          chatId,
          text: 'private content',
        }).success,
      ).toBe(false);
    }
  });

  it('accepts only versioned chat invalidation IDs', () => {
    expect(
      ChatInvalidationEventSchema.safeParse({
        version: 1,
        type: 'chat.invalidated',
        chatId,
      }).success,
    ).toBe(true);
    expect(
      ChatInvalidationEventSchema.safeParse({
        version: 1,
        type: 'chat.invalidated',
        chatId,
        title: 'private title',
      }).success,
    ).toBe(false);
  });
});
