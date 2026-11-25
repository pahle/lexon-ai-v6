import type {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  CommittedStreamReference,
  OperationRecord,
  OutboxRepository,
  TenantSession,
  TerminalStreamReference,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import { requireSession } from '../../infrastructure/db/index.js';
import {
  AskUserToolInputSchema,
  ChatApiError,
  type OperationAnswer,
  type OperationDecisionResult,
} from '@lexon/contracts';
import type { RunActor } from '../identity-access/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';
import { IdentityError } from '../identity-access/index.js';
import { stepJobId } from './step-job-id.js';
import type { RunRegistry } from './run-registry.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import { AuditService } from '../audit/index.js';
import { randomUUID } from 'node:crypto';

interface DecideInput {
  readonly runId: string;
  readonly operationId: string;
  readonly snapshotHash: string;
  readonly decision: 'approve' | 'reject' | 'answer' | 'dismiss';
  /** Required when decision is 'answer'; validated against the asked questions. */
  readonly answers?: readonly OperationAnswer[];
}

interface DecideOptions {
  /**
   * HTTP route scope: the run must resolve through an owned chat, and absent
   * runs/operations map to the identical CHAT_NOT_FOUND a random id gets.
   * Service callers leave this off (initiator check + refusal stays).
   */
  readonly requireOwnedChat?: boolean;
}

type DecidePublication =
  | { readonly kind: 'stored'; readonly outcome: OperationDecisionResult }
  | { readonly kind: 'terminal'; readonly reference: TerminalStreamReference }
  | {
      readonly kind: 'resume';
      readonly reference: CommittedStreamReference;
      readonly outcome: OperationDecisionResult;
      readonly operationId: string;
      readonly operationStatus: OperationRecord['status'];
    };

export class ApprovalService {
  private readonly audit = new AuditService();
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly operations: AiOperationRepository,
    private readonly facts: RunActorFactsRepository,
    private readonly authorization: RunAuthorizationService,
    private readonly outbox: OutboxRepository,
    private readonly registry: RunRegistry,
    private readonly streams?: RunStreams,
  ) {}

  async decideOperation(
    actor: RunActor,
    input: DecideInput,
    options?: DecideOptions,
  ): Promise<OperationDecisionResult> {
    this.authorization.assertLiveActor(actor);
    const ownedChat = options?.requireOwnedChat === true;
    const publication = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx): Promise<DecidePublication> => {
        if (
          ownedChat &&
          !(await this.runs.existsForAccessibleChat(
            tx,
            input.runId,
            actor.userId,
          ))
        )
          throw new ChatApiError('CHAT_NOT_FOUND');
        const run = await this.runs.find(tx, input.runId);
        if (!run || run.initiatingUserId !== actor.userId) {
          if (ownedChat) throw new ChatApiError('CHAT_NOT_FOUND');
          throw new Error('AI approval decision refused');
        }
        const operation = (
          await this.operations.forRun(tx, {
            runId: input.runId,
            throughSequence: run.nextSequence,
          })
        ).find((candidate) => candidate.id === input.operationId);
        if (!operation) {
          if (ownedChat) throw new ChatApiError('CHAT_NOT_FOUND');
          throw new Error('AI approval decision refused');
        }
        // Idempotent outcome: a decided (or expired) operation returns its
        // stored state before any status or payload validation. This is what
        // makes a losing decide-vs-send race read as a 200, not an error.
        if (operation.decision != null || operation.status === 'expired')
          return { kind: 'stored', outcome: storedOutcome(operation) };
        if (run.status !== 'awaiting_approval')
          throw new Error('AI approval decision refused');
        const validAction =
          operation.kind === 'approval'
            ? input.decision === 'approve' || input.decision === 'reject'
            : input.decision === 'answer' || input.decision === 'dismiss';
        if (!validAction)
          throw new IdentityError('VALIDATION_ERROR', 400, [
            { path: 'action', message: 'Invalid decision' },
          ]);
        const answerResult =
          input.decision === 'answer'
            ? { answers: validatedAnswers(operation.args, input.answers) }
            : undefined;
        const facts = await this.facts.read(tx, {
          orgId: actor.orgId,
          userId: actor.userId,
          runId: input.runId,
        });
        const snapshot = asRecord(run.resolvedConfig).profileSnapshot;
        const capabilities = asRecord(snapshot).capabilities;
        const currentProfile = this.registry.profile(run.profileId);
        const currentCapabilities = Array.isArray(capabilities)
          ? capabilities.filter(
              (value): value is string =>
                typeof value === 'string' &&
                Boolean(currentProfile?.capabilities.includes(value)),
            )
          : [];
        const decision =
          facts && currentProfile
            ? await this.authorization.authorize(
                tx,
                facts,
                {
                  profileId: run.profileId,
                  capabilities: currentCapabilities,
                },
                'decision',
              )
            : null;
        if (!decision?.mayDecide) {
          // The access-loss settle path is approval-shaped; a question panel
          // for a revoked actor is refused rather than recorded as 'reject'.
          if (operation.kind !== 'approval')
            throw new Error('AI approval decision refused');
          const rejected = await this.operations.rejectApprovalForAccessLoss(
            tx,
            {
              runId: input.runId,
              operationId: input.operationId,
              snapshotHash: input.snapshotHash,
              initiatorUserId: run.initiatingUserId,
            },
          );
          if (!rejected) throw new Error('AI approval decision refused');
          if (
            !(await this.runs.transition(tx, {
              runId: run.id,
              expectedVersion: run.runVersion,
              from: 'awaiting_approval',
              to: 'failed',
              errorCode: 'AI_ACCESS_REVOKED',
            }))
          )
            throw new Error('AI approval decision refused');
          const provider = asRecord(run.resolvedConfig).provider;
          if (
            typeof provider !== 'string' ||
            !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider)
          )
            throw new Error('AI approval decision refused');
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.tool_operation.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'failure',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: {
              runId: run.id,
              stepId: operation.stepId,
              operationId: operation.id,
              model: run.modelId,
              provider,
              status: 'failed',
            },
          });
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.run_finished.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'failure',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: {
              runId: run.id,
              model: run.modelId,
              provider,
              status: 'failed',
              safeCode: 'AI_ACCESS_REVOKED',
            },
          });
          const reference = await this.runs.terminalStreamReference(tx, run.id);
          if (!reference) throw new Error('AI approval decision refused');
          await this.#notifyChatInvalidated(tx, run.id);
          return { kind: 'terminal', reference };
        }
        const updated = await this.operations.decideApproval(tx, {
          runId: input.runId,
          operationId: input.operationId,
          snapshotHash: input.snapshotHash,
          userId: actor.userId,
          decision: input.decision,
          ...(answerResult ? { result: answerResult } : {}),
        });
        if (!updated) {
          // CAS loss: a concurrent decision may have landed between the read
          // and the update. Re-read — a decided row still yields its stored
          // outcome; only a live-but-rejected CAS (hash mismatch) refuses.
          const reread = (
            await this.operations.forRun(tx, {
              runId: input.runId,
              throughSequence: run.nextSequence,
            })
          ).find((candidate) => candidate.id === input.operationId);
          if (
            reread &&
            (reread.decision != null || reread.status === 'expired')
          )
            return { kind: 'stored', outcome: storedOutcome(reread) };
          throw new Error('AI approval decision refused');
        }
        const provider = asRecord(run.resolvedConfig).provider;
        if (
          typeof provider !== 'string' ||
          !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider)
        )
          throw new Error('AI approval decision refused');
        const decidedMetadata = {
          runId: run.id,
          operationId: updated.id,
        };
        if (updated.kind === 'question') {
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.question_decided.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'success',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: {
              ...decidedMetadata,
              status: updated.status === 'answered' ? 'answered' : 'dismissed',
            },
          });
        } else {
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.approval_decided.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'success',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: {
              ...decidedMetadata,
              status: updated.status === 'approved' ? 'approved' : 'rejected',
            },
          });
        }
        const sequence = run.nextSequence;
        const expectedVersion = run.runVersion + 1;
        if (
          !(await this.runs.transition(tx, {
            runId: run.id,
            expectedVersion: run.runVersion,
            from: 'awaiting_approval',
            to: 'running',
          }))
        )
          throw new Error('AI approval decision refused');
        await this.steps.insertInitial(tx, {
          id: randomUUID(),
          runId: run.id,
          sequence,
          expectedVersion,
        });
        await this.outbox.append(
          tx,
          {
            type: 'run.resume.v1',
            ctx: { orgId: actor.orgId, userId: actor.userId },
            payload: { runId: run.id, sequence, expectedVersion },
          },
          {
            id: stepJobId(run.id, sequence),
            ...(isRouting(run.resolvedConfig)
              ? {
                  queue: run.resolvedConfig.queue,
                  priority: run.resolvedConfig.priority,
                }
              : {}),
          },
        );
        const priorStep = await this.steps.find(tx, {
          runId: run.id,
          sequence: run.nextSequence - 1,
        });
        if (!priorStep || priorStep.state !== 'awaiting_approval')
          throw new Error('AI approval decision refused');
        const reference: CommittedStreamReference = {
          runId: run.id,
          orgId: actor.orgId,
          userId: actor.userId,
          stepId: priorStep.id,
          sequence: priorStep.sequence,
          expectedVersion: priorStep.expectedVersion,
          fence: priorStep.fence,
          committedRunVersion: expectedVersion,
          committedStatus: 'running',
        };
        await this.#notifyChatInvalidated(tx, run.id);
        return {
          kind: 'resume',
          reference,
          outcome: storedOutcome(updated),
          operationId: updated.id,
          operationStatus: updated.status,
        };
      },
    );
    if (publication.kind === 'terminal') {
      await this.streams?.finish(publication.reference, {
        version: 1,
        runId: input.runId,
        type: 'finish',
      });
      throw new Error('AI approval decision refused');
    }
    if (publication.kind === 'resume') {
      await this.streams?.publishCommitted(publication.reference, [
        {
          version: 1,
          runId: input.runId,
          type: 'status',
          status: 'running',
        },
        {
          version: 1,
          runId: input.runId,
          type: 'operation-status',
          operationId: publication.operationId,
          status:
            publication.operationStatus === 'succeeded'
              ? 'completed'
              : publication.operationStatus,
        },
      ]);
    }
    return publication.outcome;
  }

  /**
   * §6.5: a decided (or access-loss-settled) panel invalidates the chat view.
   * The notify lands at this transaction's commit; runs not bound to a chat
   * simply find no `chat_runs` row and emit nothing.
   */
  async #notifyChatInvalidated(tx: TenantSession, runId: string) {
    const { client, ctx } = requireSession(tx);
    const link = await client.query<{ chat_id: string }>(
      `SELECT chat_id FROM app.chat_runs
       WHERE org_id=$1 AND run_id=$2 AND kind='answer'`,
      [ctx.orgId, runId],
    );
    for (const row of link.rows) {
      await client.query(`SELECT pg_notify('lexon_chat_title', $1)`, [
        JSON.stringify({
          orgId: ctx.orgId,
          chatId: row.chat_id,
        }),
      ]);
    }
  }
}

/** Maps a persisted op row to the wire result; 'succeeded' reads 'completed'. */
function storedOutcome(operation: OperationRecord): OperationDecisionResult {
  return {
    operationId: operation.id,
    status: operation.status === 'succeeded' ? 'completed' : operation.status,
    decision: operation.decision ?? null,
    decidedAt: operation.decidedAt?.toISOString() ?? null,
  };
}

/**
 * §6.3 answer validation: every asked question answered exactly once, and the
 * choice shape fits the question kind (single→option, multiple→options,
 * text→text; 'skipped' fits any kind; free text only where the question
 * allows it). Malformed persisted args are a data-invariant failure, not a
 * client error.
 */
function validatedAnswers(
  args: unknown,
  answers: readonly OperationAnswer[] | undefined,
): OperationAnswer[] {
  const parsed = AskUserToolInputSchema.safeParse(args);
  if (!parsed.success) throw new Error('AI approval decision refused');
  const issues: { path: string; message: string }[] = [];
  if (answers === undefined) {
    issues.push({ path: 'answers', message: 'Invalid answers' });
    throw new IdentityError('VALIDATION_ERROR', 400, issues);
  } else {
    const questions = parsed.data.questions;
    const byId = new Map(questions.map((q) => [q.questionId, q]));
    if (
      answers.length !== questions.length ||
      answers.some((answer) => !byId.has(answer.questionId))
    )
      issues.push({ path: 'answers', message: 'Invalid answers' });
    answers.forEach((answer, index) => {
      const question = byId.get(answer.questionId);
      if (!question) return;
      const choice = answer.choice;
      let valid = false;
      if (choice.kind === 'skipped') {
        valid = true;
      } else if (choice.kind === 'option') {
        valid =
          question.kind === 'single' && choice.index < question.options.length;
      } else if (choice.kind === 'options') {
        valid =
          question.kind === 'multiple' &&
          choice.indexes.every(
            (optionIndex) => optionIndex < question.options.length,
          );
      } else if (choice.kind === 'text') {
        valid = question.kind === 'text' || question.allowFreeText === true;
      }
      if (!valid)
        issues.push({ path: `answers.${index}`, message: 'Invalid choice' });
    });
  }
  if (issues.length > 0)
    throw new IdentityError('VALIDATION_ERROR', 400, issues);
  return [...(answers ?? [])];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRouting(value: unknown): value is Record<string, unknown> & {
  queue: 'ai-interactive' | 'ai-batch';
  priority: number;
} {
  const record = asRecord(value);
  return (
    (record.queue === 'ai-interactive' || record.queue === 'ai-batch') &&
    typeof record.priority === 'number'
  );
}
