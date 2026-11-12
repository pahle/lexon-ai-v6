import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatPage,
  ChatMutationResult,
  ChatTree as SharedChatTree,
  CreateChatInput,
  SendMessageInput,
} from '@lexon/contracts';
import { ChatApiError } from '@lexon/contracts';
import { ChatPageSchema, ChatTreeSchema } from '@lexon/contracts';
import { RunStatusSchema } from '@lexon/contracts';
import {
  AiStepRepository,
  ChatMessageRepository,
  ChatMutationRepository,
  ChatRepository,
  ChatDeletionRepository,
  ChatSearchRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import { AuditService } from '../audit/index.js';
import { RunService } from './run.service.js';
import { titleExcerpt } from './chat-title.service.js';

const listCursorSchema = z.tuple([
  z.literal(1),
  z.string().regex(/^[a-f0-9]{64}$/),
  z.iso.datetime(),
  z.uuid(),
]);

function encodeListCursor(input: z.infer<typeof listCursorSchema>): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

function ownerDigest(actor: RunActor): string {
  return createHash('sha256')
    .update(`${actor.orgId}\0${actor.userId}`, 'utf8')
    .digest('hex');
}

export class ChatService {
  private readonly chats = new ChatRepository();
  private readonly messages = new ChatMessageRepository();
  private readonly mutations = new ChatMutationRepository();
  private readonly steps = new AiStepRepository();
  private readonly audit = new AuditService();
  private readonly deletions = new ChatDeletionRepository();
  private readonly searchRepository = new ChatSearchRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly runService: RunService,
    private readonly authorization: RunAuthorizationService,
  ) {}

  async create(
    actor: RunActor,
    input: CreateChatInput,
  ): Promise<ChatMutationResult> {
    this.authorization.assertLiveActor(actor);
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        if (
          (await this.deletions.wasDeleted(tx, 'chat', input.chatId)) ||
          (await this.deletions.wasDeleted(tx, 'message', input.userMessageId))
        )
          throw new ChatApiError('CHAT_NOT_FOUND');
        const retry = await this.mutations.findCreateRequest(
          tx,
          input.requestId,
        );
        if (retry) {
          if (!(await this.chats.lockLive(tx, retry.chatId)))
            throw new ChatApiError('CHAT_NOT_FOUND');
          if (
            retry.chatId !== input.chatId ||
            retry.userMessageId !== input.userMessageId ||
            retry.text !== input.text ||
            retry.effort !== input.effort
          )
            throw new ChatApiError('CHAT_CONFLICT');
          return this.mutations.toMutationResult(retry);
        }

        if (await this.chats.lockLive(tx, input.chatId))
          throw new ChatApiError('CHAT_CONFLICT');
        try {
          await this.chats.insert(tx, input.chatId, titleExcerpt(input.text));
          await this.messages.insertUser(tx, {
            chatId: input.chatId,
            messageId: input.userMessageId,
            parentMessageId: null,
            text: input.text,
            effort: input.effort,
          });
          const { runId } = await this.runService.startWithin(tx, actor, {
            profileId: 'chat',
            prompt: input.text,
            effort: input.effort,
            resourceIds: [input.chatId],
          });
          await this.chats.associateAnswer(tx, input.chatId, runId);
          await this.messages.insertAssistant(tx, {
            chatId: input.chatId,
            messageId: runId,
            parentMessageId: input.userMessageId,
            runId,
          });
          await this.mutations.insertMutationRequest(tx, {
            requestId: input.userMessageId,
            kind: 'send',
            chatId: input.chatId,
            sourceMessageId: null,
            userMessageId: input.userMessageId,
            assistantMessageId: runId,
          });
          await this.chats.selectLeaf(tx, input.chatId, runId);
          await this.mutations.insertCreateRequest(tx, {
            requestId: input.requestId,
            chatId: input.chatId,
            userMessageId: input.userMessageId,
            assistantMessageId: runId,
          });
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.created.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'success',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: { chatId: input.chatId },
          });
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.message_sent.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'success',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: { chatId: input.chatId, messageId: input.userMessageId },
          });
          return {
            chatId: input.chatId,
            userMessageId: input.userMessageId,
            assistantMessageId: runId,
            runId,
          };
        } catch (error) {
          if (
            isExpectedUniqueViolation(error, [
              'chats_pkey',
              'chat_messages_pkey',
              'chat_create_requests_pkey',
            ])
          )
            throw new ChatApiError('CHAT_CONFLICT');
          throw error;
        }
      },
    );
  }

  async send(
    actor: RunActor,
    chatId: string,
    input: SendMessageInput,
  ): Promise<ChatMutationResult> {
    this.authorization.assertLiveActor(actor);
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        const chat = await this.chats.lockLive(tx, chatId);
        if (!chat) throw new ChatApiError('CHAT_NOT_FOUND');
        const retry = await this.mutations.findMessageMutation(
          tx,
          chatId,
          input.userMessageId,
        );
        if (retry) {
          if (
            retry.parentMessageId !== input.parentMessageId ||
            retry.text !== input.text ||
            retry.effort !== input.effort
          )
            throw new ChatApiError('CHAT_CONFLICT');
          return this.mutations.toMutationResult(retry);
        }
        if (await this.deletions.wasDeleted(tx, 'message', input.userMessageId))
          throw new ChatApiError('CHAT_CONFLICT');
        if (chat.activeAnswerRunId) throw new ChatApiError('CHAT_CONFLICT');

        try {
          await this.messages.insertUser(tx, {
            chatId,
            messageId: input.userMessageId,
            parentMessageId: input.parentMessageId,
            text: input.text,
            effort: input.effort,
          });
          const { runId } = await this.runService.startWithin(tx, actor, {
            profileId: 'chat',
            prompt: input.text,
            effort: input.effort,
            resourceIds: [chatId],
          });
          await this.chats.associateAnswer(tx, chatId, runId);
          await this.messages.insertAssistant(tx, {
            chatId,
            messageId: runId,
            parentMessageId: input.userMessageId,
            runId,
          });
          await this.mutations.insertMutationRequest(tx, {
            requestId: input.userMessageId,
            kind: 'send',
            chatId,
            sourceMessageId: input.parentMessageId,
            userMessageId: input.userMessageId,
            assistantMessageId: runId,
          });
          await this.chats.selectLeaf(tx, chatId, runId);
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.message_sent.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'success',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: { chatId, messageId: input.userMessageId },
          });
          return {
            chatId,
            userMessageId: input.userMessageId,
            assistantMessageId: runId,
            runId,
          };
        } catch (error) {
          if (
            isExpectedUniqueViolation(error, [
              'chat_messages_pkey',
              'chat_one_active_answer',
            ])
          )
            throw new ChatApiError('CHAT_CONFLICT');
          throw error;
        }
      },
    );
  }

  async get(actor: RunActor, chatId: string): Promise<SharedChatTree> {
    this.authorization.assertLiveActor(actor);
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const chat = await this.chats.readLive(tx, chatId);
        if (!chat) throw new ChatApiError('CHAT_NOT_FOUND');
        const tree = await this.messages.tree(tx, chatId);
        if (!tree) throw new ChatApiError('CHAT_NOT_FOUND');
        return ChatTreeSchema.parse({
          id: chatId,
          title: chat.title || 'New chat',
          messages: tree.messages.map((message) => {
            return message.role === 'user'
              ? {
                  id: message.id,
                  role: 'user' as const,
                  parentId: message.parentMessageId,
                  text: message.userText ?? '',
                  effort: message.effort ?? 'high',
                  createdAt: message.createdAt.toISOString(),
                }
              : {
                  id: message.id,
                  role: 'assistant' as const,
                  parentId: message.parentMessageId!,
                  runId: message.runId!,
                  text: message.assistantText ?? '',
                  status: RunStatusSchema.parse(message.status),
                  reasoningSummary: message.reasoningSummary,
                  reasoningDurationMs: message.reasoningDurationMs,
                  feedback: message.feedback,
                  createdAt: message.createdAt.toISOString(),
                };
          }),
          viewedLeafId: tree.viewedLeafId,
          createdAt: chat.createdAt.toISOString(),
          updatedAt: chat.updatedAt.toISOString(),
        });
      },
    );
  }

  async list(
    actor: RunActor,
    input: { cursor?: string; limit?: number } = {},
  ): Promise<ChatPage> {
    this.authorization.assertLiveActor(actor);
    const request = z
      .strictObject({
        cursor: z.string().min(1).max(256).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .parse(input);
    let cursor: z.infer<typeof listCursorSchema> | null = null;
    if (request.cursor) {
      try {
        cursor = listCursorSchema.parse(
          JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')),
        );
        if (cursor[1] !== ownerDigest(actor))
          throw new Error();
      } catch {
        throw new ChatApiError('CHAT_CONFLICT');
      }
    }
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const rows = await this.searchRepository.list(
          tx,
          cursor
            ? { activityAt: cursor[2], chatId: cursor[3] }
            : null,
          request.limit + 1,
        );
        const hasMore = rows.length > request.limit;
        const pageRows = hasMore ? rows.slice(0, request.limit) : rows;
        const items = pageRows.map((row) => ({
          id: row.id,
          title: row.title || 'New chat',
          updatedAt: row.updated_at.toISOString(),
          lastMessageAt: row.last_message_at?.toISOString() ?? null,
        }));
        const last = pageRows.at(-1);
        return ChatPageSchema.parse({
          items,
          pageInfo: {
            nextCursor:
              hasMore && last
                ? encodeListCursor([
                    1,
                    ownerDigest(actor),
                    last.activity_at,
                    last.id,
                  ])
                : null,
          },
        });
      },
    );
  }

  async resolveSearchMatch(
    actor: RunActor,
    chatId: string,
    messageId: string,
  ): Promise<{ leafId: string; messageId: string }> {
    this.authorization.assertLiveActor(actor);
    const resolved = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      (tx) => this.searchRepository.resolveMatch(tx, chatId, messageId),
    );
    if (!resolved) throw new ChatApiError('CHAT_NOT_FOUND');
    return resolved;
  }

  async assertLiveAnswerRun(actor: RunActor, runId: string): Promise<void> {
    this.authorization.assertLiveActor(actor);
    const authorized = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      (tx) => this.chats.hasLiveAnswerRun(tx, runId),
    );
    if (!authorized) throw new ChatApiError('CHAT_NOT_FOUND');
  }

  async rename(actor: RunActor, chatId: string, title: string): Promise<void> {
    this.authorization.assertLiveActor(actor);
    const normalized = title.trim();
    if (!normalized || Array.from(normalized).length > 120)
      throw new ChatApiError('CHAT_CONFLICT');
    const renamed = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      (tx) => this.chats.rename(tx, chatId, normalized),
    );
    if (!renamed) throw new ChatApiError('CHAT_NOT_FOUND');
  }
}

function isExpectedUniqueViolation(
  error: unknown,
  constraints: readonly string[],
): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    typeof error.constraint === 'string' &&
    constraints.includes(error.constraint)
  );
}
