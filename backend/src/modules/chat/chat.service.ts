import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatDetail,
  ChatListScope,
  ChatOperationSnapshot,
  ChatPage,
  ChatMutationResult,
  CreateChatInput,
  SendMessageInput,
} from '@lexon/contracts';
import { ChatApiError } from '@lexon/contracts';
import {
  ChatDetailSchema,
  ChatOperationSnapshotSchema,
  ChatPageSchema,
} from '@lexon/contracts';
import type { RunStreamEvent } from '@lexon/contracts';
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
  ProjectRepository,
  isPgUniqueViolation,
  isRetryableAuthError,
  readTreeValidator,
  TenantDatabase,
  withAuthRetry,
} from '../../infrastructure/db/index.js';
import type {
  CommittedStreamReference,
  TenantSession,
  TerminalStreamReference,
} from '../../infrastructure/db/index.js';
import { requireSession } from '../../infrastructure/db/index.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import type { RunActor, VerifiedIdentity } from '../identity-access/index.js';
import { IdentityError } from '../identity-access/index.js';
import { OrganizationAuthPort } from '../identity-access/index.js';
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

/** F6 §5 row 14 reader view: drop every decisionable payload so the wire op
 * carries only the ids/status/hash core the "Waiting for <owner>" marker
 * needs. The fields are optional on the wire schema, same as the event-byte
 * cap fallback, so this adds no contract surface. */
function stripReaderPayloads(
  operation: ChatOperationSnapshot,
): ChatOperationSnapshot {
  const core = { ...operation };
  delete core.input;
  delete core.display;
  delete core.output;
  return core;
}

/**
 * The service always computes a validator tag, unlike the shared
 * `ChatGetResult` wire shape where a plain 200 may carry no ETag header.
 */
export type ChatServiceGetResult =
  | { notModified: false; tree: ChatDetail; etag: string }
  | { notModified: true; etag: string };

/**
 * Post-commit stream publication for a superseded pause: the dead run's
 * terminal reference for `finish`, plus the settled-op lifecycle events a
 * live claim would have committed (published first, then the finish).
 */
interface SupersededPublication {
  readonly reference: TerminalStreamReference;
  readonly committed: CommittedStreamReference;
  readonly events: readonly RunStreamEvent[];
}

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
  private readonly projects = new ProjectRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly runService: RunService,
    private readonly authorization: RunAuthorizationService,
    private readonly streams?: RunStreams,
    private readonly port?: OrganizationAuthPort,
  ) {}

  /**
   * F6 §10: reader labels carry the owner's display name, resolved through
   * the auth-side member directory (lexon_app never reads auth tables).
   * Callers invoke this OUTSIDE the tenant transaction: a directory call
   * must never hold a tenant connection. A departed or unresolvable owner
   * simply yields no name — the wire field is optional and the UI falls
   * back to the generic read-only label; a directory failure degrades the
   * same way, never a 500 on a read.
   */
  private async memberNames(
    identity: VerifiedIdentity,
    orgId: string,
    userIds: ReadonlySet<string>,
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (!this.port || userIds.size === 0) return names;
    try {
      await this.port.transaction(identity, async (tx, headers) => {
        const result = await tx.call('listMembers', {
          headers,
          query: {
            organizationId: orgId,
            limit: 100,
            filterField: 'userId',
            filterOperator: 'in',
            filterValue: [...userIds],
          },
        });
        for (const member of result.members)
          if (userIds.has(member.userId))
            names.set(member.userId, member.user.name);
      });
    } catch {
      // The member directory is a best-effort label source.
    }
    return names;
  }

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
        // F6 §4.3/§6: the binding is checked through the access definer so a
        // denied or absent project answers the identical 404, while an org
        // member who merely lacks owner/editor standing gets 403. The
        // create-request INSERT policy stays the backstop.
        if (input.projectId !== undefined) {
          const access = await this.projects.access(tx, input.projectId);
          if (access === 'none') throw new IdentityError('NOT_FOUND', 404);
          if (access !== 'owner' && access !== 'editor')
            throw new IdentityError('ORG_FORBIDDEN', 403);
        }
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
            retry.effort !== input.effort ||
            retry.projectId !== (input.projectId ?? null)
          )
            throw new ChatApiError('CHAT_CONFLICT');
          return this.mutations.toMutationResult(retry);
        }

        if (await this.chats.lockLive(tx, input.chatId))
          throw new ChatApiError('CHAT_CONFLICT');
        try {
          await this.chats.insert(
            tx,
            input.chatId,
            titleExcerpt(input.text),
            input.projectId,
          );
          await this.messages.insertUser(tx, {
            chatId: input.chatId,
            messageId: input.userMessageId,
            parentMessageId: null,
            text: input.text,
            effort: input.effort,
          });
          const { runId } = await this.runService.startWithin(tx, actor, {
            // F6 §9: project-bound chats run the project-chat profile so the
            // project context provider is selected. The chat row is already
            // bound, so the capability gate resolves project standing from it.
            profileId: input.projectId ? 'project-chat' : 'chat',
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
            ...(input.projectId ? { projectId: input.projectId } : {}),
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
    const outcome = await withAuthRetry(
      () =>
        this.database.withTenant(
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
            if (
              await this.deletions.wasDeleted(
                tx,
                'message',
                input.userMessageId,
              )
            )
              throw new ChatApiError('CHAT_CONFLICT');
            // §6.4 owner ruling A: a send while an undecided panel is open
            // resolves the paused call in this same transaction, completes the
            // run and continues as a normal send. Any other active answer still
            // conflicts exactly as before.
            let superseded: SupersededPublication | undefined;
            if (chat.activeAnswerRunId) {
              superseded = await this.supersedePausedRun(
                tx,
                actor,
                chatId,
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
                // F6 §9: project-bound chats run the project-chat profile so
                // the project context provider is selected by contextBudgets
                // alone.
                profileId: chat.projectId ? 'project-chat' : 'chat',
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
        ),
      { retryable: isRetryableAuthError },
    );
    if (outcome.superseded) {
      // The settled ops close out on the dead run's stream before its
      // terminal finish, exactly like a live claim's committed lifecycle.
      await this.streams?.publishCommitted(
        outcome.superseded.committed,
        outcome.superseded.events,
      );
      await this.streams?.finish(outcome.superseded.reference, {
        version: 1,
        runId: outcome.superseded.reference.runId,
        type: 'finish',
      });
    }
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
    chatId: string,
    runId: string,
  ): Promise<SupersededPublication | undefined> {
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
    const leftovers = (
      await this.operations.failUnresolvedForSupersede(tx, { runId })
    ).toSorted((left, right) => left.callOccurrence - right.callOccurrence);
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
    const reference = await this.runs.terminalStreamReference(tx, runId);
    if (!reference) return undefined;
    const pausedStep = await this.steps.find(tx, {
      runId: run.id,
      sequence: run.nextSequence - 1,
    });
    if (!pausedStep || pausedStep.state !== 'awaiting_approval')
      return undefined;
    // The pause settled ops the way the executor's committed lifecycle maps
    // them: rejected/dismissed/expired → tool-output-denied, settled-with-
    // result states → tool-output-available carrying the stored result.
    const events: RunStreamEvent[] = [];
    for (const settled of [superseded, ...leftovers]) {
      const wireStatus =
        settled.status === 'succeeded' ? 'completed' : settled.status;
      events.push({
        version: 1,
        runId: run.id,
        type: 'operation-status',
        operationId: settled.id,
        status: wireStatus,
      });
      if (
        settled.status === 'rejected' ||
        settled.status === 'dismissed' ||
        settled.status === 'expired'
      ) {
        events.push({
          version: 1,
          runId: run.id,
          type: 'tool-output-denied',
          toolCallId: settled.id,
        });
      } else if (
        settled.status === 'succeeded' ||
        settled.status === 'failed' ||
        settled.status === 'outcome_unknown' ||
        settled.status === 'answered'
      ) {
        events.push({
          version: 1,
          runId: run.id,
          type: 'tool-output-available',
          toolCallId: settled.id,
          operationId: settled.id,
          output: settled.result ?? null,
        });
      }
    }
    // §6.5: the superseded pause invalidates the chat view — the notify
    // fires at this send transaction's commit, after the run closed.
    const { client } = requireSession(tx);
    await client.query(`SELECT pg_notify('lexon_chat_title', $1)`, [
      JSON.stringify({
        orgId: actor.orgId,
        chatId,
      }),
    ]);
    const committed: CommittedStreamReference = {
      runId: run.id,
      orgId: actor.orgId,
      userId: actor.userId,
      stepId: pausedStep.id,
      sequence: pausedStep.sequence,
      expectedVersion: pausedStep.expectedVersion,
      fence: pausedStep.fence,
      committedRunVersion: run.runVersion + 1,
      committedStatus: 'completed',
    };
    return { reference, committed, events };
  }

  async get(
    actor: RunActor,
    chatId: string,
    options?: { ifNoneMatch?: string | undefined },
    identity?: VerifiedIdentity,
  ): Promise<ChatServiceGetResult> {
    this.authorization.assertLiveActor(actor);
    const result = await this.database.withTenant(
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
          return { notModified: true as const, etag };
        }
        const tree = await this.messages.tree(tx, chatId);
        if (!tree) throw new ChatApiError('CHAT_NOT_FOUND');
        // F6 §5 row 14: only the owner gets decisionable payloads — readers
        // (project members, share recipients) see the op core so the UI can
        // render the "Waiting for <owner>" marker, but input/display/output
        // never leave the server for them.
        const readerView = chat.ownerUserId !== actor.userId;
        // F6 §10: the matter label is a tenant read and stays inside the
        // transaction; the owner's name is an auth-directory call and must
        // resolve after the transaction closes.
        const projectName =
          readerView && chat.projectId !== null
            ? ((await this.projects.find(tx, chat.projectId))?.name ??
              undefined)
            : undefined;
        return {
          notModified: false as const,
          etag,
          chat,
          tree,
          readerView,
          projectName,
        };
      },
    );
    if (result.notModified) return result;
    const { etag, chat, tree, readerView, projectName } = result;
    // F6 §10: a reader's chrome labels name the owner and, on project
    // chats, the matter ("<owner>'s chat · read-only" / "Shared by
    // <name>"). Both stay absent for the owner and both degrade to the
    // generic label when they cannot be resolved.
    const readerNames =
      readerView && identity !== undefined
        ? {
            ...(chat.projectId === null ? {} : { projectName }),
            ownerName: (
              await this.memberNames(
                identity,
                actor.orgId,
                new Set([chat.ownerUserId]),
              )
            ).get(chat.ownerUserId),
          }
        : {};
    const parsed = ChatDetailSchema.parse({
      id: chatId,
      title: chat.title || 'New chat',
      access: readerView ? ('reader' as const) : ('owner' as const),
      ...readerNames,
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
              operations: readerView
                ? z
                    .array(ChatOperationSnapshotSchema)
                    .parse(message.operations)
                    .map(stripReaderPayloads)
                : z
                    .array(ChatOperationSnapshotSchema)
                    .parse(message.operations),
              createdAt: message.createdAt.toISOString(),
            };
      }),
      viewedLeafId: tree.viewedLeafId,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    });
    return { notModified: false, etag, tree: parsed };
  }

  async list(
    actor: RunActor,
    input: { cursor?: string; limit?: number; scope?: ChatListScope } = {},
    identity?: VerifiedIdentity,
  ): Promise<ChatPage> {
    this.authorization.assertLiveActor(actor);
    const request = z
      .strictObject({
        cursor: z.string().min(1).max(256).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        scope: z.enum(['own', 'shared']).default('own'),
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
    const { pageRows, hasMore } = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const rows = await this.searchRepository.list(
          tx,
          cursor ? { activityAt: cursor[2], chatId: cursor[3] } : null,
          request.limit + 1,
          request.scope,
        );
        const more = rows.length > request.limit;
        return {
          pageRows: more ? rows.slice(0, request.limit) : rows,
          hasMore: more,
        };
      },
    );
    // F6 §10: shared-scope rows render "Shared by <name>" — resolved
    // through the member directory AFTER the tenant transaction closes,
    // omitted when a departed owner's name cannot be resolved.
    const ownerNames =
      request.scope === 'shared' && identity !== undefined
        ? await this.memberNames(
            identity,
            actor.orgId,
            new Set(pageRows.map((row) => row.owner_user_id)),
          )
        : new Map<string, string>();
    const items = pageRows.map((row) => ({
      id: row.id,
      title: row.title || 'New chat',
      updatedAt: row.updated_at.toISOString(),
      lastMessageAt: row.last_message_at?.toISOString() ?? null,
      awaitingUser: row.awaiting_user,
      ...(row.project_name === null ? {} : { projectName: row.project_name }),
      ...(ownerNames.has(row.owner_user_id)
        ? { ownerName: ownerNames.get(row.owner_user_id) }
        : {}),
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
