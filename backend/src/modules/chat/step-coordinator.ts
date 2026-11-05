import type { JobEnvelope } from '../../infrastructure/db/index.js';
import {
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { StepClaim, StepCommit } from '../../infrastructure/db/index.js';
import type { ReportedUsage } from '../../infrastructure/db/index.js';
import type { JobExecutor } from '../platform/index.js';
import { AttemptService, UsageClaimLostError } from '../usage/index.js';
import { stepJobId } from './step-job-id.js';
import { randomUUID } from 'node:crypto';

export interface StepCoordinatorCommit extends StepCommit {
  readonly advancement: 'generation' | 'continuation';
  readonly terminal?: boolean;
  readonly continuation?: 'advance' | 'resume';
  readonly outcome?: 'succeeded' | 'failed' | 'unknown';
  readonly attemptSettlement?: Readonly<{
    attemptId: string;
    outcome: 'succeeded' | 'failed' | 'unknown';
    usage?: Partial<ReportedUsage>;
    costUsd?: string;
  }>;
  readonly operationProposals?: readonly unknown[];
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly claim: StepClaim }
  | { readonly kind: 'busy'; readonly retryAtMs: number }
  | { readonly kind: 'noop' };

class StaleCommit extends Error {}

export class StepCoordinator {
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly usage: AttemptService,
    private readonly outbox: OutboxRepository,
    private readonly executor: JobExecutor,
    private readonly leaseMs = 30_000,
  ) {}

  async claim(job: JobEnvelope): Promise<ClaimResult> {
    if (job.type === 'platform.noop.v1')
      throw new Error('Invalid run job identity');
    if (job.outboxId !== stepJobId(job.payload.runId, job.payload.sequence))
      throw new Error('Invalid run job identity');
    return this.database.withTenant(job.ctx, async (tx) => {
      const run = await this.runs.find(tx, job.payload.runId);
      if (
        !run ||
        ['completed', 'failed', 'cancelled'].includes(run.status) ||
        run.runVersion !== job.payload.expectedVersion ||
        run.nextSequence !== job.payload.sequence
      )
        return { kind: 'noop' };
      const claim = await this.steps.claim(tx, {
        runId: run.id,
        sequence: job.payload.sequence,
        expectedVersion: job.payload.expectedVersion,
        leaseMs: this.leaseMs,
      });
      if (claim) return { kind: 'claimed', claim };
      const step = await this.steps.find(tx, {
        runId: run.id,
        sequence: job.payload.sequence,
      });
      if (
        step?.state === 'claimed' &&
        step.leaseUntil &&
        step.leaseUntil > new Date()
      )
        return { kind: 'busy', retryAtMs: step.leaseUntil.getTime() };
      return { kind: 'noop' };
    });
  }

  async renew(claim: StepClaim): Promise<boolean> {
    return this.database.withTenant(
      { orgId: claim.orgId, userId: claim.userId },
      (tx) => this.steps.renew(tx, claim, this.leaseMs),
    );
  }

  async commit(
    job: JobEnvelope,
    claim: StepClaim,
    commit: StepCoordinatorCommit,
  ): Promise<'committed' | 'stale'> {
    if (
      job.type === 'platform.noop.v1' ||
      job.outboxId !== stepJobId(job.payload.runId, job.payload.sequence) ||
      job.payload.runId !== claim.runId ||
      job.payload.sequence !== claim.sequence ||
      job.payload.expectedVersion !== claim.expectedVersion ||
      job.ctx.orgId !== claim.orgId ||
      job.ctx.userId !== claim.userId ||
      (commit.terminal && commit.state === 'awaiting_approval') ||
      !['generation', 'continuation'].includes(commit.advancement) ||
      commit.outcome === 'unknown' ||
      commit.attemptSettlement?.outcome === 'unknown' ||
      (commit.outcome !== undefined &&
        commit.attemptSettlement !== undefined &&
        commit.outcome !== commit.attemptSettlement.outcome)
    )
      return 'stale';
    try {
      const outcome = await this.database.withTenant<'committed' | 'stale'>(
        job.ctx,
        async (tx) => {
          await this.steps.lockTenantClaimGuard(tx);
          const result = await this.executor.executeWithin(
            tx,
            job,
            async (session) => {
              if (!(await this.steps.lockClaim(session, claim)))
                throw new StaleCommit();
              let budgetExceeded = false;
              if (commit.attemptSettlement) {
                let settlement: Awaited<ReturnType<AttemptService['settle']>>;
                try {
                  settlement = await this.usage.settle(
                    session,
                    claim,
                    commit.attemptSettlement,
                  );
                } catch (error) {
                  if (error instanceof UsageClaimLostError)
                    throw new StaleCommit();
                  throw error;
                }
                budgetExceeded = settlement.budgetExceeded;
              }
              if (
                !(await this.steps.lockClaim(session, claim)) ||
                !(await this.runs.markRunningForClaim(session, {
                  runId: claim.runId,
                  stepId: claim.stepId,
                  expectedVersion: claim.expectedVersion,
                  sequence: claim.sequence,
                  fence: claim.fence,
                }))
              )
                throw new StaleCommit();
              const data =
                commit.operationProposals || commit.outcome
                  ? {
                      value: commit.data,
                      ...(commit.outcome ? { outcome: commit.outcome } : {}),
                      ...(commit.operationProposals
                        ? { operationProposals: commit.operationProposals }
                        : {}),
                    }
                  : commit.data;
              if (
                !(await this.steps.commit(session, claim, {
                  state: commit.state,
                  text: commit.text,
                  data,
                }))
              )
                throw new StaleCommit();
              const currentRun = await this.runs.find(tx, claim.runId);
              if (!currentRun) throw new StaleCommit();
              const terminal =
                budgetExceeded ||
                commit.terminal ||
                commit.outcome === 'failed';
              const nextStatus = budgetExceeded
                ? 'failed'
                : terminal
                  ? commit.outcome === 'failed'
                    ? 'failed'
                    : 'completed'
                  : commit.state === 'awaiting_approval'
                    ? 'awaiting_approval'
                    : 'running';
              if (
                !(await this.runs.transition(tx, {
                  runId: claim.runId,
                  expectedVersion: claim.expectedVersion,
                  from: currentRun.status,
                  to: nextStatus,
                  ...(budgetExceeded
                    ? { errorCode: 'AI_BUDGET_EXCEEDED' }
                    : {}),
                  nextSequence: claim.sequence + 1,
                  modelIterationDelta:
                    commit.advancement === 'generation' ? 1 : 0,
                  outputAppend: commit.text,
                  finalizeOutput: nextStatus === 'completed',
                }))
              )
                throw new StaleCommit();
              if (!terminal && commit.state !== 'awaiting_approval') {
                const nextSequence = claim.sequence + 1;
                const nextJobId = stepJobId(claim.runId, nextSequence);
                await this.steps.insertInitial(session, {
                  id: randomUUID(),
                  runId: claim.runId,
                  sequence: nextSequence,
                  expectedVersion: claim.expectedVersion + 1,
                });
                await this.outbox.append(
                  session,
                  {
                    type:
                      commit.continuation === 'resume'
                        ? 'run.resume.v1'
                        : 'run.advance.v1',
                    ctx: job.ctx,
                    payload: {
                      runId: claim.runId,
                      sequence: nextSequence,
                      expectedVersion: claim.expectedVersion + 1,
                    },
                  },
                  {
                    id: nextJobId,
                    ...(isRouting(currentRun.resolvedConfig)
                      ? {
                          queue: currentRun.resolvedConfig.queue,
                          priority: currentRun.resolvedConfig.priority,
                        }
                      : {}),
                  },
                );
              }
            },
          );
          void result;
          return 'committed';
        },
      );
      return outcome;
    } catch (error) {
      if (error instanceof StaleCommit) return 'stale';
      throw error;
    }
  }
}

function isRouting(
  value: unknown,
): value is { queue: 'ai-interactive' | 'ai-batch'; priority: number } {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return (
    (config.queue === 'ai-interactive' || config.queue === 'ai-batch') &&
    Number.isSafeInteger(config.priority) &&
    Number(config.priority) >= 1 &&
    Number(config.priority) <= 10
  );
}
