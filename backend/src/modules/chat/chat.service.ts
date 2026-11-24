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
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  ChatMessageRepository,
  ChatMutationRepository,
  ChatRepository,
  ChatDeletionRepository,
  ChatSearchRepository,
  isPgUniqueViolation,
  readTreeValidator,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type {
  TenantSession,
  TerminalStreamReference,
} from '../../infrastructure/db/index.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import { AuditService } from '../audit/index.js';
import { RunService } from './run.service.js';
import { titleExcerpt } from './chat-title.service.js';
import { weakMatch } from './etag.js';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The service always computes a validator tag, unlike the shared
 * `ChatGetResult` wire shape where a plain 200 may carry no ETag header.
 */
export type ChatServiceGetResult =
  | { notModified: false; tree: SharedChatTree; etag: string }
  | { notModified: true; etag: string };

export class ChatService {
  private readonly chats = new ChatRepository();
  private readonly messages = new ChatMessageRepository();
  private readonly mutations = new ChatMutationRepository();
  private readonly steps = new AiStepRepository();
  private readonly runs = new AiRunRepository();
  private readonly operations = new AiOperationRepository();
  private readonly audit = new AuditService();
  private readonly deletions = new ChatDeletionRepository();
  private readonly searchRepository = new ChatSearchRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly runService: RunService,
    private readonly authorization: RunAuthorizationService,
    private readonly streams?: RunStreams,
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
            isPgUniqueViolation(error, [
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
    const outcome = await this.database.withTenant(
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
          return {
            result: this.mutations.toMutationResult(retry),
            superseded: undefined,
          };
        }
        if (await this.deletions.wasDeleted(tx, 'message', input.userMessageId))
          throw new ChatApiError('CHAT_CONFLICT');
        // §6.4 owner ruling A: a send while an undecided panel is open
        // resolves the paused call in this same transaction, completes the
        // run and continues as a normal send. Any other active answer still
        // conflicts exactly as before.
        let superseded: TerminalStreamReference | undefined;
        if (chat.activeAnswerRunId) {
          superseded = await this.supersedePausedRun(
            tx,
            actor,
            chat.activeAnswerRunId,
          );
          if (!superseded) throw new ChatApiError('CHAT_CONFLICT');
        }

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
            result: {
              chatId,
              userMessageId: input.userMessageId,
              assistantMessageId: runId,
              runId,
            },
            superseded,
          };
        } catch (error) {
          if (
            isPgUniqueViolation(error, [
              'chat_messages_pkey',
              'chat_one_active_answer',
            ])
          )
            throw new ChatApiError('CHAT_CONFLICT');
          throw error;
        }
      },
    );
    if (outcome.superseded)
      await this.streams?.finish(outcome.superseded, {
        version: 1,
        runId: outcome.superseded.runId,
        type: 'finish',
      });
    return outcome.result;
  }

  /**
   * §6.4 one-transaction supersede: while the chat lock is held, CAS the
   * still-waiting panel op to its kind-appropriate settled state (approval
   * → rejected {denied:'superseded'}, question → dismissed
   * {answered_in_chat:true}), settle leftover pending ops failed with
   * {not_run:'superseded_by_message'}, record the decided + run_finished
   * audits and complete the run so the normal send insertions can link the
   * new answer run underneath the freed pointer. Returns the dead run's
   * terminal stream reference for the post-commit finish event, or
   * undefined when the pause cannot be superseded (decided op, resumed or
   * finished run, lost CAS) — the caller then throws CHAT_CONFLICT and the
   * whole send rolls back.
   */
  private async supersedePausedRun(
    tx: TenantSession,
    actor: RunActor,
    runId: string,
  ): Promise<TerminalStreamReference | undefined> {
    const run = await this.runs.find(tx, runId);
    if (!run || run.status !== 'awaiting_approval') return undefined;
    const operation = (
      await this.operations.forRun(tx, {
        runId,
        throughSequence: run.nextSequence,
      })
    ).find(
      (candidate) =>
        candidate.status === 'awaiting_approval' && candidate.decision == null,
    );
    if (!operation) return undefined;
    const superseded = await this.operations.supersedeForMessage(tx, {
      runId,
      operationId: operation.id,
      userId: actor.userId,
    });
    if (!superseded) return undefined;
    await this.operations.failUnresolvedForSupersede(tx, { runId });
    const provider = asRecord(run.resolvedConfig).provider;
    if (
      typeof provider !== 'string' ||
      !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider)
    )
      throw new Error('Invalid AI run provider');
    const occurredAt = new Date().toISOString();
    if (superseded.kind === 'question') {
      await this.audit.append(tx, {
        version: 1,
        eventId: randomUUID(),
        type: 'chat.question_decided.v1',
        occurredAt,
        outcome: 'success',
        orgId: actor.orgId,
        actorUserId: actor.userId,
        metadata: {
          runId: run.id,
          operationId: superseded.id,
          status: 'dismissed',
          reason: 'superseded_by_message',
        },
      });
    } else {
      await this.audit.append(tx, {
        version: 1,
        eventId: randomUUID(),
        type: 'chat.approval_decided.v1',
        occurredAt,
        outcome: 'success',
        orgId: actor.orgId,
        actorUserId: actor.userId,
        metadata: {
          runId: run.id,
          operationId: superseded.id,
          status: 'rejected',
          reason: 'superseded_by_message',
        },
      });
    }
    await this.audit.append(tx, {
      version: 1,
      eventId: randomUUID(),
      type: 'chat.run_finished.v1',
      occurredAt,
      outcome: 'success',
      orgId: actor.orgId,
      actorUserId: actor.userId,
      metadata: {
        runId: run.id,
        model: run.modelId,
        provider,
        status: 'completed',
      },
    });
    // finalizeOutput keeps the dead run's partial text as its final output;
    // the terminal-pointer trigger frees chats.active_answer_run_id on this
    // update so associateAnswer can take the slot below.
    if (
      !(await this.runs.transition(tx, {
        runId: run.id,
        expectedVersion: run.runVersion,
        from: 'awaiting_approval',
        to: 'completed',
        finalizeOutput: true,
      }))
    )
      return undefined;
    return this.runs.terminalStreamReference(tx, runId);
  }

  async get(
    actor: RunActor,
    chatId: string,
    options?: { ifNoneMatch?: string | undefined },
  ): Promise<ChatServiceGetResult> {
    this.authorization.assertLiveActor(actor);
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const chat = await this.chats.readLive(tx, chatId);
        if (!chat) throw new ChatApiError('CHAT_NOT_FOUND');
        // Validator before tree: the reads do not share a snapshot under READ
        // COMMITTED, so this order keeps the body never older than its tag.
        // A write in between may cost an extra 200, never a stale 304.
        const etag = await readTreeValidator(tx, chatId);
        if (!etag) throw new ChatApiError('CHAT_NOT_FOUND');
        if (weakMatch(options?.ifNoneMatch, etag)) {
          return { notModified: true, etag };
        }
        const tree = await this.messages.tree(tx, chatId);
        if (!tree) throw new ChatApiError('CHAT_NOT_FOUND');
        const parsed = ChatTreeSchema.parse({
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
                  // Per-run operation summaries are populated by the F5
                  // stream-publisher task; the wire field is required.
                  operations: [],
                  createdAt: message.createdAt.toISOString(),
                };
          }),
          viewedLeafId: tree.viewedLeafId,
          createdAt: chat.createdAt.toISOString(),
          updatedAt: chat.updatedAt.toISOString(),
        });
        return { notModified: false, etag, tree: parsed };
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
        if (cursor[1] !== ownerDigest(actor)) throw new Error();
      } catch {
        throw new ChatApiError('CHAT_CONFLICT');
      }
    }
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const rows = await this.searchRepository.list(
          tx,
          cursor ? { activityAt: cursor[2], chatId: cursor[3] } : null,
          request.limit + 1,
        );
        const hasMore = rows.length > request.limit;
        const pageRows = hasMore ? rows.slice(0, request.limit) : rows;
        const items = pageRows.map((row) => ({
          id: row.id,
          title: row.title || 'New chat',
          updatedAt: row.updated_at.toISOString(),
          lastMessageAt: row.last_message_at?.toISOString() ?? null,
          // Awaiting-decision flag is wired by the F5 stream-publisher task;
          // the wire field is a required boolean.
          awaitingUser: false,
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
      async (tx) => {
        const didRename = await this.chats.rename(tx, chatId, normalized);
        if (!didRename) return false;
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          type: 'chat.renamed.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'success',
          orgId: actor.orgId,
          actorUserId: actor.userId,
          metadata: { chatId },
        });
        return true;
      },
    );
    if (!renamed) throw new ChatApiError('CHAT_NOT_FOUND');
  }
}
