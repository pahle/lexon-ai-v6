import type {
  ChatMutationResult,
  EditMessageInput,
  RegenerateInput,
} from '@lexon/contracts';
import { ChatApiError } from '@lexon/contracts';
import {
  AiStepRepository,
  ChatMessageRepository,
  ChatMutationRepository,
  ChatRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import { RunService } from './run.service.js';

export class ChatBranchService {
  private readonly chats = new ChatRepository();
  private readonly messages = new ChatMessageRepository();
  private readonly mutations = new ChatMutationRepository();
  private readonly steps = new AiStepRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: RunService,
    private readonly authorization: RunAuthorizationService,
  ) {}

  async edit(
    actor: RunActor,
    chatId: string,
    messageId: string,
    input: EditMessageInput,
  ): Promise<ChatMutationResult> {
    this.authorization.assertLiveActor(actor);
    if (input.messageId !== messageId) throw new ChatApiError('CHAT_CONFLICT');
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        const chat = await this.chats.lockLive(tx, chatId);
        if (!chat) throw new ChatApiError('CHAT_NOT_FOUND');
        const retry = await this.mutations.findByRequestIdentity(tx, {
          chatId,
          kind: 'edit',
          requestId: input.newMessageId,
        });
        if (retry) {
          const original = await this.messages.branchSource(
            tx,
            chatId,
            messageId,
          );
          if (
            retry.userMessageId !== input.newMessageId ||
            retry.text !== input.text ||
            retry.effort !== input.effort ||
            !original ||
            original.role !== 'user' ||
            retry.parentMessageId !== messageId
          )
            throw new ChatApiError('CHAT_CONFLICT');
          return this.mutations.toMutationResult(retry);
        }
        const source = await this.messages.branchSource(tx, chatId, messageId);
        if (!source || source.role !== 'user')
          throw new ChatApiError('CHAT_CONFLICT');
        if (chat.activeAnswerRunId) throw new ChatApiError('CHAT_CONFLICT');

        try {
          await this.messages.insertUser(tx, {
            chatId,
            messageId: input.newMessageId,
            parentMessageId: source.parentMessageId,
            text: input.text,
            effort: input.effort,
          });
          const { runId } = await this.runs.startWithin(tx, actor, {
            profileId: 'chat',
            prompt: input.text,
            effort: input.effort,
            resourceIds: [chatId],
          });
          await this.chats.associateAnswer(tx, chatId, runId);
          await this.messages.insertAssistant(tx, {
            chatId,
            messageId: runId,
            parentMessageId: input.newMessageId,
            runId,
          });
          await this.mutations.insertMutationRequest(tx, {
            requestId: input.newMessageId,
            kind: 'edit',
            chatId,
            sourceMessageId: messageId,
            userMessageId: input.newMessageId,
            assistantMessageId: runId,
          });
          if (!(await this.chats.selectLeaf(tx, chatId, runId)))
            throw new ChatApiError('CHAT_CONFLICT');
          return {
            chatId,
            userMessageId: input.newMessageId,
            assistantMessageId: runId,
            runId,
          };
        } catch (error) {
          if (
            isExpectedMutationUniqueViolation(error, [
              'chat_messages_pkey',
              'chat_messages_org_id_chat_id_id_key',
              'chat_messages_org_id_run_id_key',
              'chat_mutation_requests_pkey',
            ])
          )
            throw new ChatApiError('CHAT_CONFLICT');
          throw error;
        }
      },
    );
  }

  async regenerate(
    actor: RunActor,
    chatId: string,
    messageId: string,
    input: RegenerateInput,
  ): Promise<ChatMutationResult> {
    this.authorization.assertLiveActor(actor);
    if (input.messageId !== messageId) throw new ChatApiError('CHAT_CONFLICT');
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        const chat = await this.chats.lockLive(tx, chatId);
        if (!chat) throw new ChatApiError('CHAT_NOT_FOUND');
        const retry = await this.mutations.findByRequestIdentity(tx, {
          chatId,
          kind: 'regenerate',
          requestId: input.requestId,
        });
        if (retry) {
          if (retry.parentMessageId !== messageId)
            throw new ChatApiError('CHAT_CONFLICT');
          return this.mutations.toMutationResult(retry);
        }
        const source = await this.messages.branchSource(tx, chatId, messageId);
        if (
          !source ||
          source.role !== 'assistant' ||
          chat.viewedLeafId !== messageId ||
          !(await this.messages.isLeaf(tx, chatId, messageId)) ||
          !source.parentMessageId
        )
          throw new ChatApiError('CHAT_CONFLICT');
        const userTurn = await this.messages.branchSource(
          tx,
          chatId,
          source.parentMessageId,
        );
        if (
          !userTurn ||
          userTurn.role !== 'user' ||
          !userTurn.userText ||
          !userTurn.effort
        )
          throw new ChatApiError('CHAT_CONFLICT');
        if (chat.activeAnswerRunId) throw new ChatApiError('CHAT_CONFLICT');

        try {
          const { runId } = await this.runs.startWithin(tx, actor, {
            profileId: 'chat',
            prompt: userTurn.userText,
            effort: userTurn.effort,
            resourceIds: [chatId],
          });
          await this.chats.associateAnswer(tx, chatId, runId);
          await this.messages.insertAssistant(tx, {
            chatId,
            messageId: runId,
            parentMessageId: source.parentMessageId,
            runId,
          });
          await this.mutations.insertMutationRequest(tx, {
            requestId: input.requestId,
            kind: 'regenerate',
            chatId,
            sourceMessageId: messageId,
            userMessageId: source.parentMessageId,
            assistantMessageId: runId,
          });
          if (!(await this.chats.selectLeaf(tx, chatId, runId)))
            throw new ChatApiError('CHAT_CONFLICT');
          return {
            chatId,
            userMessageId: source.parentMessageId,
            assistantMessageId: runId,
            runId,
          };
        } catch (error) {
          if (
            isExpectedMutationUniqueViolation(error, [
              'chat_messages_pkey',
              'chat_messages_org_id_chat_id_id_key',
              'chat_messages_org_id_run_id_key',
              'chat_mutation_requests_pkey',
            ])
          )
            throw new ChatApiError('CHAT_CONFLICT');
          throw error;
        }
      },
    );
  }

  async selectLeaf(
    actor: RunActor,
    chatId: string,
    leafId: string,
  ): Promise<void> {
    this.authorization.assertLiveActor(actor);
    await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const chat = await this.chats.lockLive(tx, chatId);
        if (!chat) throw new ChatApiError('CHAT_NOT_FOUND');
        if (!(await this.messages.isLeaf(tx, chatId, leafId)))
          throw new ChatApiError('CHAT_CONFLICT');
        if (!(await this.chats.selectLeaf(tx, chatId, leafId)))
          throw new ChatApiError('CHAT_CONFLICT');
      },
    );
  }
}

function isExpectedMutationUniqueViolation(
  error: unknown,
  constraints: readonly string[],
): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown } | null;
  return (
    candidate?.code === '23505' &&
    typeof candidate.constraint === 'string' &&
    constraints.includes(candidate.constraint)
  );
}
