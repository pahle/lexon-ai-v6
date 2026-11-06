import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  EvaluationActor,
  EvaluationEngine,
  EvaluationOptions,
} from './evaluation-contracts.js';
import { createAiFixture } from '../infrastructure/db/testing/ai-fixture.js';
import {
  cloneDatabase,
  dropDatabase,
  roleUrl,
} from '../infrastructure/db/testing/provision.js';
import {
  AiAttemptRepository,
  AiCapacityRepository,
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
} from '../infrastructure/db/index.js';
import {
  createSdkScriptedModelGateway,
  ModelAllowlistSchema,
} from '../infrastructure/ai/index.js';
import { readAiConfig } from '../config/ai-config.js';
import { z } from 'zod';
import {
  CancelSignals,
  QueueConsumer,
  QueueProducer,
} from '../infrastructure/queue/index.js';
import type { JobHandlerRegistry } from '../infrastructure/queue/job-contracts.js';
import { DispatcherSession } from '../infrastructure/db/index.js';
import { JobExecutor } from '../modules/platform/job-executor.js';
import { OutboxDispatcher } from '../modules/platform/outbox-dispatcher.js';
import { JobRegistry } from '../modules/platform/job-registry.js';
import { AttemptService } from '../modules/usage/index.js';
import { recordAiTestToolEffect } from '../infrastructure/db/testing/ai-fixture.js';
import { stepJobId } from '../modules/chat/step-job-id.js';
import type { JobEnvelope } from '../infrastructure/db/index.js';
import {
  ApprovalService,
  CancelService,
  RunRegistry,
  RunService,
  StepCoordinator,
  StepExecutor,
} from '../modules/chat/index.js';
import type { RunProfile } from '../modules/chat/run-contracts.js';
import { RunAuthorizationService } from '../modules/identity-access/run-authorization.service.js';
import type { RunActor } from '../modules/identity-access/run-actor.js';
import { RequestIdentity } from '../modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../modules/identity-access/identity.types.js';
import type {
  EvaluationScoreReport,
  EvaluationStartInput,
} from './evaluation-contracts.js';
import type { ToolDefinition } from '../modules/chat/run-contracts.js';

const modelId = 'openai/gpt-6-luna';
const scenarioIds = new Set([
  'complete',
  'cancel',
  'budget',
  'approval',
  'crash',
  'hostile-context',
  'hostile-tool-result',
  'unauthorized-write',
  'replay',
  'unknown-attempt',
]);

export async function createEvaluationHarness(
  options: EvaluationOptions,
): Promise<EvaluationEngine> {
  if (options.fixtureSet !== 'deterministic')
    throw new Error('Invalid evaluation fixture set');
  const base = new URL(options.services.postgresUrl);
  const password = decodeURIComponent(base.password);
  const template = base.pathname.slice(1);
  if (!/^lexon_test_[a-f0-9]+$/.test(template) || !password)
    throw new Error('Invalid evaluation infrastructure descriptor');
  const adminUrl = new URL(options.services.postgresUrl);
  adminUrl.pathname = '/postgres';
  const postgresAdminUrl = adminUrl.toString();
  const databaseName = `lexon_test_${randomBytes(8).toString('hex')}`;
  const appUrl = roleUrl(postgresAdminUrl, 'lexon_app', password, databaseName);
  const migratorUrl = roleUrl(
    postgresAdminUrl,
    'lexon_migrator',
    password,
    databaseName,
  );
  const runId = randomBytes(8).toString('hex');
  const queuePrefix = `lexon_eval_${runId}`;
  const bucket = `lexon-eval-${runId}`;
  const storage = new S3Client({
    endpoint: options.services.seaweedS3Url,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'lexon-local-test', secretAccessKey: password },
  });
  let cloned = false;
  let bucketCreated = false;
  let fixture: Awaited<ReturnType<typeof createAiFixture>> | undefined;
  let producer: QueueProducer | undefined;
  let consumer: QueueConsumer | undefined;
  let signals: CancelSignals | undefined;
  let dispatcherSession: DispatcherSession | undefined;
  let dispatcherTask: Promise<void> | undefined;
  let dispatcherAbort: AbortController | undefined;
  try {
    await cloneDatabase(postgresAdminUrl, template, databaseName);
    cloned = true;
    await storage.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    fixture = await createAiFixture({ appUrl, migratorUrl });
    const database = fixture.database;
    const runs = new AiRunRepository();
    const steps = new AiStepRepository();
    const operations = new AiOperationRepository();
    const facts = new RunActorFactsRepository();
    const outbox = new OutboxRepository(database);
    const attempts = new AiAttemptRepository();
    const capacity = new AiCapacityRepository(database);
    const capacityConfig = readAiConfig({});
    const authorization = new RunAuthorizationService();
    const profiles = [...scenarioIds].map((scenarioId) =>
      profileFor(scenarioId),
    );
    const registry = new RunRegistry();
    registry.register({
      profiles,
      contexts: [
        {
          id: 'hostile-context',
          version: 1,
          async collect() {
            return [
              { label: 'fixture-context', text: 'HOSTILE_CONTEXT_SENTINEL' },
            ];
          },
        },
      ],
      tools: [
        {
          id: 'fixture-read',
          version: 1,
          kind: 'read',
          requiresApproval: false,
          timeoutMs: 1000,
          maxInputBytes: 1024,
          maxResultBytes: 1024,
          capabilities: ['fixture.read'],
          inputSchema: z.object({}),
          async execute() {
            return { value: 'HOSTILE_TOOL_RESULT_SENTINEL' };
          },
        },
        transactionalTool('fixture-write', false),
        transactionalTool('fixture-write-approval', true),
      ],
    });
    const allowlist = ModelAllowlistSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../config/model-allowlist.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const runService = new RunService(
      database,
      runs,
      steps,
      outbox,
      facts,
      authorization,
      registry,
      capacity,
      capacityConfig,
      allowlist,
    );
    const dispatcherOptions = {
      pollMs: 20,
      retryBaseMs: 100,
      retryCapMs: 500,
      batchSize: 50,
      leaseMs: 5000,
      enqueueTimeoutMs: 2000,
    };
    const producerOptions = {
      url: options.services.valkeyUrl,
      limiterUrl: options.services.valkeyUrl,
      prefix: queuePrefix,
    };
    producer = new QueueProducer(producerOptions);
    signals = new CancelSignals({
      url: options.services.valkeyUrl,
      prefix: queuePrefix,
      database,
      runs,
    });
    const attemptService = new AttemptService();
    const coordinator = new StepCoordinator(
      database,
      runs,
      steps,
      attemptService,
      outbox,
      new JobExecutor(database),
      undefined,
      operations,
    );
    const scenarioByRun = new Map<string, string>();
    const requestsByRun = new Map<string, number>();
    const contextSeenByRun = new Set<string>();
    const gateway = createSdkScriptedModelGateway(
      (input) => {
        const id = input.runId ?? '';
        if (
          input.messages.some(
            (message) =>
              message.role === 'system' &&
              typeof message.content === 'string' &&
              message.content.includes('HOSTILE_CONTEXT_SENTINEL'),
          )
        )
          contextSeenByRun.add(id);
        return scriptedResponse(
          scenarioByRun.get(id) ?? 'complete',
          requestsByRun.get(id) ?? 0,
        );
      },
      (id) => {
        if (id) requestsByRun.set(id, (requestsByRun.get(id) ?? 0) + 1);
      },
    );
    const stepExecutor = new StepExecutor({
      database,
      runs,
      steps,
      operations,
      facts,
      authorization,
      coordinator,
      attempts: attemptService,
      registry,
      gateway,
      cancelSignals: signals,
    });
    consumer = new QueueConsumer(producerOptions, new JobExecutor(database), {
      interactiveConcurrency: 2,
      batchConcurrency: 1,
      stepLeaseMs: 5000,
      lockDuration: 10000,
      stalledInterval: 10000,
      busyRetryMs: 100,
    });
    const jobRegistry = createJobRegistry(stepExecutor);
    const tenantActors = fixture.tenants.map(({ orgId, userId }) => ({
      orgId,
      userId,
    }));
    const actorIndices = new Map(
      tenantActors.map((actor, index) => [actorKey(actor), index]),
    );
    const scenarios = new Map<string, string>();
    const runTenantIndices = new Map<string, number>();
    const activeRuns = new Set<string>();
    const replayedRuns = new Set<string>();
    const approval = new ApprovalService(
      database,
      runs,
      steps,
      operations,
      facts,
      authorization,
      outbox,
      registry,
    );
    const cancel = new CancelService(
      database,
      runs,
      steps,
      facts,
      authorization,
      undefined,
      signals,
    );

    const engine: EvaluationEngine = {
      actors: tenantActors,
      async start(actor, input: EvaluationStartInput) {
        const index = requireActor(actor, actorIndices);
        if (!scenarioIds.has(input.scenarioId))
          throw new Error('Unknown evaluation scenario');
        const run = await withActorScope(
          actor,
          index,
          fixture!,
          authorization,
          (runActor) =>
            runService.start(runActor, {
              profileId: `eval-${input.scenarioId}`,
              prompt: input.prompt,
            }),
        );
        scenarios.set(run.runId, input.scenarioId);
        runTenantIndices.set(run.runId, index);
        scenarioByRun.set(run.runId, input.scenarioId);
        activeRuns.add(run.runId);
        return run;
      },
      async cancel(actor, id) {
        const index = requireActor(actor, actorIndices);
        await withActorScope(
          actor,
          index,
          fixture!,
          authorization,
          (runActor) => cancel.cancel(runActor, id),
        );
      },
      async decide(actor, input) {
        const index = requireActor(actor, actorIndices);
        const run = await fixture!.withTenant(index, (tx) =>
          runs.find(tx, input.runId),
        );
        if (!run || run.initiatingUserId !== actor.userId)
          throw new Error('Evaluation approval refused');
        const pending = (
          await fixture!.withTenant(index, (tx) =>
            operations.forRun(tx, {
              runId: input.runId,
              throughSequence: run.nextSequence,
            }),
          )
        ).find((operation) => operation.status === 'awaiting_approval');
        if (!pending) throw new Error('Evaluation approval unavailable');
        await withActorScope(
          actor,
          index,
          fixture!,
          authorization,
          (runActor) =>
            approval.decide(runActor, {
              runId: input.runId,
              operationId: pending.id,
              snapshotHash: pending.snapshotHash,
              decision: input.approved ? 'approve' : 'reject',
            }),
        );
      },
      async read(actor, id) {
        const index = requireActor(actor, actorIndices);
        const run = await fixture!.withTenant(index, (tx) => runs.find(tx, id));
        if (!run)
          return {
            scenarioId: scenarios.get(id) ?? 'unknown',
            score: 0,
            status: 'unknown',
            safeCode: 'AI_RUN_NOT_FOUND',
            counts: {},
          };
        const [attemptRows, operationRows, effects] = await Promise.all([
          fixture!.withTenant(index, (tx) => attempts.list(tx, id)),
          fixture!.withTenant(index, (tx) =>
            operations.forRun(tx, {
              runId: id,
              throughSequence: run.nextSequence,
            }),
          ),
          fixture!.toolEffectCount(index),
        ]);
        const status =
          run.status === 'completed'
            ? 'completed'
            : run.status === 'cancelled'
              ? 'cancelled'
              : run.status === 'failed'
                ? 'failed'
                : run.status === 'awaiting_approval'
                  ? 'awaiting_approval'
                  : 'unknown';
        return {
          scenarioId: scenarios.get(id) ?? 'unknown',
          score: status === 'completed' ? 1 : 0,
          status,
          safeCode: isSafeCode(run.errorCode) ? run.errorCode : null,
          counts: {
            attempts: attemptRows.length,
            operations: operationRows.length,
            effects,
            unknownAttempts: attemptRows.filter(
              (attempt) => attempt.outcome === 'unknown',
            ).length,
            modelRequests: requestsByRun.get(id) ?? 0,
            contextFixtures: contextSeenByRun.has(id) ? 1 : 0,
            replays: replayedRuns.has(id) ? 1 : 0,
          },
        } satisfies EvaluationScoreReport;
      },
      async drain() {
        if (!consumer || !producer)
          throw new Error('Evaluation queue is unavailable');
        if (!dispatcherTask) {
          await consumer.start(jobRegistry);
          dispatcherSession = new DispatcherSession(appUrl);
          const dispatcher = new OutboxDispatcher(
            outbox,
            dispatcherSession,
            producer,
            dispatcherOptions,
          );
          dispatcherAbort = new AbortController();
          dispatcherTask = dispatcher.start(dispatcherAbort.signal);
        }
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const states = await Promise.all(
            [...activeRuns].map(async (id) => {
              const tenantIndex = runTenantIndices.get(id);
              if (tenantIndex === undefined) return 'missing';
              return fixture!.withTenant(
                tenantIndex,
                async (tx) => (await runs.find(tx, id))?.status ?? 'missing',
              );
            }),
          );
          if (
            states.every((status) =>
              [
                'completed',
                'failed',
                'cancelled',
                'awaiting_approval',
              ].includes(status),
            )
          ) {
            for (const id of activeRuns) {
              if (scenarios.get(id) !== 'replay' || replayedRuns.has(id))
                continue;
              const index = runTenantIndices.get(id);
              if (index === undefined) continue;
              const actor = tenantActors[index]!;
              const duplicate: JobEnvelope = {
                outboxId: stepJobId(id, 1),
                type: 'run.start.v1',
                ctx: { orgId: actor.orgId, userId: actor.userId },
                payload: { runId: id, sequence: 1, expectedVersion: 1 },
              };
              await stepExecutor.execute(duplicate, {
                signal: new AbortController().signal,
              });
              replayedRuns.add(id);
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Evaluation run drain timed out');
      },
      async close() {
        dispatcherAbort?.abort();
        await dispatcherTask?.catch(() => undefined);
        await consumer?.close();
        await producer?.close();
        await signals?.close();
        await fixture?.close();
        if (bucketCreated)
          await storage
            .send(new DeleteBucketCommand({ Bucket: bucket }))
            .catch(() => undefined);
        storage.destroy();
        if (cloned) await dropDatabase(postgresAdminUrl, databaseName);
      },
    };
    return engine;
  } catch (error) {
    dispatcherAbort?.abort();
    await dispatcherTask?.catch(() => undefined);
    await consumer?.close().catch(() => undefined);
    await producer?.close().catch(() => undefined);
    await signals?.close().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
    if (bucketCreated)
      await storage
        .send(new DeleteBucketCommand({ Bucket: bucket }))
        .catch(() => undefined);
    storage.destroy();
    if (cloned)
      await dropDatabase(postgresAdminUrl, databaseName).catch(() => undefined);
    const details = safeDiagnostic(error);
    throw new Error(
      `Deterministic evaluation fixture setup failed (${details.name}${details.code ? `:${details.code}` : ''})`,
      // eslint-disable-next-line preserve-caught-error -- The original error may carry fixture secrets; expose only the redacted diagnostic.
      { cause: new Error(details.stack) },
    );
  }
}

function profileFor(scenarioId: string): RunProfile {
  const budget = scenarioId === 'budget' ? 130 : 10_000;
  const output = scenarioId === 'budget' ? 128 : 100;
  return {
    id: `eval-${scenarioId}`,
    version: 1,
    allowedModels: [modelId],
    defaultModel: modelId,
    queue: 'ai-interactive',
    priority: 5,
    maxIterations: 3,
    tokenBudget: budget,
    maxOutputTokens: output,
    contextBudgets:
      scenarioId === 'hostile-context' ? { 'hostile-context': 256 } : {},
    capabilities:
      scenarioId === 'approval' || scenarioId === 'replay'
        ? ['fixture.write']
        : scenarioId === 'hostile-tool-result'
          ? ['fixture.read']
          : [],
    maxAttemptsPerStep: 2,
    maxToolInputBytes: 12000,
    maxToolResultBytes: 14000,
    maxToolTimeoutMs: 4000,
  };
}

function transactionalTool(
  id: string,
  requiresApproval: boolean,
): ToolDefinition {
  return {
    id,
    version: 1,
    kind: 'write',
    idempotency: { mode: 'transactional' },
    requiresApproval,
    timeoutMs: 1000,
    maxInputBytes: 1024,
    maxResultBytes: 1024,
    capabilities: ['fixture.write'],
    inputSchema: z.object({ value: z.string().max(100) }),
    async execute(input, context) {
      const parsed = z.object({ value: z.string().max(100) }).parse(input);
      await recordAiTestToolEffect(
        context.tenant,
        context.operationId,
        parsed.value,
      );
      return { written: true };
    },
  };
}

function scriptedResponse(scenarioId: string, requestCount: number) {
  if (scenarioId === 'hostile-tool-result')
    return requestCount === 1
      ? { toolCall: { toolName: 'fixture-read', input: {} } }
      : { text: 'READY' };
  if (scenarioId === 'approval')
    return {
      ...(requestCount === 1
        ? {
            toolCall: {
              toolName: 'fixture-write-approval',
              input: { value: 'approved-effect' },
            },
          }
        : { text: 'READY' }),
    };
  if (scenarioId === 'unauthorized-write')
    return {
      toolCall: {
        toolName: 'fixture-write',
        input: { value: 'forged-effect' },
      },
    };
  if (scenarioId === 'replay')
    return {
      ...(requestCount === 1
        ? {
            toolCall: {
              toolName: 'fixture-write',
              input: { value: 'single-effect' },
            },
          }
        : { text: 'READY' }),
    };
  if (scenarioId === 'unknown-attempt')
    return {
      text: 'HOSTILE_PROMPT_SENTINEL',
      outcome: {
        finishReason: 'error' as const,
        attemptOutcome: 'unknown' as const,
        retryable: false,
        safeCode: 'AI_PROVIDER_UNAVAILABLE' as const,
      },
    };
  if (scenarioId === 'crash')
    return { text: 'RESPONSE_RECEIVED_BEFORE_WORKER_LOSS', dropOutcome: true };
  if (scenarioId === 'hostile-context')
    return { text: 'HOSTILE_CONTEXT_SENTINEL' };
  return { text: 'READY' };
}

function createJobRegistry(executor: StepExecutor): JobHandlerRegistry {
  const registry = new JobRegistry();
  registry.register('platform.noop.v1', {
    strategy: 'short-transaction',
    handle: async () => undefined,
  });
  for (const type of ['run.start.v1', 'run.advance.v1', 'run.resume.v1'])
    registry.register(type, {
      strategy: 'durable-step',
      handle: (job, context) => executor.execute(job, context),
      exhausted: (job) => executor.exhausted(job),
    });
  return registry;
}

async function withActorScope<T>(
  actor: EvaluationActor,
  index: number,
  fixture: Awaited<ReturnType<typeof createAiFixture>>,
  authorization: RunAuthorizationService,
  work: (actor: RunActor) => Promise<T>,
): Promise<T> {
  const tenant = fixture.tenants[index]!;
  const request = {};
  const identities = new RequestIdentity();
  const sessionId = randomUUID();
  identities.prepare(
    request,
    {
      identity: {
        userId: actor.userId,
        sessionId,
        activeOrganizationId: actor.orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      tenant: { orgId: actor.orgId, userId: actor.userId, role: 'owner' },
      summary: {
        version: 1,
        user: {
          version: 1,
          id: actor.userId,
          name: 'Evaluation fixture',
          email: `${actor.userId}@example.test`,
          emailVerified: true,
          twoFactorEnabled: false,
          onboardingCompleted: true,
        },
        organization: {
          version: 1,
          id: actor.orgId,
          name: 'Evaluation fixture',
          slug: `evaluation-${index}`,
          kind: 'personal',
          state: 'active',
          require2fa: false,
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
        platformAdmin: false,
      },
    },
    new Headers(),
  );
  if (tenant.orgId !== actor.orgId || tenant.userId !== actor.userId)
    throw new Error('Evaluation actor is invalid');
  return identities.run(request, () =>
    authorization.withActor(currentVerifiedIdentity(), work),
  );
}

function actorKey(actor: EvaluationActor): string {
  return `${actor.orgId}:${actor.userId}`;
}

function requireActor(
  actor: EvaluationActor,
  actors: ReadonlyMap<string, number>,
): number {
  const index = actors.get(actorKey(actor));
  if (index === undefined) throw new Error('Evaluation actor is invalid');
  return index;
}

function isSafeCode(
  value: string | null,
): value is NonNullable<EvaluationScoreReport['safeCode']> {
  return Boolean(value && /^AI_[A-Z0-9_]{1,48}$/.test(value));
}

function safeDiagnostic(error: unknown): {
  name: string;
  code?: string;
  stack: string;
} {
  if (!(error instanceof Error))
    return { name: 'UnknownError', stack: 'Unknown fixture setup failure' };
  const code =
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,32}$/.test(error.code)
      ? error.code
      : undefined;
  const stack = (error.stack ?? error.name)
    .replace(/(?:postgres(?:ql)?|redis|https?):\/\/[^\s)]+/gi, '[service-url]')
    .slice(0, 2000);
  return {
    name: /^[A-Za-z0-9_]{1,80}$/.test(error.name) ? error.name : 'Error',
    ...(code ? { code } : {}),
    stack,
  };
}
