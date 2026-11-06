import { randomUUID } from 'node:crypto';
import type { RunStreamEvent } from '@lexon/contracts';
import type {
  AiRunRepository,
  AiStepRepository,
  RunActorFactsRepository,
  StepClaim,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type {
  ModelEvent,
  ModelGateway,
  ModelInput,
  ModelOutcome,
  ReportedUsage,
} from '../../infrastructure/ai/index.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import type { JobEnvelope } from '../../infrastructure/db/index.js';
import { AttemptService, UsagePolicyError } from '../usage/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';
import type { RunRegistry } from './run-registry.js';
import type { ContextPiece, RunProfile } from './run-contracts.js';
import { StepCoordinator } from './step-coordinator.js';

const CHECKPOINT_INTERVAL_MS = 1000;
const CHECKPOINT_BYTES = 8192;

export interface StepExecutorOptions {
  readonly database: TenantDatabase;
  readonly runs: AiRunRepository;
  readonly steps: AiStepRepository;
  readonly facts: RunActorFactsRepository;
  readonly authorization: RunAuthorizationService;
  readonly coordinator: StepCoordinator;
  readonly attempts: AttemptService;
  readonly registry: RunRegistry;
  readonly gateway: ModelGateway;
  readonly streams?: RunStreams;
}

export class StepExecutor {
  constructor(private readonly options: StepExecutorOptions) {}

  async execute(
    job: JobEnvelope,
    durable: { signal: AbortSignal },
  ): Promise<{ kind: 'done' } | { kind: 'busy'; retryAtMs: number }> {
    if (job.type === 'platform.noop.v1') return { kind: 'done' };
    const claimed = await this.options.coordinator.claim(job);
    if (claimed.kind === 'noop') return { kind: 'done' };
    if (claimed.kind === 'busy')
      return { kind: 'busy', retryAtMs: claimed.retryAtMs };
    const claim = claimed.claim;
    await this.options.streams?.recover(claim, {
      version: 1,
      runId: claim.runId,
      type: 'reset',
      sequence: claim.sequence,
    });
    let text = '';
    let proposals: Extract<ModelEvent, { type: 'tool-proposal' }>[] = [];
    let finalOutcome: ModelOutcome | undefined;
    let settledUsage: Partial<ReportedUsage> | undefined;
    let costUsd: string | undefined;
    let lastCheckpoint = Date.now();
    let checkpointBytes = 0;
    let attemptId = '';

    try {
      const initial = await this.#loadAndAuthorize(claim);
      if (!initial) return { kind: 'done' };
      const { run, profile, actorScope } = initial;
      const maxAttempts = profile.maxAttemptsPerStep ?? 2;
      const contexts = await actorScope.run(async (actor) => {
        const pieces: ContextPiece[] = [];
        for (const [id, budget] of Object.entries(profile.contextBudgets)) {
          const provider = this.options.registry.context(id);
          if (!provider) throw new Error('AI context provider unavailable');
          const found = await provider.collect({
            actor,
            runId: run.id,
            input: Object.freeze({ prompt: run.inputText }),
            budget,
          });
          validateContextPieces(found, budget);
          pieces.push(...found);
        }
        return pieces;
      });
      for (let ordinal = 1; ordinal <= maxAttempts; ordinal++) {
        if (durable.signal.aborted) throw durable.signal.reason;
        let attemptText = '';
        const attemptProposals: Extract<
          ModelEvent,
          { type: 'tool-proposal' }
        >[] = [];
        checkpointBytes = 0;
        const modelInput: ModelInput = {
          model: run.modelId,
          provider: initial.provider,
          messages: [
            ...(contexts.length
              ? [{ role: 'system' as const, content: renderContexts(contexts) }]
              : []),
            { role: 'user', content: run.inputText },
            ...(run.partialOutput
              ? [{ role: 'assistant' as const, content: run.partialOutput }]
              : []),
          ],
          maxOutputTokens: profile.maxOutputTokens,
          signal: durable.signal,
        };
        attemptId = randomUUID();
        try {
          await this.options.database.withTenant(
            { orgId: claim.orgId, userId: claim.userId },
            async (tx) => {
              if (
                !(await this.options.steps.lockClaim(tx, claim)) ||
                !(await this.options.runs.markRunningForClaim(tx, {
                  runId: claim.runId,
                  stepId: claim.stepId,
                  expectedVersion: claim.expectedVersion,
                  sequence: claim.sequence,
                  fence: claim.fence,
                }))
              )
                throw new Error('AI step claim lost');
              const facts = await this.options.facts.read(tx, {
                orgId: claim.orgId,
                userId: claim.userId,
                runId: run.id,
              });
              if (!facts) throw new Error('AI run authorization denied');
              const decision = await this.options.authorization.authorize(
                tx,
                facts,
                {
                  profileId: run.profileId,
                  capabilities: profile.capabilities,
                },
                'resume',
              );
              if (!decision.allowed)
                throw new Error('AI run authorization denied');
              return this.options.attempts.reserve(tx, claim, {
                attemptId,
                modelInput,
                limits: {
                  maxAttemptsPerStep: maxAttempts,
                  tokenBudget: run.inputBudgetTokens + run.outputBudgetTokens,
                  maxOutputTokens: profile.maxOutputTokens,
                },
              });
            },
          );
        } catch (error) {
          if (
            error instanceof UsagePolicyError &&
            (error.code === 'AI_BUDGET_EXCEEDED' ||
              error.code === 'AI_ATTEMPT_LIMIT')
          ) {
            await this.options.coordinator.commit(job, claim, {
              state: 'committed',
              text,
              data: { error: error.code },
              advancement: 'continuation',
              terminal: true,
              outcome: 'failed',
              errorCode: error.code,
            });
            return { kind: 'done' };
          }
          throw error;
        }
        let usage: Partial<ReportedUsage> | undefined;
        let attemptCost: string | undefined;
        let outcome: ModelOutcome | undefined;
        const heartbeat = claimHeartbeat(
          this.options.coordinator,
          claim,
          durable.signal,
        );
        let checkpointTask: Promise<void> | undefined;
        let checkpointError: unknown;
        const flushCheckpoint = async () => {
          if (checkpointTask) await checkpointTask;
          if (checkpointBytes === 0) return;
          const checkpointText = attemptText;
          checkpointTask = this.options.database
            .withTenant({ orgId: claim.orgId, userId: claim.userId }, (tx) =>
              this.options.steps.checkpoint(tx, claim, {
                attemptId,
                text: checkpointText,
              }),
            )
            .then((accepted) => {
              if (!accepted) throw new Error('AI step claim lost');
              lastCheckpoint = Date.now();
              checkpointBytes = 0;
            })
            .catch((error: unknown) => {
              checkpointError = error;
              heartbeat.abort(error);
              throw error;
            });
          try {
            await checkpointTask;
          } finally {
            checkpointTask = undefined;
          }
        };
        const checkpointTimer = setInterval(() => {
          if (
            checkpointBytes > 0 &&
            Date.now() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS
          )
            void flushCheckpoint().catch(() => undefined);
        }, CHECKPOINT_INTERVAL_MS);
        try {
          await actorScope.run(async (actor) => {
            const iterator = this.options.gateway
              .generate({
                ...modelInput,
                signal: heartbeat.signal,
              })
              [Symbol.asyncIterator]();
            while (true) {
              let next: IteratorResult<ModelEvent>;
              try {
                next = await iterator.next();
              } catch {
                if (checkpointError !== undefined) throw checkpointError;
                if (heartbeat.signal.aborted) throw heartbeat.signal.reason;
                outcome = {
                  finishReason: 'error',
                  attemptOutcome: 'unknown',
                  retryable: false,
                  safeCode: 'AI_PROVIDER_UNAVAILABLE',
                };
                break;
              }
              if (next.done) break;
              const event = next.value;
              if (heartbeat.signal.aborted) throw heartbeat.signal.reason;
              if (event.type === 'metadata' && event.generationId) {
                await this.options.database.withTenant(
                  { orgId: claim.orgId, userId: claim.userId },
                  (tx) =>
                    this.options.attempts.metadata(tx, claim, {
                      attemptId,
                      generationId: event.generationId!,
                      ...(event.provider ? { provider: event.provider } : {}),
                    }),
                );
              } else if (event.type === 'text') {
                attemptText += event.text;
                checkpointBytes += Buffer.byteLength(event.text, 'utf8');
                if (
                  checkpointBytes >= CHECKPOINT_BYTES ||
                  Date.now() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS
                ) {
                  await flushCheckpoint();
                }
                await this.#publish(claim, {
                  version: 1,
                  runId: claim.runId,
                  type: 'text-delta',
                  id: claim.stepId,
                  delta: event.text,
                });
              } else if (event.type === 'tool-proposal') {
                attemptProposals.push(event);
              } else if (event.type === 'usage') {
                usage = event.usage;
                attemptCost = event.costUsd;
              } else if (event.type === 'outcome') {
                outcome = event.outcome;
              }
            }
            void actor;
          });
        } finally {
          clearInterval(checkpointTimer);
          if (checkpointTask) await checkpointTask;
          await heartbeat.stop();
        }
        finalOutcome = outcome;
        text = attemptText;
        proposals = attemptProposals;
        settledUsage = outcome?.usage ?? usage;
        costUsd = outcome?.costUsd ?? attemptCost;
        if (!outcome) {
          finalOutcome = {
            finishReason: 'error',
            attemptOutcome: 'unknown',
            retryable: false,
            safeCode: 'AI_INTERNAL',
          };
        }
        if (
          finalOutcome?.attemptOutcome === 'failed' &&
          finalOutcome.retryable &&
          ordinal < maxAttempts
        ) {
          await this.options.database.withTenant(
            { orgId: claim.orgId, userId: claim.userId },
            (tx) =>
              this.options.attempts.settle(tx, claim, {
                attemptId,
                outcome: 'failed',
                ...(settledUsage ? { usage: settledUsage } : {}),
                ...(costUsd ? { costUsd } : {}),
              }),
          );
          await this.#publish(claim, {
            version: 1,
            runId: claim.runId,
            type: 'reset-step',
          });
          await delay(250, durable.signal);
          continue;
        }
        break;
      }
      if (!finalOutcome) throw new Error('AI model outcome unavailable');
      const succeeded = finalOutcome.attemptOutcome === 'succeeded';
      const iterationLimit =
        run.modelIterations + 1 >= initial.profile.maxIterations;
      const continueLength =
        succeeded &&
        finalOutcome.finishReason === 'length' &&
        !proposals.length &&
        !iterationLimit;
      if (text && checkpointBytes > 0) {
        const accepted = await this.options.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => this.options.steps.checkpoint(tx, claim, { attemptId, text }),
        );
        if (!accepted) throw new Error('AI step claim lost');
      }
      const unknown = finalOutcome.attemptOutcome === 'unknown';
      if (unknown)
        await this.options.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) =>
            this.options.attempts.settle(tx, claim, {
              attemptId,
              outcome: 'unknown',
            }),
        );
      const terminal = !continueLength;
      const committed = await this.options.coordinator.commit(job, claim, {
        state: 'committed',
        text,
        data: { outcome: finalOutcome.finishReason },
        advancement: 'generation',
        terminal,
        outcome: succeeded ? 'succeeded' : 'failed',
        ...(iterationLimit && finalOutcome.finishReason === 'length'
          ? { errorCode: 'AI_ITERATION_LIMIT' as const }
          : unknown
            ? { errorCode: finalOutcome.safeCode ?? 'AI_PROVIDER_UNAVAILABLE' }
            : {}),
        ...(proposals.length ? { operationProposals: proposals } : {}),
        ...(!unknown
          ? {
              attemptSettlement: {
                attemptId,
                outcome: succeeded ? 'succeeded' : 'failed',
                ...(settledUsage ? { usage: settledUsage } : {}),
                ...(costUsd ? { costUsd } : {}),
              },
            }
          : {}),
      });
      if (committed === 'committed' && terminal) {
        const durableRun = await this.options.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => this.options.runs.find(tx, claim.runId),
        );
        if (
          durableRun?.status === 'completed' ||
          durableRun?.status === 'failed'
        )
          await this.options.streams?.finish(claim, {
            version: 1,
            runId: claim.runId,
            type: 'finish',
          });
      }
      return { kind: 'done' };
    } catch (error) {
      if (attemptId && !(error instanceof UsagePolicyError)) {
        // The durable reservation intentionally remains active/unknown on interruption.
      }
      throw error;
    }
  }

  async #loadAndAuthorize(claim: StepClaim) {
    return this.options.database.withTenant(
      { orgId: claim.orgId, userId: claim.userId },
      async (tx) => {
        const run = await this.options.runs.find(tx, claim.runId);
        if (!run || !(await this.options.steps.lockClaim(tx, claim)))
          return null;
        const snapshot = record(run.resolvedConfig);
        const profile = record(
          snapshot.profileSnapshot,
        ) as unknown as RunProfile;
        validateSnapshot(profile, run.modelId);
        const facts = await this.options.facts.read(tx, {
          orgId: claim.orgId,
          userId: claim.userId,
          runId: run.id,
        });
        if (!facts) throw new Error('AI run authorization denied');
        const decision = await this.options.authorization.authorize(
          tx,
          facts,
          { profileId: run.profileId, capabilities: profile.capabilities },
          'resume',
        );
        if (!decision.allowed) throw new Error('AI run authorization denied');
        const actorScope = this.options.authorization.workerActorScope(
          tx,
          facts,
        );
        return {
          run,
          profile,
          actorScope,
          provider:
            typeof snapshot.provider === 'string' ? snapshot.provider : '',
        };
      },
    );
  }

  async #publish(claim: StepClaim, event: RunStreamEvent): Promise<void> {
    const result = await this.options.streams?.publish(claim, event);
    if (result === 'stale') throw new Error('AI step claim lost');
  }
}

function validateContextPieces(
  pieces: unknown,
  budget: number,
): asserts pieces is ContextPiece[] {
  if (!Array.isArray(pieces)) throw new Error('Invalid AI context result');
  let bytes = 0;
  for (const piece of pieces) {
    if (
      !piece ||
      typeof piece !== 'object' ||
      typeof piece.label !== 'string' ||
      typeof piece.text !== 'string'
    )
      throw new Error('Invalid AI context result');
    bytes += Buffer.byteLength(piece.text, 'utf8');
  }
  if (bytes > budget) throw new Error('AI context budget exceeded');
}

function validateSnapshot(profile: RunProfile, modelId: string): void {
  if (
    !profile ||
    typeof profile !== 'object' ||
    !Array.isArray(profile.allowedModels) ||
    !profile.allowedModels.includes(modelId) ||
    !Number.isSafeInteger(profile.maxAttemptsPerStep) ||
    !Number.isSafeInteger(profile.maxIterations) ||
    !Number.isSafeInteger(profile.tokenBudget) ||
    !Number.isSafeInteger(profile.maxOutputTokens) ||
    !profile.contextBudgets ||
    typeof profile.contextBudgets !== 'object' ||
    !Array.isArray(profile.capabilities)
  )
    throw new Error('AI profile snapshot invalid');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('AI run snapshot invalid');
  return value as Record<string, unknown>;
}

function renderContexts(pieces: readonly ContextPiece[]): string {
  return pieces.map((piece) => `[${piece.label}]\n${piece.text}`).join('\n\n');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function claimHeartbeat(
  coordinator: StepCoordinator,
  claim: StepClaim,
  parentSignal: AbortSignal,
): {
  signal: AbortSignal;
  abort: (reason: unknown) => void;
  stop: () => Promise<void>;
} {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) relayAbort();
  else parentSignal.addEventListener('abort', relayAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  let stopped = false;
  const interval = Math.max(10, Math.floor(coordinator.leaseDurationMs / 3));
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      renewal = (async () => {
        try {
          if (!(await coordinator.renew(claim)))
            controller.abort(new Error('AI step claim lost'));
        } catch (error) {
          controller.abort(error);
        }
        if (!controller.signal.aborted) schedule();
      })();
    }, interval);
  };
  schedule();
  return {
    signal: controller.signal,
    abort: (reason: unknown) => controller.abort(reason),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      parentSignal.removeEventListener('abort', relayAbort);
      await renewal;
    },
  };
}
