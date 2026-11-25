import { z } from 'zod';
import {
  ChatOperationSnapshotSchema,
  OperationStatusSchema,
  RunErrorCodeSchema,
  RunStatusSchema,
} from './ai-run.js';
// The operation summary schema lives beside the run stream events that carry
// it (ai-run.ts); re-export so both import paths keep working.
export { ChatOperationSnapshotSchema };
export type { ChatOperationSnapshot } from './ai-run.js';

const uuid = z.uuid();
const opaqueId = z.string().min(1).max(256);
const timestamp = z.iso.datetime();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export const ChatStreamRecoveryModeSchema = z.enum(['snapshot', 'incremental']);
export type ChatStreamRecoveryMode = z.infer<
  typeof ChatStreamRecoveryModeSchema
>;
export const CHAT_STREAM_RECOVERY_HEADER = 'x-lexon-stream-recovery';
export const CHAT_STREAM_RECOVERY_RESULT_HEADER =
  'x-lexon-stream-recovery-result';

const chatText = z
  .string()
  .refine((text) => text.trim().length > 0, {
    error: 'Text must not be blank',
  })
  .refine((text) => new TextEncoder().encode(text).byteLength <= 16_384, {
    error: 'Text must be at most 16,384 UTF-8 bytes',
  });

export const ChatEffortSchema = z.enum(['high', 'max']);
export type ChatEffort = z.infer<typeof ChatEffortSchema>;

export const ChatFeedbackSchema = z.enum(['good', 'bad']).nullable();
export type ChatFeedback = z.infer<typeof ChatFeedbackSchema>;

const userMessageSchema = z.strictObject({
  id: uuid,
  role: z.literal('user'),
  parentId: uuid.nullable(),
  text: chatText,
  effort: ChatEffortSchema,
  createdAt: timestamp,
});

const assistantMessageSchema = z.strictObject({
  id: uuid,
  role: z.literal('assistant'),
  parentId: uuid,
  runId: uuid,
  text: z.string(),
  status: RunStatusSchema,
  reasoningSummary: z.string().nullable(),
  reasoningDurationMs: z.number().int().nonnegative().safe().nullable(),
  feedback: ChatFeedbackSchema,
  operations: z.array(ChatOperationSnapshotSchema),
  createdAt: timestamp,
});

export const ChatMessageSchema = z.discriminatedUnion('role', [
  userMessageSchema,
  assistantMessageSchema,
]);
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatMutationResultSchema = z.strictObject({
  chatId: uuid,
  userMessageId: uuid,
  assistantMessageId: uuid,
  runId: uuid,
});
export type ChatMutationResult = z.infer<typeof ChatMutationResultSchema>;

export const ChatTreeSchema = z
  .strictObject({
    id: uuid,
    title: z.string().min(1).max(240),
    messages: z.array(ChatMessageSchema),
    viewedLeafId: uuid.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine(
    (tree) => {
      const byId = new Map(
        tree.messages.map((message) => [message.id, message]),
      );
      if (byId.size !== tree.messages.length) return false;
      for (const message of tree.messages) {
        if (message.parentId !== null && !byId.has(message.parentId))
          return false;
        if (message.role === 'user' && message.parentId !== null) {
          const parent = byId.get(message.parentId);
          if (!parent || parent.role !== 'assistant') return false;
        }
        if (message.role === 'assistant') {
          const parent = byId.get(message.parentId);
          if (!parent || parent.role !== 'user') return false;
        }
        const visited = new Set<string>();
        let cursor: ChatMessage | undefined = message;
        while (cursor && cursor.parentId !== null) {
          if (visited.has(cursor.id)) return false;
          visited.add(cursor.id);
          cursor = byId.get(cursor.parentId);
        }
        if (!cursor || cursor.role !== 'user') return false;
      }
      if (tree.messages.length === 0) return tree.viewedLeafId === null;
      if (tree.viewedLeafId === null) return false;
      const leaf = byId.get(tree.viewedLeafId);
      if (!leaf) return false;
      return !tree.messages.some((message) => message.parentId === leaf.id);
    },
    { message: 'Chat tree must contain a valid viewed leaf and parent links' },
  );
export type ChatTree = z.infer<typeof ChatTreeSchema>;

export const ChatPageSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: uuid,
      title: z.string().min(1).max(240),
      updatedAt: timestamp,
      lastMessageAt: timestamp.nullable(),
      awaitingUser: z.boolean(),
    }),
  ),
  pageInfo: z.strictObject({ nextCursor: z.string().max(256).nullable() }),
});
export type ChatPage = z.infer<typeof ChatPageSchema>;

export const ChatIdentityFallbackEventSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal('identity-fallback'),
  reason: z.enum(['membership_removed', 'selection_repaired']),
  orgId: uuid,
});
export type ChatIdentityFallbackEvent = z.infer<
  typeof ChatIdentityFallbackEventSchema
>;

export const ChatInvalidationEventSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal('chat.invalidated'),
  chatId: uuid.nullable(),
});
export type ChatInvalidationEvent = z.infer<typeof ChatInvalidationEventSchema>;

export const RenameChatInputSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .refine((value) => Array.from(value).length <= 120),
});
export type RenameChatInput = z.infer<typeof RenameChatInputSchema>;

export const ChatSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  cursor: z.string().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ChatSearchRequest = z.infer<typeof ChatSearchRequestSchema>;

export const ChatSearchPageSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      chatId: uuid,
      title: z.string().min(1).max(240),
      messageId: uuid.nullable(),
      excerpt: z.string().max(500),
      matchStart: z.number().int().min(0).nullable(),
      matchEnd: z.number().int().min(0).nullable(),
      updatedAt: timestamp,
    }),
  ),
  pageInfo: z.strictObject({ nextCursor: z.string().max(256).nullable() }),
});
export type ChatSearchPage = z.infer<typeof ChatSearchPageSchema>;

export const ChatSearchMatchSchema = z.strictObject({
  leafId: uuid,
  messageId: uuid,
});
export type ChatSearchMatch = z.infer<typeof ChatSearchMatchSchema>;
export const SetChatFeedbackInputSchema = z.strictObject({
  rating: ChatFeedbackSchema,
});
export type SetChatFeedbackInput = z.infer<typeof SetChatFeedbackInputSchema>;

export const CreateChatInputSchema = z.strictObject({
  chatId: uuid,
  userMessageId: uuid,
  requestId: uuid,
  text: chatText,
  effort: ChatEffortSchema,
});
export type CreateChatInput = z.infer<typeof CreateChatInputSchema>;

export const SendMessageInputSchema = z.strictObject({
  userMessageId: uuid,
  parentMessageId: uuid.nullable(),
  text: chatText,
  effort: ChatEffortSchema,
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const EditMessageInputSchema = z.strictObject({
  messageId: uuid,
  newMessageId: uuid,
  text: chatText,
  effort: ChatEffortSchema,
});
export type EditMessageInput = z.infer<typeof EditMessageInputSchema>;

export const RegenerateInputSchema = z.strictObject({
  messageId: uuid,
  // Keep one ID stable across retries; create a new ID for each deliberate regeneration.
  requestId: uuid,
});
export type RegenerateInput = z.infer<typeof RegenerateInputSchema>;

export const ViewedLeafInputSchema = z.strictObject({ leafId: uuid });
export type ViewedLeafInput = z.infer<typeof ViewedLeafInputSchema>;

export const ChatSnapshotPartSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), id: opaqueId, text: z.string() }),
  z.strictObject({
    type: z.literal('reasoning'),
    id: opaqueId,
    text: z.string(),
  }),
  // Replayed snapshots rebuild the tool rows/records from these parts; the
  // operation binding lets the client join the summary and decision events.
  z.strictObject({
    type: z.literal('tool'),
    id: opaqueId,
    toolCallId: opaqueId,
    toolName: opaqueId,
    operationId: uuid,
    input: z.record(z.string(), z.unknown()).optional(),
    output: z.unknown().optional(),
    outcome: OperationStatusSchema,
  }),
]);

export const ChatSnapshotMetadataSchema = z
  .strictObject({
    runId: uuid,
    messageId: uuid,
    attemptId: uuid.nullable(),
    generation: z.number().int().positive().safe().nullable(),
    revision: z.number().int().nonnegative().safe(),
    eventId: opaqueId.nullable(),
    status: RunStatusSchema,
    errorCode: RunErrorCodeSchema.nullable(),
    reasoningDurationMs: z.number().int().nonnegative().safe().nullable(),
  })
  .superRefine((snapshot, context) => {
    if (
      snapshot.eventId !== null &&
      (snapshot.generation === null ||
        snapshot.attemptId === null ||
        snapshot.revision === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Snapshot cursor requires a published attempt generation and revision',
        path: ['eventId'],
      });
    }
  });

export const ChatSnapshotSchema = z
  .strictObject({
    ...ChatSnapshotMetadataSchema.shape,
    parts: z.array(ChatSnapshotPartSchema),
    operations: z.array(ChatOperationSnapshotSchema),
  })
  .superRefine((snapshot, context) => {
    if (
      snapshot.eventId !== null &&
      (snapshot.generation === null ||
        snapshot.attemptId === null ||
        snapshot.revision === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Snapshot cursor requires a published attempt generation and revision',
        path: ['eventId'],
      });
    }
  });
export type ChatSnapshot = z.infer<typeof ChatSnapshotSchema>;

export const ChatSnapshotFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(1),
    type: z.literal('snapshot-reset'),
    reason: z.enum(['cursor-gap', 'stream-unavailable']),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('snapshot-start'),
    reset: z.literal(true),
    snapshot: ChatSnapshotMetadataSchema,
    partCount: z.number().int().nonnegative().safe(),
    operationCount: z.number().int().nonnegative().safe(),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('snapshot-operation'),
    index: z.number().int().nonnegative().safe(),
    operation: ChatOperationSnapshotSchema,
  }),
  z.discriminatedUnion('partType', [
    z.strictObject({
      version: z.literal(1),
      type: z.literal('snapshot-part'),
      partIndex: z.number().int().nonnegative().safe(),
      chunkIndex: z.number().int().nonnegative().safe(),
      partType: z.enum(['text', 'reasoning']),
      id: opaqueId,
      text: z
        .string()
        .refine((text) => new TextEncoder().encode(text).byteLength <= 24_000),
      final: z.boolean(),
    }),
    // Tool parts replay as a single frame so rows rebuild identically to the
    // live stream; oversized input/display/output blocks are dropped (§9).
    z.strictObject({
      version: z.literal(1),
      type: z.literal('snapshot-part'),
      partIndex: z.number().int().nonnegative().safe(),
      chunkIndex: z.number().int().nonnegative().safe(),
      partType: z.literal('tool'),
      id: opaqueId,
      toolCallId: opaqueId,
      toolName: opaqueId,
      operationId: uuid,
      input: z.record(z.string(), z.unknown()).optional(),
      output: z.unknown().optional(),
      outcome: OperationStatusSchema,
      final: z.boolean(),
    }),
  ]),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('snapshot-end'),
    partCount: z.number().int().nonnegative().safe(),
    operationCount: z.number().int().nonnegative().safe(),
  }),
]);
export type ChatSnapshotFrame = z.infer<typeof ChatSnapshotFrameSchema>;

// Owner-only decision route (POST /runs/{runId}/operations/{operationId}/
// decision). `snapshotHash` binds the decision to the stored snapshot; the
// kind-vs-action fit and answer-vs-args validation happen server-side.
export const OperationDecisionActionSchema = z.enum([
  'approve',
  'reject',
  'answer',
  'dismiss',
]);
export type OperationDecisionAction = z.infer<
  typeof OperationDecisionActionSchema
>;

const decisionOptionIndex = z.number().int().min(0).max(4);
export const OperationAnswerChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('option'), index: decisionOptionIndex }),
  z.strictObject({
    kind: z.literal('options'),
    indexes: z
      .array(decisionOptionIndex)
      .min(1)
      .max(5)
      .refine((indexes) => new Set(indexes).size === indexes.length, {
        error: 'Option indexes must be distinct',
      }),
  }),
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().min(1).max(500),
  }),
  z.strictObject({ kind: z.literal('skipped') }),
]);
export type OperationAnswerChoice = z.infer<typeof OperationAnswerChoiceSchema>;

export const OperationAnswerSchema = z.strictObject({
  questionId: opaqueId,
  choice: OperationAnswerChoiceSchema,
});
export type OperationAnswer = z.infer<typeof OperationAnswerSchema>;

export const OperationDecisionInputSchema = z.discriminatedUnion('action', [
  z.strictObject({
    snapshotHash: sha256Hex,
    action: z.literal('approve'),
  }),
  z.strictObject({
    snapshotHash: sha256Hex,
    action: z.literal('reject'),
  }),
  z.strictObject({
    snapshotHash: sha256Hex,
    action: z.literal('dismiss'),
  }),
  z.strictObject({
    snapshotHash: sha256Hex,
    action: z.literal('answer'),
    answers: z
      .array(OperationAnswerSchema)
      .min(1)
      .max(5)
      .refine(
        (answers) =>
          new Set(answers.map((answer) => answer.questionId)).size ===
          answers.length,
        { error: 'Every question must be answered exactly once' },
      ),
  }),
]);
export type OperationDecisionInput = z.infer<
  typeof OperationDecisionInputSchema
>;

// Idempotent result: the stored outcome (expired/settled ops may carry no
// `decision`, and `decidedAt` stays null for undecided ops).
export const OperationDecisionResultSchema = z.strictObject({
  operationId: uuid,
  status: OperationStatusSchema,
  decision: OperationDecisionActionSchema.nullable(),
  decidedAt: timestamp.nullable(),
});
export type OperationDecisionResult = z.infer<
  typeof OperationDecisionResultSchema
>;

export const ChatAuditEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(1),
    type: z.literal('chat.deletion_requested.v1'),
    eventId: uuid,
    chatId: uuid,
    orgId: uuid.optional(),
    actorUserId: uuid.optional(),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('chat.deletion_completed.v1'),
    eventId: uuid,
    chatId: uuid,
    orgId: uuid.optional(),
    actorUserId: uuid.optional(),
  }),
]);
export type ChatAuditEvent = z.infer<typeof ChatAuditEventSchema>;

export interface ChatGetOptions {
  readonly signal?: AbortSignal;
  readonly ifNoneMatch?: string | undefined;
}

export type ChatGetResult =
  | { notModified: false; tree: ChatTree; etag: string | null }
  | { notModified: true; etag: string };

export interface ChatApi {
  create(input: CreateChatInput): Promise<ChatMutationResult>;
  get(chatId: string, options?: ChatGetOptions): Promise<ChatGetResult>;
  list(
    input?: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<ChatPage>;
  search(
    input: Omit<ChatSearchRequest, 'limit'> & { limit?: number },
    signal?: AbortSignal,
  ): Promise<ChatSearchPage>;
  resolveSearchMatch(
    chatId: string,
    messageId: string,
  ): Promise<ChatSearchMatch>;
  setFeedback(
    chatId: string,
    messageId: string,
    input: SetChatFeedbackInput,
  ): Promise<void>;
  send(chatId: string, input: SendMessageInput): Promise<ChatMutationResult>;
  edit(chatId: string, input: EditMessageInput): Promise<ChatMutationResult>;
  regenerate(
    chatId: string,
    input: RegenerateInput,
  ): Promise<ChatMutationResult>;
  setViewedLeaf(chatId: string, input: ViewedLeafInput): Promise<void>;
  rename(chatId: string, input: RenameChatInput): Promise<void>;
  delete(chatId: string): Promise<void>;
  /** §6.3 owner-only decision route; idempotent 200 with the stored outcome. */
  decideOperation(
    runId: string,
    operationId: string,
    input: OperationDecisionInput,
  ): Promise<OperationDecisionResult>;
}
