import {
  AiCapacityRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  requireSession,
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
import { ChatTitleService } from '../../src/modules/chat/chat-title.service.js';
import type { CancelSignals } from '../../src/infrastructure/queue/index.js';
import type { RunStreams } from '../../src/infrastructure/queue/index.js';
import type { JobEnvelope } from '../../src/infrastructure/db/index.js';
import { randomUUID } from 'node:crypto';

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
  options: {
    cancelSignals?: CancelSignals;
    streams?: RunStreams;
    chatTitleServiceFactory?: (runs: RunService) => ChatTitleService;
  } = {},
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
  const chatTitles = options.chatTitleServiceFactory?.(runService);
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
    ...(chatTitles ? { chatTitles } : {}),
    ...(options.cancelSignals ? { cancelSignals: options.cancelSignals } : {}),
    ...(options.streams ? { streams: options.streams } : {}),
  });
  return {
    gateway,
    runService,
    runs,
    steps,
    coordinator,
    authorization: services.authorization,
    async start(
      actor: RunActor,
      input: {
        profileId: string;
        prompt: string;
        effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
        resourceIds?: readonly string[];
      },
    ) {
      // Production topology: every run is bound to a chat through
      // chat_runs with resolvedConfig.resourceIds naming that chat — the
      // write-fence trigger enforces the binding, and the stream proofs
      // and registry read through the link. Callers that name their own
      // resourceIds bind their chat themselves; otherwise the harness
      // stands in a standalone chat the same way ChatService.send does.
      let chatId: string | undefined;
      if (!input.resourceIds || input.resourceIds.length === 0) {
        chatId = randomUUID();
        await services.database.withTenant(actor, async (tx) => {
          const { client } = requireSession(tx);
          await client.query(
            'INSERT INTO app.chats(id,org_id,owner_user_id) VALUES($1,$2,$3)',
            [chatId, actor.orgId, actor.userId],
          );
        });
      }
      const created = await runService.start(actor, {
        ...input,
        ...(chatId ? { resourceIds: [chatId] } : {}),
      });
      if (chatId) {
        const { runId } = created as { runId: string };
        await services.database.withTenant(actor, async (tx) => {
          const { client } = requireSession(tx);
          await client.query(
            `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
             VALUES($1,$2,$3,'answer')`,
            [actor.orgId, chatId, runId],
          );
        });
      }
      return created;
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
