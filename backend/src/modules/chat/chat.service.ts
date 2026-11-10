import { randomUUID } from 'node:crypto';
import type {
  ChatMutationResult,
  ChatTree as SharedChatTree,
  CreateChatInput,
  SendMessageInput,
} from '@lexon/contracts';
import { ChatApiError } from '@lexon/contracts';
import { RunStatusSchema } from '@lexon/contracts';
import {
  AiStepRepository,
  ChatMessageRepository,
  ChatMutationRepository,
  ChatRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import { AuditService } from '../audit/index.js';
import { RunService } from './run.service.js';

export class ChatService {
  private readonly chats = new ChatRepository();
  private readonly messages = new ChatMessageRepository();
  private readonly mutations = new ChatMutationRepository();
  private readonly steps = new AiStepRepository();
  private readonly audit = new AuditService();

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
          await this.chats.insert(tx, input.chatId);
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
        return {
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
                  feedback: null,
                  createdAt: message.createdAt.toISOString(),
                };
          }),
          viewedLeafId: tree.viewedLeafId,
          createdAt: chat.createdAt.toISOString(),
          updatedAt: chat.updatedAt.toISOString(),
        };
      },
    );
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
