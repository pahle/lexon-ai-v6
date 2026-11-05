import { Injectable } from '@nestjs/common';
import type {
  ModelInput,
  ReportedUsage,
} from '../../infrastructure/ai/index.js';
import {
  AiAttemptRepository,
  AiRunRepository,
  AiStepRepository,
  type AttemptRecord,
  type StepClaim,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import {
  isOverReservation,
  remainingBudgetTokens,
  reservationTokens,
} from './attempt-budget.js';
import { estimateInputTokens } from './token-estimator.js';

export interface AttemptLimits {
  readonly maxAttemptsPerStep: number;
  readonly tokenBudget: number;
  readonly maxOutputTokens: number;
}

export interface AttemptReserveInput {
  readonly attemptId: string;
  readonly modelInput: ModelInput;
  readonly limits: AttemptLimits;
}

export type AttemptOutcome = 'succeeded' | 'failed' | 'unknown';

export class UsagePolicyError extends Error {
  constructor(
    readonly code: 'AI_BUDGET_EXCEEDED' | 'AI_ATTEMPT_LIMIT' | 'AI_INTERNAL',
    message: string,
  ) {
    super(message);
    this.name = 'UsagePolicyError';
  }
}

@Injectable()
export class AttemptService {
  private readonly repositories = {
    runs: new AiRunRepository(),
    steps: new AiStepRepository(),
    attempts: new AiAttemptRepository(),
  };

  async reserve(
    tx: TenantSession,
    claim: StepClaim,
    input: AttemptReserveInput,
  ): Promise<AttemptRecord> {
    const { limits, modelInput } = input;
    if (
      !Number.isSafeInteger(limits.maxAttemptsPerStep) ||
      limits.maxAttemptsPerStep < 1 ||
      !Number.isSafeInteger(limits.tokenBudget) ||
      limits.tokenBudget < 1 ||
      !Number.isSafeInteger(limits.maxOutputTokens) ||
      limits.maxOutputTokens < 1 ||
      modelInput.maxOutputTokens !== limits.maxOutputTokens
    )
      throw new UsagePolicyError('AI_INTERNAL', 'Invalid trusted usage limits');

    if (!(await this.repositories.steps.lockClaim(tx, claim)))
      throw new UsagePolicyError('AI_INTERNAL', 'AI step claim lost');
    const run = await this.repositories.runs.find(tx, claim.runId);
    if (!run || run.orgId !== claim.orgId)
      throw new UsagePolicyError('AI_INTERNAL', 'AI run unavailable');
    const tokenBudget = run.inputBudgetTokens + run.outputBudgetTokens;
    if (
      !Number.isSafeInteger(tokenBudget) ||
      tokenBudget !== limits.tokenBudget
    )
      throw new UsagePolicyError('AI_INTERNAL', 'AI token budget mismatch');

    const existing = await this.repositories.attempts.list(tx, claim.runId);
    const stepAttempts = existing.filter(
      (attempt) => attempt.stepId === claim.stepId,
    );
    if (stepAttempts.length >= limits.maxAttemptsPerStep)
      throw new UsagePolicyError(
        'AI_ATTEMPT_LIMIT',
        'AI attempt limit reached',
      );
    if (existing.some(isOverReservation))
      throw new UsagePolicyError('AI_BUDGET_EXCEEDED', 'AI budget exceeded');

    const estimate = estimateInputTokens(modelInput);
    const reserveInputTokens = estimate.inputTokens;
    const reserveOutputTokens = limits.maxOutputTokens;
    const reserveTotal = reservationTokens(
      reserveInputTokens,
      reserveOutputTokens,
    );
    const remaining = remainingBudgetTokens(tokenBudget, existing);
    if (remaining < reserveTotal)
      throw new UsagePolicyError('AI_BUDGET_EXCEEDED', 'AI budget exceeded');

    const record: AttemptRecord = {
      attemptId: input.attemptId,
      orgId: claim.orgId,
      runId: claim.runId,
      stepId: claim.stepId,
      ordinal: stepAttempts.length + 1,
      modelId: modelInput.model,
      estimatorVersion: String(estimate.version),
      estimatedInputTokens: estimate.inputTokens,
      reservedInputTokens: reserveInputTokens,
      reservedOutputTokens: reserveOutputTokens,
      generationId: null,
      provider: null,
      reportedInputTokens: null,
      reportedOutputTokens: null,
      cachedInputTokens: null,
      reasoningOutputTokens: null,
      costUsd: null,
      active: true,
      outcome: null,
      createdAt: new Date(),
      settledAt: null,
    };
    await this.repositories.attempts.insert(tx, claim, record);
    return record;
  }

  async metadata(
    tx: TenantSession,
    claim: StepClaim,
    input: { attemptId: string; generationId: string; provider?: string },
  ): Promise<void> {
    const updated = await this.repositories.attempts.updateMetadata(
      tx,
      claim,
      input,
    );
    if (!updated)
      throw new UsagePolicyError('AI_INTERNAL', 'AI metadata rejected');
  }

  async settle(
    tx: TenantSession,
    claim: StepClaim,
    input: {
      attemptId: string;
      outcome: AttemptOutcome;
      usage?: Partial<ReportedUsage>;
      costUsd?: string;
    },
  ): Promise<{ budgetExceeded: boolean }> {
    if (!(await this.repositories.steps.lockClaim(tx, claim)))
      throw new UsagePolicyError('AI_INTERNAL', 'AI step claim lost');
    const run = await this.repositories.runs.find(tx, claim.runId);
    if (!run) throw new UsagePolicyError('AI_INTERNAL', 'AI run unavailable');
    const tokenBudget = run.inputBudgetTokens + run.outputBudgetTokens;
    const attempts = await this.repositories.attempts.list(tx, claim.runId);
    const prior = attempts.find((entry) => entry.attemptId === input.attemptId);
    if (
      !prior ||
      prior.stepId !== claim.stepId ||
      !prior.active ||
      prior.outcome !== null
    )
      throw new UsagePolicyError('AI_INTERNAL', 'AI settlement unavailable');
    const settled: AttemptRecord = {
      ...prior,
      active: false,
      outcome: input.outcome,
      settledAt: new Date(),
      reportedInputTokens: input.usage?.inputTokens ?? null,
      reportedOutputTokens: input.usage?.outputTokens ?? null,
      cachedInputTokens: input.usage?.cachedInputTokens ?? null,
      reasoningOutputTokens: input.usage?.reasoningOutputTokens ?? null,
      costUsd: input.costUsd ?? null,
    };
    const projected = attempts.map((attempt) =>
      attempt.attemptId === input.attemptId ? settled : attempt,
    );
    const budgetExceeded =
      projected.some(isOverReservation) ||
      remainingBudgetTokens(tokenBudget, projected) < 0;
    const updated = await this.repositories.attempts.settle(tx, claim, input);
    if (!updated)
      throw new UsagePolicyError('AI_INTERNAL', 'AI settlement rejected');
    return { budgetExceeded };
  }

  async remaining(tx: TenantSession, runId: string): Promise<number> {
    const run = await this.repositories.runs.find(tx, runId);
    if (!run) throw new UsagePolicyError('AI_INTERNAL', 'AI run unavailable');
    const tokenBudget = run.inputBudgetTokens + run.outputBudgetTokens;
    const attempts = await this.repositories.attempts.list(tx, runId);
    return remainingBudgetTokens(tokenBudget, attempts);
  }
}
