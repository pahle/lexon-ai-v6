import { randomUUID } from 'node:crypto';
import type {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  CommittedStreamReference,
  ExpiredOperationCandidate,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
  TenantSession,
  TerminalStreamReference,
} from '../../infrastructure/db/index.js';
import { requireSession } from '../../infrastructure/db/index.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import { AuditService } from '../audit/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';
import { stepJobId } from './step-job-id.js';
import type { RunRegistry } from './run-registry.js';

export interface OperationExpirySweepLogger {
  warn(event: Record<string, unknown>): void;
}

export interface OperationExpirySweepOptions {
  readonly database: TenantDatabase;
  readonly runs: AiRunRepository;
  readonly steps: AiStepRepository;
  readonly operations: AiOperationRepository;
  readonly facts: RunActorFactsRepository;
  readonly authorization: RunAuthorizationService;
  readonly outbox: OutboxRepository;
  readonly registry: RunRegistry;
  readonly streams?: RunStreams;
  readonly logger?: OperationExpirySweepLogger;
}

/** Per-candidate commit outcome; stream publication happens after commit. */
type SweepPublication =
  | { readonly kind: 'skipped' }
  | {
      readonly kind: 'terminal';
      readonly runId: string;
      readonly reference: TerminalStreamReference;
    }
  | {
      readonly kind: 'resume';
      readonly reference: CommittedStreamReference;
      readonly operationId: string;
    };

const CANDIDATE_BATCH = 64;

/**
 * §7 expiry sweep: the BullMQ-scheduled `ai.operation-expiry.v1` job calls
 * `sweep()`, which lists `app.ai_expired_operations(64)` cross-tenant (ids
 * only) and settles each candidate inside its own `withTenant` transaction
 * keyed on the run initiator — expire CAS → actor-less decided audit →
 * resume authorization → run back to `running` plus the `run.resume.v1`
 * outbox job, or `failed`/`AI_ACCESS_REVOKED` when the initiator lost
 * access. Every candidate runs in its own try/catch and transaction, so one
 * bad candidate never blocks the rest of the batch.
 */
export class OperationExpirySweep {
  private readonly audit = new AuditService();

  constructor(private readonly options: OperationExpirySweepOptions) {}

  async sweep(): Promise<void> {
    const candidates =
      await this.options.operations.listExpired(CANDIDATE_BATCH);
    for (const candidate of candidates) {
      try {
        const publication = await this.#expireCandidate(candidate);
        if (publication.kind === 'terminal')
          await this.options.streams?.finish(publication.reference, {
            version: 1,
            runId: publication.runId,
            type: 'finish',
          });
        if (publication.kind === 'resume')
          await this.options.streams?.publishCommitted(publication.reference, [
            {
              version: 1,
              runId: publication.reference.runId,
              type: 'status',
              status: 'running',
            },
            {
              version: 1,
              runId: publication.reference.runId,
              type: 'operation-status',
              operationId: publication.operationId,
              status: 'expired',
            },
          ]);
      } catch {
        // Queue errors never leak payloads: one fixed safe code per failure.
        this.options.logger?.warn({
          event: 'ai_operation_expiry_candidate_failed',
          runId: candidate.runId,
          operationId: candidate.id,
          safeCode: 'AI_INTERNAL',
        });
      }
    }
  }

  async #expireCandidate(
    candidate: ExpiredOperationCandidate,
  ): Promise<SweepPublication> {
    return this.options.database.withTenant(
      { orgId: candidate.orgId, userId: candidate.initiatingUserId },
      async (tx): Promise<SweepPublication> => {
        // The CAS re-checks status/decision/expires_at inside the
        // transaction; a concurrent decide or supersede makes this a no-op.
        const operation = await this.options.operations.expire(tx, {
          runId: candidate.runId,
          operationId: candidate.id,
        });
        if (!operation) return { kind: 'skipped' };
        // Actor-less by contract: the §8 validator admits a decided event
        // without actorUserId only when metadata.status is 'expired'.
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          type:
            operation.kind === 'question'
              ? 'chat.question_decided.v1'
              : 'chat.approval_decided.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'failure',
          orgId: candidate.orgId,
          metadata: {
            runId: candidate.runId,
            operationId: operation.id,
            status: 'expired',
          },
        });
        // §6.5: an expired panel invalidates the chat view — the notify lands
        // at this transaction's commit whether the run resumes or fails closed.
        await this.#notifyChatInvalidated(tx, candidate);
        const run = await this.options.runs.find(tx, candidate.runId);
        // A run already terminal (cancelled/failed) no longer resumes; the
        // expired op and its audit still commit so it never re-lists.
        if (!run || run.status !== 'awaiting_approval')
          return { kind: 'skipped' };
        const facts = await this.options.facts.read(tx, {
          orgId: candidate.orgId,
          userId: candidate.initiatingUserId,
          runId: run.id,
        });
        const currentProfile = this.options.registry.profile(run.profileId);
        const snapshot = asRecord(run.resolvedConfig).profileSnapshot;
        const capabilities = asRecord(snapshot).capabilities;
        const currentCapabilities = Array.isArray(capabilities)
          ? capabilities.filter(
              (value): value is string =>
                typeof value === 'string' &&
                Boolean(currentProfile?.capabilities.includes(value)),
            )
          : [];
        const decision =
          facts && currentProfile
            ? await this.options.authorization.authorize(
                tx,
                facts,
                {
                  profileId: run.profileId,
                  capabilities: currentCapabilities,
                },
                'resume',
              )
            : null;
        if (!decision?.allowed) {
          // The op stays expired and audited; the paused run fails closed.
          if (
            !(await this.options.runs.transition(tx, {
              runId: run.id,
              expectedVersion: run.runVersion,
              from: 'awaiting_approval',
              to: 'failed',
              errorCode: 'AI_ACCESS_REVOKED',
            }))
          )
            throw new Error('AI operation expiry transition failed');
          // Every terminal run fires run_finished (the approval.service.ts
          // access-loss precedent); the actor is the run initiator like every
          // other run_finished emission — the §8 validator admits no
          // actor-less shape for this type.
          const provider = asRecord(run.resolvedConfig).provider;
          if (
            typeof provider !== 'string' ||
            !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider)
          )
            throw new Error('AI operation expiry transition failed');
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.run_finished.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'failure',
            orgId: candidate.orgId,
            actorUserId: candidate.initiatingUserId,
            metadata: {
              runId: run.id,
              model: run.modelId,
              provider,
              status: 'failed',
              safeCode: 'AI_ACCESS_REVOKED',
            },
          });
          const reference = await this.options.runs.terminalStreamReference(
            tx,
            run.id,
          );
          return reference
            ? { kind: 'terminal', runId: run.id, reference }
            : { kind: 'skipped' };
        }
        const sequence = run.nextSequence;
        const expectedVersion = run.runVersion + 1;
        if (
          !(await this.options.runs.transition(tx, {
            runId: run.id,
            expectedVersion: run.runVersion,
            from: 'awaiting_approval',
            to: 'running',
          }))
        )
          throw new Error('AI operation expiry transition failed');
        await this.options.steps.insertInitial(tx, {
          id: randomUUID(),
          runId: run.id,
          sequence,
          expectedVersion,
        });
        // stepJobId makes the resume at-most-once: a repeated expiry of the
        // same pause cannot enqueue a second resume for this sequence.
        await this.options.outbox.append(
          tx,
          {
            type: 'run.resume.v1',
            ctx: {
              orgId: candidate.orgId,
              userId: candidate.initiatingUserId,
            },
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
        const priorStep = await this.options.steps.find(tx, {
          runId: run.id,
          sequence: run.nextSequence - 1,
        });
        if (!priorStep || priorStep.state !== 'awaiting_approval')
          throw new Error('AI operation expiry transition failed');
        const reference: CommittedStreamReference = {
          runId: run.id,
          orgId: candidate.orgId,
          userId: candidate.initiatingUserId,
          stepId: priorStep.id,
          sequence: priorStep.sequence,
          expectedVersion: priorStep.expectedVersion,
          fence: priorStep.fence,
          committedRunVersion: expectedVersion,
          committedStatus: 'running',
        };
        return { kind: 'resume', reference, operationId: operation.id };
      },
    );
  }

  /**
   * Fires `lexon_chat_title` once per `chat_runs` answer link for the
   * candidate run; non-chat runs have no link row and emit nothing.
   */
  async #notifyChatInvalidated(
    tx: TenantSession,
    candidate: ExpiredOperationCandidate,
  ) {
    const { client } = requireSession(tx);
    const link = await client.query<{ chat_id: string }>(
      `SELECT chat_id FROM app.chat_runs
       WHERE org_id=$1 AND run_id=$2 AND kind='answer'`,
      [candidate.orgId, candidate.runId],
    );
    for (const row of link.rows) {
      await client.query(`SELECT pg_notify('lexon_chat_title', $1)`, [
        JSON.stringify({
          orgId: candidate.orgId,
          userId: candidate.initiatingUserId,
          chatId: row.chat_id,
        }),
      ]);
    }
  }
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
