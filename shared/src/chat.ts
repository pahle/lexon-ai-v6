import { z } from 'zod';
import { RunErrorCodeSchema, RunStatusSchema } from './ai-run.js';

const uuid = z.uuid();
const opaqueId = z.string().min(1).max(256);
const timestamp = z.iso.datetime();
const chatText = z
  .string()
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
    }),
  ),
  pageInfo: z.strictObject({ nextCursor: z.string().max(256).nullable() }),
});
export type ChatPage = z.infer<typeof ChatPageSchema>;

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
      updatedAt: timestamp,
    }),
  ),
  pageInfo: z.strictObject({ nextCursor: z.string().max(256).nullable() }),
});
export type ChatSearchPage = z.infer<typeof ChatSearchPageSchema>;

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
]);

export const ChatSnapshotSchema = z.strictObject({
  runId: uuid,
  messageId: uuid,
  attemptId: uuid,
  generation: z.number().int().positive().safe(),
  revision: z.number().int().positive().safe(),
  eventId: opaqueId.nullable(),
  parts: z.array(ChatSnapshotPartSchema),
  status: RunStatusSchema,
  errorCode: RunErrorCodeSchema.nullable(),
  reasoningDurationMs: z.number().int().nonnegative().safe().nullable(),
});
export type ChatSnapshot = z.infer<typeof ChatSnapshotSchema>;

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

export interface ChatApi {
  create(input: CreateChatInput): Promise<ChatMutationResult>;
  get(chatId: string): Promise<ChatTree>;
  list(input?: { cursor?: string; limit?: number }): Promise<ChatPage>;
  search(input: ChatSearchRequest): Promise<ChatSearchPage>;
  send(chatId: string, input: SendMessageInput): Promise<ChatMutationResult>;
  edit(chatId: string, input: EditMessageInput): Promise<ChatMutationResult>;
  regenerate(
    chatId: string,
    input: RegenerateInput,
  ): Promise<ChatMutationResult>;
  setViewedLeaf(chatId: string, input: ViewedLeafInput): Promise<void>;
}
