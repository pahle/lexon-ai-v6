import {
  AiCapacityRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import type { AiConfig } from '../../src/config/ai-config.js';
import type { ModelGateway } from '../../src/infrastructure/ai/index.js';
import type {
  RunAuthorizationService,
  RunActor,
} from '../../src/modules/identity-access/index.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { RunRegistry } from '../../src/modules/chat/run-registry.js';
import type { EngineRegistrations } from '../../src/modules/chat/run-contracts.js';
import { RunService } from '../../src/modules/chat/run.service.js';
import { StepCoordinator } from '../../src/modules/chat/step-coordinator.js';
import { AttemptService } from '../../src/modules/usage/index.js';
import { StepExecutor } from '../../src/modules/chat/step-executor.js';
import type { CancelSignals } from '../../src/infrastructure/queue/index.js';
import type { RunStreams } from '../../src/infrastructure/queue/index.js';
import type { JobEnvelope } from '../../src/infrastructure/db/index.js';

export interface AiHarnessServices {
  readonly database: TenantDatabase;
  readonly capacity: AiCapacityRepository;
  readonly capacityConfig: AiConfig;
  readonly allowlist: unknown;
  readonly authorization: RunAuthorizationService;
  readonly close: () => Promise<void>;
}

export async function measureHop(
  services: { run(samples: number): Promise<readonly number[]> },
  options: { samples?: number } = {},
) {
  const count = options.samples ?? 20;
  if (!Number.isSafeInteger(count) || count !== 20)
    throw new Error('Hop measurement requires twenty warm samples');
  const values = [...(await services.run(count))];
  if (
    values.length !== count + 1 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('Invalid queue-hop measurement');
  const coldMs = values[0]!;
  const samplesMs = values.slice(1);
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    coldMs,
    medianMs:
      sorted.length % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    maxMs: sorted[sorted.length - 1]!,
    samplesMs,
  };
}

/** Test/evaluation composition: real tenant storage and policy, explicit gateway and registrations. */
export async function createAiHarness(
  services: AiHarnessServices,
  registrations: EngineRegistrations,
  gateway: ModelGateway,
  instrumentation?: {
    onStepClaim(outboxId: string, at: number): void;
  },
  options: { cancelSignals?: CancelSignals; streams?: RunStreams } = {},
) {
  await services.capacity.configure(services.capacityConfig);
  const registry = new RunRegistry();
  registry.register(registrations);
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const outbox = new OutboxRepository();
  const executor = new JobExecutor(services.database);
  const coordinator: StepCoordinator = new (class extends StepCoordinator {
    override async claim(job: JobEnvelope) {
      const result = await super.claim(job);
      if (result.kind === 'claimed')
        instrumentation?.onStepClaim(job.outboxId, performance.now());
      return result;
    }
  })(services.database, runs, steps, new AttemptService(), outbox, executor);
  const runService = new RunService(
    services.database,
    runs,
    steps,
    outbox,
    new RunActorFactsRepository(),
    services.authorization,
    registry,
    services.capacity,
    services.capacityConfig,
    services.allowlist as never,
  );
  const stepExecutor = new StepExecutor({
    database: services.database,
    runs,
    steps,
    facts: new RunActorFactsRepository(),
    authorization: services.authorization,
    coordinator,
    attempts: new AttemptService(),
    registry,
    gateway,
    ...(options.cancelSignals ? { cancelSignals: options.cancelSignals } : {}),
    ...(options.streams ? { streams: options.streams } : {}),
  });
  return {
    gateway,
    runs,
    steps,
    coordinator,
    authorization: services.authorization,
    start(
      actor: RunActor,
      input: {
        profileId: string;
        prompt: string;
        resourceIds?: readonly string[];
      },
    ) {
      return runService.start(actor, input);
    },
    dispatch(job: JobEnvelope) {
      return coordinator.claim(job);
    },
    execute(job: JobEnvelope, context: { signal: AbortSignal }) {
      return stepExecutor.execute(job, context);
    },
    inspect(ctx: { orgId: string; userId: string }, runId: string) {
      return services.database.withTenant(ctx, (tx) => runs.find(tx, runId));
    },
    close: services.close,
  };
}
