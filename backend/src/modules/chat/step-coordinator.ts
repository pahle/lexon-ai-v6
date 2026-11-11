import type { JobEnvelope } from '../../infrastructure/db/index.js';
import {
  isRunStepJob,
  AiRunRepository,
  AiOperationRepository,
  AiStepRepository,
  OutboxRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type {
  OperationProposal,
  StepClaim,
  StepCommit,
  TerminalStreamReference,
  TenantSession,
} from '../../infrastructure/db/index.js';
import type { ReportedUsage } from '../../infrastructure/db/index.js';
import type { JobExecutor } from '../platform/index.js';
import { AttemptService, UsageClaimLostError } from '../usage/index.js';
import { stepJobId } from './step-job-id.js';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/index.js';

/** Backoff for a step refused by the per-organization live-claim cap. */
const CAPACITY_RETRY_MS = 500;
const CANCELLATION_TRANSACTION_TIMEOUT_MS = 5000;
const EXHAUSTED_TRANSACTION_TIMEOUT_MS = 5000;

export interface StepCoordinatorCommit extends StepCommit {
  readonly advancement: 'generation' | 'continuation';
  readonly terminal?: boolean;
  readonly continuation?: 'advance' | 'resume';
  readonly outcome?: 'succeeded' | 'failed' | 'unknown';
  readonly errorCode?:
    | 'AI_BUDGET_EXCEEDED'
    | 'AI_ATTEMPT_LIMIT'
    | 'AI_ITERATION_LIMIT'
    | 'AI_ACCESS_REVOKED'
    | 'AI_MODEL_FORBIDDEN'
    | 'AI_PROVIDER_UNAVAILABLE'
    | 'AI_PROVIDER_AUTH'
    | 'AI_INVALID_TOOL'
    | 'AI_TOOL_TIMEOUT'
    | 'AI_TOOL_OUTCOME_UNKNOWN'
    | 'AI_CAPACITY_EXCEEDED'
    | 'AI_OUTPUT_LIMIT'
    | 'AI_INTERNAL';
  readonly attemptSettlement?: Readonly<{
    attemptId: string;
    outcome: 'succeeded' | 'failed' | 'unknown';
    usage?: Partial<ReportedUsage>;
    costUsd?: string;
  }>;
  readonly operationProposals?: readonly OperationProposal[];
  readonly transactionWork?: (
    tx: TenantSession,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly transactionTimeoutMs?: number;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly claim: StepClaim }
  | { readonly kind: 'busy'; readonly retryAtMs: number }
  | { readonly kind: 'cancelled'; readonly reference: TerminalStreamReference }
  | { readonly kind: 'noop' };

class StaleCommit extends Error {}
class RetryFinalization extends Error {}

export class StepCoordinator {
  private readonly audit = new AuditService();
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly usage: AttemptService,
    private readonly outbox: OutboxRepository,
    private readonly executor: JobExecutor,
    private readonly leaseMs = 30_000,
    private readonly operations?: AiOperationRepository,
  ) {}

  async claim(job: JobEnvelope): Promise<ClaimResult> {
    if (!isRunStepJob(job)) throw new Error('Invalid run job identity');
    if (job.outboxId !== stepJobId(job.payload.runId, job.payload.sequence))
      throw new Error('Invalid run job identity');
    const result = await this.database.withTenant<
      ClaimResult | { kind: 'recover-cancellation' }
    >(job.ctx, async (tx) => {
      const run = await this.runs.find(tx, job.payload.runId);
      if (run && run.initiatingUserId !== job.ctx.userId)
        return { kind: 'noop' };
      if (
        run?.status === 'cancelling' &&
        run.runVersion === job.payload.expectedVersion + 1 &&
        run.nextSequence === job.payload.sequence &&
        run.initiatingUserId === job.ctx.userId
      )
        return { kind: 'recover-cancellation' };
      if (
        !run ||
        ['completed', 'failed', 'cancelled'].includes(run.status) ||
        run.runVersion !== job.payload.expectedVersion ||
        run.nextSequence !== job.payload.sequence
      )
        return { kind: 'noop' };
      const recovered = await this.steps.claim(tx, {
        runId: run.id,
        sequence: job.payload.sequence,
        expectedVersion: job.payload.expectedVersion,
        leaseMs: this.leaseMs,
      });
      if (recovered) {
        for (const attemptId of recovered.unknownAttemptIds)
          await this.usage.markUnknown(tx, attemptId);
        return { kind: 'claimed', claim: recovered.claim };
      }
      const step = await this.steps.find(tx, {
        runId: run.id,
        sequence: job.payload.sequence,
      });
      if (step?.state === 'claimed') {
        if (step.leaseUntil && step.leaseUntil > new Date())
          return { kind: 'busy', retryAtMs: step.leaseUntil.getTime() };
        // A live claim can expire after the repository refuses takeover but
        // before this read. Keep its deterministic delivery retryable so the
        // next claim can advance the fence instead of acknowledging a no-op.
        return { kind: 'busy', retryAtMs: Date.now() + CAPACITY_RETRY_MS };
      }
      // The run still expects this pending step, so the claim was refused by
      // the per-organization live-claim cap. Defer it; acknowledging it as a
      // no-op would strand the run with no further delivery.
      if (step?.state === 'pending')
        return { kind: 'busy', retryAtMs: Date.now() + CAPACITY_RETRY_MS };
      return { kind: 'noop' };
    });
    return result.kind === 'recover-cancellation'
      ? this.#recoverCancellation(job)
      : result;
  }

  async renew(claim: StepClaim): Promise<boolean> {
    return this.database.withTenant(
      { orgId: claim.orgId, userId: claim.userId },
      (tx) => this.steps.renew(tx, claim, this.leaseMs),
    );
  }

  get leaseDurationMs(): number {
    return this.leaseMs;
  }

  async commit(
    job: JobEnvelope,
    claim: StepClaim,
    commit: StepCoordinatorCommit,
  ): Promise<'committed' | 'stale'> {
    if (
      !isRunStepJob(job) ||
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
        commit.outcome !== commit.attemptSettlement.outcome) ||
      (commit.transactionWork !== undefined &&
        (!Number.isSafeInteger(commit.transactionTimeoutMs) ||
          commit.transactionTimeoutMs! < 1))
    )
      return 'stale';
    try {
      const outcome = await this.database.withTenant<'committed' | 'stale'>(
        job.ctx,
        async (tx, signal) => {
          await this.steps.lockTenantClaimGuard(tx);
          let fencedStale = false;
          const result = await this.executor.executeWithin(
            tx,
            job,
            async (session) => {
              const resourceLive = await this.steps.lockResourceForRun(
                session,
                claim.runId,
              );
              if (!resourceLive) {
                if (commit.attemptSettlement) {
                  try {
                    await this.usage.settle(
                      session,
                      claim,
                      commit.attemptSettlement,
                    );
                  } catch (error) {
                    if (error instanceof UsageClaimLostError)
                      throw new StaleCommit();
                    throw error;
                  }
                }
                fencedStale = true;
                return;
              }
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
              if (commit.transactionWork)
                await commit.transactionWork(session, signal);
              const currentRun = await this.runs.find(session, claim.runId);
              if (!currentRun) throw new StaleCommit();
              const persistedOperations = [];
              for (const proposal of commit.operationProposals ?? []) {
                if (!this.operations)
                  throw new Error('AI operation persistence unavailable');
                const operation = await this.operations.persist(
                  session,
                  claim,
                  proposal,
                );
                persistedOperations.push(operation);
                await this.audit.append(session, {
                  version: 1,
                  eventId: randomUUID(),
                  type: 'chat.tool_operation.v1',
                  occurredAt: new Date().toISOString(),
                  outcome: 'success',
                  orgId: claim.orgId,
                  actorUserId: claim.userId,
                  metadata: {
                    runId: claim.runId,
                    stepId: claim.stepId,
                    operationId: operation.id,
                    model: currentRun.modelId,
                    provider: routingProvider(currentRun.resolvedConfig),
                    status:
                      operation.status === 'awaiting_approval'
                        ? 'proposed'
                        : 'pending',
                  },
                });
              }
              const data =
                commit.operationProposals || commit.outcome
                  ? {
                      value: commit.data,
                      ...(commit.outcome ? { outcome: commit.outcome } : {}),
                      ...(commit.operationProposals
                        ? {
                            operationIds: persistedOperations.map(
                              (operation) => operation.id,
                            ),
                          }
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
              const terminal =
                budgetExceeded ||
                commit.errorCode !== undefined ||
                commit.terminal ||
                commit.outcome === 'failed';
              const nextStatus =
                budgetExceeded || commit.errorCode
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
                  ...(budgetExceeded || commit.errorCode
                    ? {
                        errorCode: budgetExceeded
                          ? 'AI_BUDGET_EXCEEDED'
                          : commit.errorCode,
                      }
                    : {}),
                  nextSequence: claim.sequence + 1,
                  modelIterationDelta:
                    commit.advancement === 'generation' ? 1 : 0,
                  outputAppend: commit.text,
                  finalizeOutput: nextStatus === 'completed',
                }))
              )
                throw new StaleCommit();
              if (terminal) {
                const safeCode = budgetExceeded
                  ? 'AI_BUDGET_EXCEEDED'
                  : commit.errorCode;
                await this.audit.append(session, {
                  version: 1,
                  eventId: randomUUID(),
                  type: 'chat.run_finished.v1',
                  occurredAt: new Date().toISOString(),
                  outcome: nextStatus === 'completed' ? 'success' : 'failure',
                  orgId: claim.orgId,
                  actorUserId: claim.userId,
                  metadata: {
                    runId: claim.runId,
                    model: currentRun.modelId,
                    provider: routingProvider(currentRun.resolvedConfig),
                    status: nextStatus === 'completed' ? 'completed' : 'failed',
                    ...(safeCode ? { safeCode } : {}),
                  },
                });
              }
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
          return fencedStale ? 'stale' : 'committed';
        },
        commit.transactionTimeoutMs !== undefined
          ? { timeoutMs: commit.transactionTimeoutMs }
          : {},
      );
      return outcome;
    } catch (error) {
      if (error instanceof StaleCommit) {
        const cancelled = await this.finalizeCancellation(job, claim, {
          text: commit.text,
          ...(commit.attemptSettlement
            ? { settlement: commit.attemptSettlement }
            : {}),
        });
        if (cancelled === 'committed') return 'committed';
        if (cancelled === 'retry')
          throw new Error('AI cancellation finalization unavailable', {
            cause: error,
          });
        return 'stale';
      }
      throw error;
    }
  }

  async commitCancellation(
    job: JobEnvelope,
    claim: StepClaim,
    input: {
      readonly text: string;
      readonly attemptId?: string;
      readonly settlement?: NonNullable<
        StepCoordinatorCommit['attemptSettlement']
      >;
    },
  ): Promise<'committed' | 'stale' | 'retry'> {
    if (
      !isRunStepJob(job) ||
      job.outboxId !== stepJobId(job.payload.runId, job.payload.sequence) ||
      job.payload.runId !== claim.runId ||
      job.payload.sequence !== claim.sequence ||
      job.payload.expectedVersion !== claim.expectedVersion ||
      job.ctx.orgId !== claim.orgId ||
      job.ctx.userId !== claim.userId ||
      Buffer.byteLength(input.text, 'utf8') > 262144 ||
      (input.attemptId !== undefined && input.attemptId.length === 0) ||
      (input.attemptId !== undefined && input.settlement !== undefined)
    )
      return 'stale';
    return this.finalizeCancellation(job, claim, input);
  }

  async finalizeCancellation(
    job: JobEnvelope,
    claim: StepClaim,
    input: {
      readonly text: string;
      readonly attemptId?: string;
      readonly settlement?: NonNullable<
        StepCoordinatorCommit['attemptSettlement']
      >;
    },
    options: { readonly deferLiveOwner?: boolean } = {},
  ): Promise<'committed' | 'stale' | 'retry'> {
    if (
      !isRunStepJob(job) ||
      job.outboxId !== stepJobId(job.payload.runId, job.payload.sequence) ||
      job.payload.runId !== claim.runId ||
      job.payload.sequence !== claim.sequence ||
      job.payload.expectedVersion !== claim.expectedVersion ||
      job.ctx.orgId !== claim.orgId ||
      job.ctx.userId !== claim.userId ||
      Buffer.byteLength(input.text, 'utf8') > 262144 ||
      (input.attemptId !== undefined && input.attemptId.length === 0) ||
      (input.attemptId !== undefined && input.settlement !== undefined)
    )
      return 'stale';
    try {
      await this.database.withTenant(
        job.ctx,
        async (tx) => {
          const deletedFacts = await this.steps.deletedCancellationFacts(
            tx,
            claim,
          );
          if (deletedFacts) {
            const settledAttemptId =
              input.settlement?.attemptId ?? input.attemptId;
            const knownActive =
              settledAttemptId !== undefined &&
              deletedFacts.activeAttemptIds.includes(settledAttemptId);
            if (input.settlement && knownActive)
              await this.usage.settleDetached(tx, settledAttemptId!, {
                outcome: input.settlement.outcome,
                ...(input.settlement.usage?.inputTokens !== undefined
                  ? { inputTokens: input.settlement.usage.inputTokens }
                  : {}),
                ...(input.settlement.usage?.outputTokens !== undefined
                  ? { outputTokens: input.settlement.usage.outputTokens }
                  : {}),
                ...(input.settlement.usage?.cachedInputTokens !== undefined
                  ? {
                      cachedInputTokens:
                        input.settlement.usage.cachedInputTokens,
                    }
                  : {}),
                ...(input.settlement.usage?.reasoningOutputTokens !== undefined
                  ? {
                      reasoningOutputTokens:
                        input.settlement.usage.reasoningOutputTokens,
                    }
                  : {}),
                ...(input.settlement.costUsd !== undefined
                  ? { costUsd: input.settlement.costUsd }
                  : {}),
              });
            if (deletedFacts.purged) return;
            const finalized = await this.steps.finalizeDeletedCancellation(
              tx,
              claim,
            );
            if (!finalized.changed) throw new StaleCommit();
            for (const attemptId of finalized.activeAttemptIds)
              if (
                !input.settlement ||
                !knownActive ||
                attemptId !== settledAttemptId
              )
                await this.usage.markUnknown(tx, attemptId);
            return;
          }
          await this.steps.lockTenantClaimGuard(tx);
          const run = await this.runs.lockForLifecycle(tx, claim.runId);
          const step = await this.steps.lockCurrent(tx, {
            runId: claim.runId,
            sequence: claim.sequence,
          });
          if (
            !run ||
            !step ||
            run.initiatingUserId !== claim.userId ||
            run.status !== 'cancelling' ||
            run.runVersion !== claim.expectedVersion + 1 ||
            run.nextSequence !== claim.sequence ||
            step.id !== claim.stepId ||
            step.expectedVersion !== claim.expectedVersion ||
            step.fence !== claim.fence ||
            step.state !== 'claimed'
          )
            throw new StaleCommit();
          if (step.leaseUntil && step.leaseUntil > new Date()) {
            if (options.deferLiveOwner) throw new RetryFinalization();
            // A current owner may still complete its iterator and checkpoint cleanup.
            const result = await this.executor.executeWithin(
              tx,
              job,
              async (session) => {
                if (!(await this.steps.lockClaim(session, claim)))
                  throw new StaleCommit();
                let budgetExceeded = false;
                if (input.settlement)
                  budgetExceeded = (
                    await this.usage.settle(session, claim, input.settlement)
                  ).budgetExceeded;
                else if (input.attemptId)
                  await this.usage.settle(session, claim, {
                    attemptId: input.attemptId,
                    outcome: 'unknown',
                  });
                if (
                  !(await this.steps.commitCancellation(
                    session,
                    claim,
                    input.text,
                  ))
                )
                  throw new StaleCommit();
                if (
                  !(await this.runs.transition(session, {
                    runId: claim.runId,
                    expectedVersion: run.runVersion,
                    from: 'cancelling',
                    to: budgetExceeded ? 'failed' : 'cancelled',
                    ...(budgetExceeded
                      ? { errorCode: 'AI_BUDGET_EXCEEDED' as const }
                      : {}),
                    nextSequence: claim.sequence + 1,
                    outputAppend: input.text,
                  }))
                )
                  throw new StaleCommit();
                await appendRunFinishedAudit(
                  this.audit,
                  session,
                  run,
                  claim.orgId,
                  claim.userId,
                  budgetExceeded ? 'failed' : 'cancelled',
                  budgetExceeded ? 'AI_BUDGET_EXCEEDED' : undefined,
                );
              },
            );
            void result;
            return;
          }
          const result = await this.executor.executeWithin(
            tx,
            job,
            async (session) => {
              const current = await this.runs.find(session, claim.runId);
              if (
                !current ||
                current.status !== 'cancelling' ||
                current.runVersion !== claim.expectedVersion + 1 ||
                current.nextSequence !== claim.sequence
              )
                throw new StaleCommit();
              const recovered = await this.steps.commitExpiredCancellation(
                session,
                claim,
                input.text,
              );
              if (!recovered.changed) throw new StaleCommit();
              for (const attemptId of recovered.unknownAttemptIds) {
                if (input.settlement?.attemptId === attemptId) {
                  await this.usage.settleDetached(session, attemptId, {
                    outcome: input.settlement.outcome,
                    ...(input.settlement.usage?.inputTokens !== undefined
                      ? {
                          inputTokens: input.settlement.usage.inputTokens,
                        }
                      : {}),
                    ...(input.settlement.usage?.outputTokens !== undefined
                      ? {
                          outputTokens: input.settlement.usage.outputTokens,
                        }
                      : {}),
                    ...(input.settlement.usage?.cachedInputTokens !== undefined
                      ? {
                          cachedInputTokens:
                            input.settlement.usage.cachedInputTokens,
                        }
                      : {}),
                    ...(input.settlement.usage?.reasoningOutputTokens !==
                    undefined
                      ? {
                          reasoningOutputTokens:
                            input.settlement.usage.reasoningOutputTokens,
                        }
                      : {}),
                    ...(input.settlement.costUsd !== undefined
                      ? { costUsd: input.settlement.costUsd }
                      : {}),
                  });
                } else await this.usage.markUnknown(session, attemptId);
              }
              if (
                !(await this.runs.transition(session, {
                  runId: claim.runId,
                  expectedVersion: current.runVersion,
                  from: 'cancelling',
                  to: 'cancelled',
                  nextSequence: claim.sequence + 1,
                  outputAppend: input.text,
                }))
              )
                throw new StaleCommit();
              await appendRunFinishedAudit(
                this.audit,
                session,
                current,
                claim.orgId,
                claim.userId,
                'cancelled',
              );
            },
          );
          void result;
        },
        { timeoutMs: CANCELLATION_TRANSACTION_TIMEOUT_MS },
      );
      return 'committed';
    } catch (error) {
      if (error instanceof RetryFinalization) return 'retry';
      if (error instanceof StaleCommit) return 'stale';
      throw error;
    }
  }

  async isDeletedChatCancellation(
    job: JobEnvelope,
    claim: StepClaim,
  ): Promise<boolean> {
    if (
      !isRunStepJob(job) ||
      job.payload.runId !== claim.runId ||
      job.payload.sequence !== claim.sequence ||
      job.payload.expectedVersion !== claim.expectedVersion ||
      job.ctx.orgId !== claim.orgId ||
      job.ctx.userId !== claim.userId
    )
      return false;
    return this.database.withTenant(
      job.ctx,
      async (tx) =>
        (await this.steps.deletedCancellationFacts(tx, claim)) !== null,
      { timeoutMs: CANCELLATION_TRANSACTION_TIMEOUT_MS },
    );
  }

  async #recoverCancellation(job: JobEnvelope): Promise<ClaimResult> {
    if (!isRunStepJob(job)) return { kind: 'noop' };
    const step = await this.database.withTenant(
      job.ctx,
      (tx) =>
        this.steps.find(tx, {
          runId: job.payload.runId,
          sequence: job.payload.sequence,
        }),
      { timeoutMs: CANCELLATION_TRANSACTION_TIMEOUT_MS },
    );
    if (
      !step ||
      step.expectedVersion !== job.payload.expectedVersion ||
      step.state !== 'claimed'
    )
      return { kind: 'busy', retryAtMs: Date.now() + CAPACITY_RETRY_MS };
    const claim: StepClaim = {
      runId: step.runId,
      orgId: job.ctx.orgId,
      userId: job.ctx.userId,
      stepId: step.id,
      sequence: step.sequence,
      expectedVersion: step.expectedVersion,
      fence: step.fence,
      leaseUntil: step.leaseUntil ?? new Date(0),
    };
    if (claim.leaseUntil > new Date())
      return { kind: 'busy', retryAtMs: claim.leaseUntil.getTime() };
    const text = await this.database.withTenant(
      job.ctx,
      (tx) => this.runs.latestCheckpointText(tx, step.runId, step.sequence),
      { timeoutMs: CANCELLATION_TRANSACTION_TIMEOUT_MS },
    );
    const result = await this.finalizeCancellation(
      job,
      claim,
      { text },
      { deferLiveOwner: true },
    );
    if (result === 'retry')
      return { kind: 'busy', retryAtMs: Date.now() + CAPACITY_RETRY_MS };
    if (result !== 'committed')
      return { kind: 'busy', retryAtMs: Date.now() + CAPACITY_RETRY_MS };
    const reference = await this.database.withTenant(
      job.ctx,
      (tx) => this.runs.terminalStreamReference(tx, step.runId),
      { timeoutMs: CANCELLATION_TRANSACTION_TIMEOUT_MS },
    );
    return reference ? { kind: 'cancelled', reference } : { kind: 'noop' };
  }

  /** Terminalizes only the exact expired current delivery after BullMQ exhaustion. */
  async finalizeExhausted(job: JobEnvelope): Promise<'done' | 'retry'> {
    if (
      !isRunStepJob(job) ||
      job.outboxId !== stepJobId(job.payload.runId, job.payload.sequence)
    )
      return 'done';
    try {
      const observedRun = await this.database.withTenant(
        job.ctx,
        (tx) => this.runs.find(tx, job.payload.runId),
        { timeoutMs: EXHAUSTED_TRANSACTION_TIMEOUT_MS },
      );
      if (
        observedRun?.status === 'cancelling' &&
        observedRun.initiatingUserId === job.ctx.userId &&
        observedRun.runVersion === job.payload.expectedVersion + 1 &&
        observedRun.nextSequence === job.payload.sequence
      ) {
        const recovery = await this.#recoverCancellation(job);
        if (recovery.kind === 'busy') return 'retry';
        const terminalRun = await this.database.withTenant(
          job.ctx,
          (tx) => this.runs.find(tx, job.payload.runId),
          { timeoutMs: EXHAUSTED_TRANSACTION_TIMEOUT_MS },
        );
        return terminalRun &&
          ['cancelled', 'failed'].includes(terminalRun.status) &&
          terminalRun.runVersion >= job.payload.expectedVersion + 2
          ? 'done'
          : 'retry';
      }
      return await this.database.withTenant<'done' | 'retry'>(
        job.ctx,
        async (tx) => {
          await this.steps.lockTenantClaimGuard(tx);
          const run = await this.runs.lockForLifecycle(tx, job.payload.runId);
          if (!run || run.initiatingUserId !== job.ctx.userId) return 'done';
          if (run.status === 'cancelling') throw new RetryFinalization();
          if (
            run.runVersion !== job.payload.expectedVersion ||
            run.nextSequence !== job.payload.sequence ||
            !['queued', 'running', 'awaiting_approval'].includes(run.status)
          )
            return 'done';
          const step = await this.steps.lockCurrent(tx, {
            runId: run.id,
            sequence: job.payload.sequence,
          });
          if (
            !step ||
            step.expectedVersion !== job.payload.expectedVersion ||
            !['pending', 'claimed'].includes(step.state)
          )
            return 'done';
          if (
            step.state === 'claimed' &&
            step.leaseUntil &&
            step.leaseUntil > new Date()
          )
            throw new RetryFinalization();
          await this.executor.executeWithin(tx, job, async (session) => {
            const checkpoint = await this.runs.latestCheckpointText(
              session,
              run.id,
              step.sequence,
            );
            const recovered = await this.steps.failExpiredCurrent(session, {
              runId: run.id,
              sequence: step.sequence,
              expectedVersion: step.expectedVersion,
              stepId: step.id,
              fence: step.fence,
            });
            if (!recovered.changed) throw new RetryFinalization();
            for (const attemptId of recovered.unknownAttemptIds)
              await this.usage.markUnknown(session, attemptId);
            if (
              !(await this.runs.transition(session, {
                runId: run.id,
                expectedVersion: run.runVersion,
                from: run.status,
                to: 'failed',
                errorCode: 'AI_INTERNAL',
                nextSequence: step.sequence + 1,
                outputAppend: checkpoint,
              }))
            )
              throw new StaleCommit();
            await appendRunFinishedAudit(
              this.audit,
              session,
              run,
              run.orgId,
              run.initiatingUserId,
              'failed',
              'AI_INTERNAL',
            );
          });
          return 'done';
        },
        { timeoutMs: EXHAUSTED_TRANSACTION_TIMEOUT_MS },
      );
    } catch {
      return 'retry';
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

function routingProvider(value: unknown): string {
  if (!value || typeof value !== 'object')
    throw new Error('AI route audit metadata unavailable');
  const provider = (value as Record<string, unknown>).provider;
  if (typeof provider !== 'string' || !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider))
    throw new Error('AI route audit metadata unavailable');
  return provider;
}

async function appendRunFinishedAudit(
  audit: AuditService,
  tx: TenantSession,
  run: {
    readonly id: string;
    readonly modelId: string;
    readonly resolvedConfig: unknown;
  },
  orgId: string,
  actorUserId: string,
  status: 'completed' | 'failed' | 'cancelled',
  safeCode?: 'AI_BUDGET_EXCEEDED' | 'AI_INTERNAL',
): Promise<void> {
  await audit.append(tx, {
    version: 1,
    eventId: randomUUID(),
    type: 'chat.run_finished.v1',
    occurredAt: new Date().toISOString(),
    outcome: status === 'completed' ? 'success' : 'failure',
    orgId,
    actorUserId,
    metadata: {
      runId: run.id,
      model: run.modelId,
      provider: routingProvider(run.resolvedConfig),
      status,
      ...(safeCode ? { safeCode } : {}),
    },
  });
}
