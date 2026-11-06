import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PlatformVersionService } from '../modules/platform/index.js';
import { EvaluationModule } from './evaluation.module.js';
import type {
  EvaluationContext,
  EvaluationEngine,
  EvaluationInfrastructureAcquire,
  EvaluationInfrastructureLease,
  EvaluationOptions,
  EvaluationHarnessOptions,
  RealEvaluationOptions,
  EvaluationScoreReport,
} from './evaluation-contracts.js';
export type {
  EvaluationActor,
  EvaluationContext,
  EvaluationInfrastructureAcquire,
  EvaluationInfrastructureLease,
  EvaluationOptions,
  EvaluationHarnessOptions,
  EvaluationRealRequestPolicy,
  RealEvaluationOptions,
  EvaluationRun,
  EvaluationScoreReport,
  EvaluationStartInput,
  EvaluationServices,
} from './evaluation-contracts.js';
export async function prepareEvaluationInfrastructure(
  options: { acquire?: EvaluationInfrastructureAcquire } = {},
): Promise<EvaluationInfrastructureLease> {
  const { acquireTestInfrastructure } =
    await import('../infrastructure/db/testing/test-infrastructure.js');
  return acquireTestInfrastructure(options.acquire);
}

export async function isRealEvaluationPrerequisiteReady(
  env: Record<string, string | undefined>,
): Promise<boolean> {
  if (
    env.LEXON_REAL_EVAL_ALLOCATION_ATTESTED !==
    '0.10-usd-dedicated-no-other-consumers'
  )
    return false;
  try {
    const { validateRealModelPrerequisites } =
      await import('../infrastructure/ai/index.js');
    validateRealModelPrerequisites(env);
    return true;
  } catch {
    return false;
  }
}
export function createEvaluationContext(): Promise<{
  version: string;
  close(): Promise<void>;
}>;
export function createEvaluationContext(
  options: EvaluationOptions,
): Promise<EvaluationContext>;
export function createEvaluationContext(
  options: RealEvaluationOptions,
): Promise<EvaluationContext>;
export async function createEvaluationContext(
  options?: EvaluationHarnessOptions,
): Promise<{ version: string; close(): Promise<void> } | EvaluationContext> {
  const context = await NestFactory.createApplicationContext(EvaluationModule, {
    logger: false,
    abortOnError: false,
  });
  const version = context.get(PlatformVersionService).version;
  if (!options) return { version, close: () => context.close() };
  let engine: EvaluationEngine;
  try {
    const { createEvaluationHarness } = await import('./evaluation-harness.js');
    engine = await createEvaluationHarness(options);
  } catch {
    await context.close().catch(() => undefined);
    const error = new Error('Deterministic evaluation setup failed');
    delete error.stack;
    throw error;
  }
  return {
    version,
    actors: engine.actors,
    start: engine.start.bind(engine),
    cancel: engine.cancel.bind(engine),
    decide: engine.decide.bind(engine),
    read: async (actor, runId) =>
      safeScoreReport(await engine.read(actor, runId)),
    drain: engine.drain.bind(engine),
    close: async () => {
      await engine.close();
      await context.close();
    },
  };
}

const scenarioIds = new Set([
  'complete',
  'cancel',
  'budget',
  'approval',
  'crash',
  'hostile-context',
  'hostile-tool-result',
  'unauthorized-write',
  'claim-recovery',
  'replay',
  'unknown-attempt',
]);
const scoreCountKeys = new Set([
  'attempts',
  'operations',
  'events',
  'effects',
  'unknownAttempts',
  'modelRequests',
  'replays',
  'contextFixtures',
  'unknownReservationInvariant',
  'claimRecoveries',
  'succeededAttempts',
  'recoveryStepAttempts',
  'postOperationCompletionAttempts',
]);
const safeCodes = new Set([
  'AI_RUN_NOT_FOUND',
  'AI_CANCELLED',
  'AI_BUDGET_EXCEEDED',
  'AI_APPROVAL_REQUIRED',
  'AI_OPERATION_FORBIDDEN',
  'AI_ATTEMPT_UNKNOWN',
  'AI_PROVIDER_FAILED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_INTERNAL',
  'AI_INVALID_TOOL',
]);

function safeScoreReport(
  report: Awaited<ReturnType<EvaluationEngine['read']>>,
) {
  const status: EvaluationScoreReport['status'] =
    report.status === 'completed' ||
    report.status === 'failed' ||
    report.status === 'cancelled' ||
    report.status === 'awaiting_approval'
      ? report.status
      : 'unknown';
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(report.counts))
    if (scoreCountKeys.has(key) && Number.isSafeInteger(value) && value >= 0)
      counts[key] = value;
  return {
    scenarioId: scenarioIds.has(report.scenarioId)
      ? report.scenarioId
      : 'unknown',
    score:
      Number.isFinite(report.score) && report.score >= 0 && report.score <= 1
        ? report.score
        : 0,
    status,
    safeCode:
      report.safeCode && safeCodes.has(report.safeCode)
        ? report.safeCode
        : null,
    counts,
  };
}
