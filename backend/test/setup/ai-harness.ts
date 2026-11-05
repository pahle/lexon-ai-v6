import {
  AiCapacityRepository,
  AiAttemptRepository,
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
import type { JobEnvelope } from '../../src/infrastructure/db/index.js';

export interface AiHarnessServices {
  readonly database: TenantDatabase;
  readonly capacity: AiCapacityRepository;
  readonly capacityConfig: AiConfig;
  readonly allowlist: unknown;
  readonly authorization: RunAuthorizationService;
  readonly close: () => Promise<void>;
}

/** Test/evaluation composition: real tenant storage and policy, explicit gateway and registrations. */
export async function createAiHarness(
  services: AiHarnessServices,
  registrations: EngineRegistrations,
  gateway: ModelGateway,
) {
  await services.capacity.configure(services.capacityConfig);
  const registry = new RunRegistry();
  registry.register(registrations);
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const outbox = new OutboxRepository();
  const executor = new JobExecutor(services.database);
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
  const coordinator = new StepCoordinator(
    services.database,
    runs,
    steps,
    new AiAttemptRepository(),
    outbox,
    executor,
  );
  return {
    gateway,
    start(actor: RunActor, input: { profileId: string; prompt: string }) {
      return runService.start(actor, input);
    },
    dispatch(job: JobEnvelope) {
      return coordinator.claim(job);
    },
    async drain(): Promise<never> {
      throw new Error('AI generation executor is not enabled in Task 7');
    },
    inspect(ctx: { orgId: string; userId: string }, runId: string) {
      return services.database.withTenant(ctx, (tx) => runs.find(tx, runId));
    },
    close: services.close,
  };
}
