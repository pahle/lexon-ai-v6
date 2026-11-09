import 'reflect-metadata';
import type {
  ModelEvent,
  ModelGateway,
  ModelInput,
} from '../../src/infrastructure/ai/index.js';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import {
  CancelSignals,
  QueueConsumer,
  RunStreams,
} from '../../src/infrastructure/queue/index.js';
import type { RunStreamAuthority } from '../../src/infrastructure/queue/index.js';
import { JobRegistry } from '../../src/modules/platform/job-registry.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RunRegistry } from '../../src/modules/chat/run-registry.js';
import { StepCoordinator } from '../../src/modules/chat/step-coordinator.js';
import { StepExecutor } from '../../src/modules/chat/step-executor.js';
import { AttemptService } from '../../src/modules/usage/attempt.service.js';
import type { RunProfile } from '../../src/modules/chat/run-contracts.js';

interface WorkerInput {
  readonly appUrl: string;
  readonly queueUrl: string;
  readonly streamUrl: string;
  readonly prefix: string;
  readonly tenant: { readonly orgId: string; readonly userId: string };
  readonly profile: RunProfile;
  readonly pause:
    'none' | 'after-model-response' | 'after-final-commit-before-ack';
  readonly resultText: string;
  readonly generationId: string;
}

let releasePause: (() => void) | undefined;
let released = false;
process.on('message', (message: { action?: string }) => {
  if (message.action === 'release') {
    released = true;
    releasePause?.();
  }
});

function send(checkpoint: string): void {
  process.send?.({ checkpoint });
}

async function pause(signal?: AbortSignal): Promise<void> {
  if (released) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      releasePause = undefined;
      reject(signal?.reason);
    };
    releasePause = () => {
      cleanup();
      resolve();
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

process.once('message', async (input: WorkerInput) => {
  const database = new TenantDatabase({
    appUrl: input.appUrl,
    poolMax: 3,
    statementTimeoutMs: 20_000,
  });
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const operations = new AiOperationRepository();
  const authorization = new RunAuthorizationService();
  const registry = new RunRegistry();
  registry.register({ profiles: [input.profile], contexts: [], tools: [] });
  const gateway: ModelGateway = {
    generate(modelInput: ModelInput): AsyncIterable<ModelEvent> {
      return (async function* () {
        yield {
          type: 'metadata' as const,
          generationId: input.generationId,
          provider: 'synthetic',
        };
        yield { type: 'text' as const, text: input.resultText };
        if (input.pause === 'after-model-response')
          await new Promise((resolve) => setTimeout(resolve, 1200));
        yield {
          type: 'usage' as const,
          usage: { inputTokens: 20, outputTokens: 3 },
        };
        yield {
          type: 'outcome' as const,
          outcome: {
            finishReason: 'stop' as const,
            attemptOutcome: 'succeeded' as const,
            retryable: false,
            generationId: input.generationId,
            provider: 'synthetic',
            usage: { inputTokens: 20, outputTokens: 3 },
          },
        };
        if (input.pause === 'after-model-response') {
          send('model-responded-before-persistence');
          await pause(modelInput.signal);
          send('model-pause-released');
        }
      })();
    },
  };
  const streams = new RunStreams({
    url: input.streamUrl,
    prefix: input.prefix,
    authority: {
      authorizeActive: (claim) =>
        database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamActiveProof(tx, claim),
        ),
      authorizeTerminal: (claim) =>
        database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamTerminalProof(tx, claim),
        ),
      reconcile: async (entries) =>
        Promise.all(
          entries.map(async ({ runId, orgId, userId }) => {
            const result = await database.withTenant({ orgId, userId }, (tx) =>
              runs.streamRegistryState(tx, runId, userId),
            );
            return result.state === 'terminal'
              ? { runId, state: 'terminal' as const, claim: result.claim }
              : { runId, state: result.state };
          }),
        ),
    } satisfies RunStreamAuthority,
  });
  const cancelSignals = new CancelSignals({
    url: input.streamUrl,
    prefix: input.prefix,
    database,
    runs,
  });
  const attempts = new AttemptService();
  const coordinator = new StepCoordinator(
    database,
    runs,
    steps,
    attempts,
    new OutboxRepository(),
    new JobExecutor(database),
    1000,
    operations,
  );
  const executor = new StepExecutor({
    database,
    runs,
    steps,
    operations,
    facts: new RunActorFactsRepository(),
    authorization,
    coordinator,
    attempts,
    registry,
    gateway,
    streams,
    cancelSignals,
  });
  const jobs = new JobRegistry();
  for (const type of ['run.start.v1', 'run.advance.v1', 'run.resume.v1'])
    jobs.register(type, {
      strategy: 'durable-step',
      handle: async (job, context) => {
        try {
          const result = await executor.execute(job, context);
          if (input.pause === 'after-final-commit-before-ack') {
            send('final-commit-before-ack');
            await pause();
          } else send('job-completed');
          return result;
        } catch (error) {
          send('handler-failed');
          throw error;
        }
      },
    });
  const consumer = new QueueConsumer(
    { url: input.queueUrl, prefix: input.prefix },
    new JobExecutor(database),
    {
      lockDuration: 1000,
      stalledInterval: 500,
      stepLeaseMs: 1000,
      busyRetryMs: 100,
      interactiveConcurrency: 1,
      batchConcurrency: 1,
    },
  );
  try {
    await consumer.start(jobs);
    send('worker-ready');
  } catch {
    send('worker-start-failed');
    await cancelSignals.close();
    await streams.close();
    await database.close();
    process.exitCode = 1;
  }
  process.once('SIGTERM', () => {
    send('shutdown-started');
    void consumer
      .close()
      .then(() => {
        send('consumer-closed');
        return cancelSignals.close();
      })
      .then(() => streams.close())
      .then(() => database.close())
      .then(() => {
        send('shutdown-complete');
        process.exit(0);
      });
  });
});
