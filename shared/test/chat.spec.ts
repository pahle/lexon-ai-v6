import { describe, expect, it } from 'vitest';
import {
  ChatAuditEventSchema,
  ChatInvalidationEventSchema,
  ChatFeedbackSchema,
  ChatMutationResultSchema,
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
          },
        ],
        pageInfo: { nextCursor: 'cursor/opaque' },
      }).success,
    ).toBe(true);
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
      status: 'awaiting_approval',
      approvalRequired: true,
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
