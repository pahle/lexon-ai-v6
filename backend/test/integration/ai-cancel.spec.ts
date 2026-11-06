import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { expect } from 'vitest';
import { Redis } from 'ioredis';
import { test } from '../setup/file-services.js';
import {
  AiAttemptRepository,
  AiRunRepository,
  AiStepRepository,
  RunActorFactsRepository,
  TenantDatabase,
  type StepClaim,
  type TerminalStreamReference,
  type JobEnvelope,
} from '../../src/infrastructure/db/index.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { aiTestBackendPid } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  CancelSignals,
  QueueConsumer,
  QueueProducer,
  RunStreams,
} from '../../src/infrastructure/queue/index.js';
import { JobExecutor, JobRegistry } from '../../src/modules/platform/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { CancelService } from '../../src/modules/chat/cancel.service.js';
import { createAiHarness } from '../setup/ai-harness.js';
import { readFileSync } from 'node:fs';
import {
  createScriptedModelGateway,
  ModelAllowlistSchema,
} from '../../src/infrastructure/ai/index.js';
import type { ModelGateway } from '../../src/infrastructure/ai/index.js';
import type { RunProfile } from '../../src/modules/chat/run-contracts.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);

async function asActor<T>(
  tenant: { orgId: string; userId: string },
  authorization: RunAuthorizationService,
  work: (
    actor: Parameters<RunAuthorizationService['withActor']>[1] extends (
      actor: infer TActor,
    ) => Promise<unknown>
      ? TActor
      : never,
  ) => Promise<T>,
): Promise<T> {
  const request = {};
  const identities = new RequestIdentity();
  identities.prepare(
    request,
    {
      identity: {
        userId: tenant.userId,
        sessionId: '10000000-0000-4000-8000-000000000001',
        activeOrganizationId: tenant.orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      tenant: { ...tenant, role: 'owner' },
      summary: {
        version: 1,
        user: {
          version: 1,
          id: tenant.userId,
          name: 'Fixture',
          email: 'fixture@example.test',
          emailVerified: true,
          twoFactorEnabled: false,
          onboardingCompleted: true,
        },
        organization: {
          version: 1,
          id: tenant.orgId,
          name: 'Fixture',
          slug: 'fixture',
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
  return identities.run(request, () =>
    authorization.withActor(currentVerifiedIdentity(), work),
  );
}

test('cancel persists terminal state for queued run and is idempotent', async ({
  services,
}) => {
  const audit = createAuditInspector(services);
  const ai = await createAiFixture(services);
  try {
    const before = await audit.count('chat.run_finished.v1');
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const runs = new AiRunRepository();
    const authorization = new RunAuthorizationService();
    const cancel = new CancelService(
      ai.database,
      runs,
      new AiStepRepository(),
      new RunActorFactsRepository(),
      authorization,
    );
    const tenant = ai.tenants[0]!;
    await asActor(tenant, authorization, (actor) =>
      cancel.cancel(actor, run.id),
    );
    await asActor(tenant, authorization, (actor) =>
      cancel.cancel(actor, run.id),
    );
    const terminal = await ai.withTenant(0, (tx) => runs.find(tx, run.id));
    expect(terminal?.status).toBe('cancelled');
    expect(await audit.count('chat.run_finished.v1')).toBe(before + 1);
  } finally {
    await audit.close();
    await ai.close();
  }
});

test('database polling signals cancellation when no Valkey message arrives', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const runs = new AiRunRepository();
  const proxy = await FaultProxy.start(services.valkey.streamsUrl);
  const signals = new CancelSignals({
    url: proxy.url,
    prefix: services.queuePrefix,
    database: ai.database,
    runs,
  });
  try {
    const run = await ai.start(0);
    const tenant = ai.tenants[0]!;
    const unbind = signals.bind(run.id, tenant);
    let resolveCancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancel = resolve;
    });
    const unsubscribe = await signals.subscribe(run.id, resolveCancel);
    proxy.disconnect();
    await ai.withTenant(0, async (tx) => {
      const current = await runs.find(tx, run.id);
      await runs.transition(tx, {
        runId: run.id,
        expectedVersion: current!.runVersion,
        from: 'queued',
        to: 'cancelling',
      });
    });
    await expect
      .poll(() => cancelled.then(() => true), { timeout: 2500 })
      .toBe(true);
    await unsubscribe();
    unbind();
  } finally {
    await signals.close();
    await proxy.close();
    await ai.close();
  }
});

test('live step claim remains valid only for cancellation cleanup', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Cancellation claim unavailable');
    const runs = new AiRunRepository();
    const steps = new AiStepRepository();
    await ai.withTenant(0, async (tx) => {
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: 1,
          from: 'queued',
          to: 'cancelling',
        }),
      ).toBe(true);
      expect(await steps.renew(tx, claim, 30_000)).toBe(true);
    });
  } finally {
    await ai.close();
  }
});

test('cancelling a streaming model aborts it and commits partial output once', async ({
  services,
}) => {
  spanExporter.reset();
  const ai = await createAiFixture(services);
  const authorization = new RunAuthorizationService();
  const tenant = ai.tenants[0]!;
  const model = 'openai/gpt-6-luna';
  const profile: RunProfile = {
    id: 'cancel-stream-profile',
    version: 1,
    allowedModels: [model],
    defaultModel: model,
    queue: 'ai-interactive',
    priority: 5,
    maxIterations: 3,
    tokenBudget: 4000,
    maxOutputTokens: 100,
    contextBudgets: {},
    capabilities: [],
  };
  let signalStarted!: () => void;
  const modelStarted = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const gateway: ModelGateway = {
    generate(input) {
      return (async function* () {
        yield {
          type: 'metadata' as const,
          generationId: 'cancelled-generation',
          provider: 'openai',
        };
        yield { type: 'text' as const, text: 'partial answer' };
        signalStarted();
        await new Promise<void>((resolve, reject) => {
          const aborted = () => reject(input.signal.reason);
          if (input.signal.aborted) aborted();
          else input.signal.addEventListener('abort', aborted, { once: true });
        });
      })();
    },
  };
  const runSignals = new CancelSignals({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    database: ai.database,
    runs: new AiRunRepository(),
  });
  const streamSteps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: (claim: StepClaim) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => streamSteps.streamActiveProof(tx, claim),
        ),
      authorizeTerminal: (claim: TerminalStreamReference) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => streamSteps.streamTerminalProof(tx, claim),
        ),
      reconcile: async () => [],
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const allowlist = ModelAllowlistSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../config/model-allowlist.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const harness = await createAiHarness(
      {
        database: ai.database,
        capacity: ai.capacity,
        capacityConfig: ai.capacityConfig,
        allowlist,
        authorization,
        close: ai.close,
      },
      { profiles: [profile], contexts: [], tools: [] },
      gateway,
      undefined,
      { cancelSignals: runSignals, streams },
    );
    const started = await asActor(tenant, authorization, (actor) =>
      harness.start(actor, {
        profileId: profile.id,
        prompt: 'Synthetic prompt',
      }),
    );
    const job = {
      outboxId: stepJobId(started.runId, 1),
      type: 'run.start.v1' as const,
      ctx: tenant,
      payload: { runId: started.runId, sequence: 1, expectedVersion: 1 },
    };
    const execution = harness.execute(job, {
      signal: new AbortController().signal,
    });
    await modelStarted;
    const cancel = new CancelService(
      ai.database,
      harness.runs,
      harness.steps,
      new RunActorFactsRepository(),
      authorization,
      streams,
      runSignals,
    );
    await asActor(tenant, authorization, (actor) =>
      cancel.cancel(actor, started.runId),
    );
    await expect
      .poll(async () => (await harness.inspect(tenant, started.runId))?.status)
      .toBe('cancelled');
    await execution;
    const terminal = await harness.inspect(tenant, started.runId);
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, started.runId),
    );
    expect(terminal).toMatchObject({
      status: 'cancelled',
      partialOutput: 'partial answer',
      finalOutput: null,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      generationId: 'cancelled-generation',
      outcome: 'unknown',
      active: false,
    });
    const streamKey = `${services.queuePrefix}:{run-streams}:${started.runId}:events`;
    const entries = await redis.xrange(streamKey, '-', '+');
    expect(JSON.parse(String(entries.at(-1)?.[1]?.[1]))).toMatchObject({
      type: 'finish',
      runId: started.runId,
    });
    const step = await ai.withTenant(0, (tx) =>
      streamSteps.find(tx, { runId: started.runId, sequence: 1 }),
    );
    if (!step) throw new Error('Cancelled step missing');
    const staleClaim: StepClaim = {
      runId: started.runId,
      orgId: tenant.orgId,
      userId: tenant.userId,
      stepId: step.id,
      sequence: 1,
      expectedVersion: 1,
      fence: step.fence,
      leaseUntil: new Date(Date.now() + 1000),
    };
    const beforeStalePublish = await redis.xlen(streamKey);
    const guardKey = `${services.queuePrefix}:{run-streams}:${started.runId}:guard`;
    expect(await redis.del(guardKey)).toBe(1);
    expect(
      await streams.publish(staleClaim, {
        version: 1,
        runId: started.runId,
        type: 'text-delta',
        id: 'late',
        delta: 'must not append',
      }),
    ).toBe('stale');
    expect(await redis.xlen(streamKey)).toBe(beforeStalePublish);
    expect(await redis.exists(guardKey)).toBe(0);
    await tracerProvider.forceFlush();
    const spans = spanExporter.getFinishedSpans();
    expect(
      spans.some(
        (span) =>
          span.name === 'ai.model' &&
          span.attributes.runId === started.runId &&
          span.attributes.status === 'failed',
      ),
    ).toBe(true);
    expect(
      spans.some(
        (span) =>
          span.name === 'ai.step' &&
          span.attributes.runId === started.runId &&
          span.attributes.status === 'cancelled',
      ),
    ).toBe(true);
    expect(
      JSON.stringify(spans.map(({ attributes }) => attributes)),
    ).not.toContain('partial answer');
  } finally {
    redis.disconnect();
    await streams.close();
    await runSignals.close();
    await ai.close();
  }
});

test('exhausted delivery fails only its current expired step and stale delivery is a no-op', async ({
  services,
}) => {
  const audit = createAuditInspector(services);
  const ai = await createAiFixture(services);
  const authorization = new RunAuthorizationService();
  const tenant = ai.tenants[0]!;
  const model = 'openai/gpt-6-luna';
  const profile: RunProfile = {
    id: 'exhausted-profile',
    version: 1,
    allowedModels: [model],
    defaultModel: model,
    queue: 'ai-interactive',
    priority: 5,
    maxIterations: 3,
    tokenBudget: 4000,
    maxOutputTokens: 100,
    contextBudgets: {},
    capabilities: [],
  };
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const harness = await createAiHarness(
    {
      database: ai.database,
      capacity: ai.capacity,
      capacityConfig: ai.capacityConfig,
      allowlist,
      authorization,
      close: ai.close,
    },
    { profiles: [profile], contexts: [], tools: [] },
    createScriptedModelGateway([]),
  );
  try {
    const run = await asActor(tenant, authorization, (actor) =>
      harness.start(actor, {
        profileId: profile.id,
        prompt: 'Synthetic prompt',
      }),
    );
    const job: JobEnvelope = {
      outboxId: stepJobId(run.runId, 1),
      type: 'run.start.v1',
      ctx: tenant,
      payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
    };
    const before = await audit.count('chat.run_finished.v1');
    expect(await harness.coordinator.finalizeExhausted(job)).toBe('done');
    expect(await audit.count('chat.run_finished.v1')).toBe(before + 1);
    expect(await harness.coordinator.finalizeExhausted(job)).toBe('done');
    expect(await audit.count('chat.run_finished.v1')).toBe(before + 1);
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'failed',
      errorCode: 'AI_INTERNAL',
      runVersion: 2,
      nextSequence: 2,
    });
    const neutralReference = await ai.withTenant(0, (tx) =>
      harness.runs.terminalStreamReference(tx, run.runId),
    );
    expect(neutralReference).toMatchObject({
      runId: run.runId,
      sequence: 1,
      expectedVersion: 1,
      fence: 0,
      neutral: true,
    });
    expect(
      await ai.withTenant(0, (tx) =>
        harness.runs.streamRegistryState(tx, run.runId, tenant.userId),
      ),
    ).toMatchObject({ state: 'terminal' });
    expect(
      await ai.database.withTenant(tenant, (tx) =>
        harness.steps.find(tx, {
          runId: run.runId,
          sequence: 1,
        }),
      ),
    ).toMatchObject({ state: 'failed' });
    expect(await harness.coordinator.finalizeExhausted(job)).toBe('done');
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      runVersion: 2,
    });
    const newer = await asActor(tenant, authorization, (actor) =>
      harness.start(actor, {
        profileId: profile.id,
        prompt: 'Newer sequence',
      }),
    );
    await ai.database.withTenant(tenant, async (tx) => {
      expect(
        await harness.runs.transition(tx, {
          runId: newer.runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'running',
          nextSequence: 2,
        }),
      ).toBe(true);
      await harness.steps.insertInitial(tx, {
        id: randomUUID(),
        runId: newer.runId,
        sequence: 2,
        expectedVersion: 2,
      });
    });
    expect(
      await harness.coordinator.finalizeExhausted({
        ...job,
        outboxId: stepJobId(newer.runId, 1),
        payload: { runId: newer.runId, sequence: 1, expectedVersion: 1 },
      }),
    ).toBe('done');
    expect(await harness.inspect(tenant, newer.runId)).toMatchObject({
      status: 'running',
      runVersion: 2,
    });
    expect(
      await ai.database.withTenant(tenant, (tx) =>
        harness.steps.find(tx, {
          runId: newer.runId,
          sequence: 2,
        }),
      ),
    ).toMatchObject({ state: 'pending' });
  } finally {
    await audit.close();
    await harness.close();
  }
});

test('cancelling an approval-paused run preserves committed output exactly once', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const authorization = new RunAuthorizationService();
  const tenant = ai.tenants[0]!;
  const model = 'openai/gpt-6-luna';
  const profile: RunProfile = {
    id: 'paused-cancel-profile',
    version: 1,
    allowedModels: [model],
    defaultModel: model,
    queue: 'ai-interactive',
    priority: 5,
    maxIterations: 3,
    tokenBudget: 4000,
    maxOutputTokens: 100,
    contextBudgets: {},
    capabilities: [],
  };
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const harness = await createAiHarness(
    {
      database: ai.database,
      capacity: ai.capacity,
      capacityConfig: ai.capacityConfig,
      allowlist,
      authorization,
      close: ai.close,
    },
    { profiles: [profile], contexts: [], tools: [] },
    createScriptedModelGateway([]),
  );
  try {
    const run = await asActor(tenant, authorization, (actor) =>
      harness.start(actor, {
        profileId: profile.id,
        prompt: 'Needs approval',
      }),
    );
    const job: JobEnvelope = {
      outboxId: stepJobId(run.runId, 1),
      type: 'run.start.v1',
      ctx: tenant,
      payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
    };
    const claimed = await harness.dispatch(job);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed')
      throw new Error('Expected an active step claim');
    expect(
      await harness.coordinator.commit(job, claimed.claim, {
        state: 'awaiting_approval',
        text: 'committed before review',
        data: {},
        advancement: 'generation',
      }),
    ).toBe('committed');
    const cancel = new CancelService(
      ai.database,
      harness.runs,
      harness.steps,
      new RunActorFactsRepository(),
      authorization,
    );
    await asActor(tenant, authorization, (actor) =>
      cancel.cancel(actor, run.runId),
    );
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'cancelled',
      partialOutput: 'committed before review',
      finalOutput: null,
    });
    expect(
      await ai.withTenant(0, (tx) =>
        harness.steps.find(tx, {
          runId: run.runId,
          sequence: 1,
        }),
      ),
    ).toMatchObject({
      state: 'awaiting_approval',
      committedText: 'committed before review',
    });
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
  } finally {
    await harness.close();
  }
});

test('cancellation winning immediately before model commit runs cleanup before acknowledging', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const authorization = new RunAuthorizationService();
  const tenant = ai.tenants[0]!;
  const model = 'openai/gpt-6-luna';
  const profile: RunProfile = {
    id: 'cancel-before-commit-profile',
    version: 1,
    allowedModels: [model],
    defaultModel: model,
    queue: 'ai-interactive',
    priority: 5,
    maxIterations: 3,
    tokenBudget: 4000,
    maxOutputTokens: 100,
    contextBudgets: {},
    capabilities: [],
  };
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const gateway: ModelGateway = {
    async *generate() {
      yield {
        type: 'metadata',
        generationId: 'generation-race',
        provider: 'synthetic',
      };
      yield { type: 'text', text: 'race partial' };
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } };
      yield {
        type: 'outcome',
        outcome: {
          finishReason: 'stop',
          attemptOutcome: 'succeeded',
          retryable: false,
          generationId: 'generation-race',
          provider: 'synthetic',
          usage: { inputTokens: 1, outputTokens: 2 },
          costUsd: '0.02',
        },
      };
    },
  };
  const harness = await createAiHarness(
    {
      database: ai.database,
      capacity: ai.capacity,
      capacityConfig: ai.capacityConfig,
      allowlist,
      authorization,
      close: ai.close,
    },
    { profiles: [profile], contexts: [], tools: [] },
    gateway,
  );
  let commitEntered!: () => void;
  let releaseCommit!: () => void;
  const entered = new Promise<void>((resolve) => {
    commitEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const commit = harness.coordinator.commit.bind(harness.coordinator);
  harness.coordinator.commit = async (...args) => {
    if (args[2].advancement === 'generation') {
      commitEntered();
      await gate;
    }
    return commit(...args);
  };
  try {
    const run = await asActor(tenant, authorization, (actor) =>
      harness.start(actor, {
        profileId: profile.id,
        prompt: 'race prompt',
      }),
    );
    const job: JobEnvelope = {
      outboxId: stepJobId(run.runId, 1),
      type: 'run.start.v1',
      ctx: tenant,
      payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
    };
    const execution = harness.execute(job, {
      signal: new AbortController().signal,
    });
    await entered;
    const cancel = new CancelService(
      ai.database,
      harness.runs,
      harness.steps,
      new RunActorFactsRepository(),
      authorization,
    );
    await asActor(tenant, authorization, (actor) =>
      cancel.cancel(actor, run.runId),
    );
    releaseCommit();
    await execution;
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'cancelled',
      partialOutput: 'race partial',
      finalOutput: null,
    });
    expect(
      await ai.withTenant(0, (tx) =>
        new AiAttemptRepository().list(tx, run.runId),
      ),
    ).toMatchObject([
      {
        outcome: 'succeeded',
        reportedInputTokens: 1,
        reportedOutputTokens: 2,
        costUsd: '0.02',
      },
    ]);
    expect(await ai.receiptCount(job.outboxId)).toBe(1);
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
    expect(await ai.orgSlotCount(0)).toBe(0);
  } finally {
    releaseCommit();
    await harness.close();
  }
});

test('queue shutdown aborts a handler and waits for bounded cancellation poll cleanup', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const proxy = await FaultProxy.start(services.appUrl);
  const database = new TenantDatabase({
    appUrl: proxy.url,
    poolMax: 1,
    statementTimeoutMs: 5000,
  });
  const options = {
    url: services.valkey.queueUrl,
    limiterUrl: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:cancel-shutdown`,
  };
  const signals = new CancelSignals({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    database,
    runs: new AiRunRepository(),
  });
  const producer = new QueueProducer(options);
  const consumer = new QueueConsumer(options, new JobExecutor(database), {
    lockDuration: 5000,
    stalledInterval: 5000,
    interactiveConcurrency: 1,
    batchConcurrency: 1,
    stepLeaseMs: 5000,
    busyRetryMs: 100,
  });
  const registry = new JobRegistry();
  const tenant = ai.tenants[0]!;
  const runId = randomUUID();
  let resolveSubscribed!: () => void;
  const subscribed = new Promise<void>((resolve) => {
    resolveSubscribed = resolve;
  });
  registry.register('run.start.v1', {
    strategy: 'durable-step',
    handle: async (job, { signal }) => {
      if (!('runId' in job.payload) || !job.ctx.userId) return { kind: 'done' };
      const context = { orgId: job.ctx.orgId, userId: job.ctx.userId };
      const unbind = signals.bind(job.payload.runId, context);
      const unsubscribe = await signals.subscribe(
        job.payload.runId,
        () => undefined,
      );
      resolveSubscribed();
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      await unsubscribe();
      unbind();
      return { kind: 'done' };
    },
  });
  let closeTask: Promise<void> | undefined;
  let pid!: number;
  try {
    pid = await database.withTenant(tenant, (tx) => aiTestBackendPid(tx));
    await consumer.start(registry);
    await producer.enqueue(
      {
        outboxId: randomUUID(),
        type: 'run.start.v1',
        ctx: tenant,
        payload: { runId, sequence: 1, expectedVersion: 1 },
      },
      { queue: 'ai-interactive', priority: 5, timeoutMs: 2000 },
    );
    await subscribed;
    proxy.hang();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    closeTask = consumer.close();
    const closed = await Promise.race([
      closeTask.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
    expect(closed).toBe(true);
    expect(Date.now() - started).toBeLessThan(2500);
    proxy.restore();
    expect(await ai.waitForBackendExit(pid)).toBe(true);
  } finally {
    proxy.restore();
    if (closeTask) await closeTask;
    else await consumer.close();
    await signals.close();
    await producer.close();
    await database.close();
    await proxy.close();
    await ai.close();
  }
});

test('queued cancellation writes its terminal marker from the pending lineage', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: (claim: StepClaim) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamActiveProof(tx, claim),
        ),
      authorizeTerminal: (claim: TerminalStreamReference) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamTerminalProof(tx, claim),
        ),
      reconcile: async () => [],
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const reference = await ai.withTenant(0, async (tx) => {
      const queued = await runs.find(tx, run.id);
      await runs.transition(tx, {
        runId: run.id,
        expectedVersion: queued!.runVersion,
        from: 'queued',
        to: 'cancelling',
      });
      await runs.transition(tx, {
        runId: run.id,
        expectedVersion: queued!.runVersion + 1,
        from: 'cancelling',
        to: 'cancelled',
      });
      return runs.terminalStreamReference(tx, run.id);
    });
    if (!reference) throw new Error('Terminal cancellation reference missing');
    expect(
      await ai.withTenant(0, (tx) => steps.streamTerminalProof(tx, reference)),
    ).toMatchObject({
      status: 'cancelled',
      latestCommittedStepId: reference.stepId,
      latestCommittedFence: 0,
      nextSequence: 1,
    });
    await streams.finish(reference, {
      version: 1,
      runId: run.id,
      type: 'finish',
    });
    expect(
      await redis.xlen(
        `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      ),
    ).toBe(1);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('queued cancellation can finish the stream from its real pending step', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const runs = new AiRunRepository();
    const reference = await ai.withTenant(0, async (tx) => {
      const queued = await runs.find(tx, run.id);
      expect(queued?.status).toBe('queued');
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: queued!.runVersion,
          from: 'queued',
          to: 'cancelling',
        }),
      ).toBe(true);
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: queued!.runVersion + 1,
          from: 'cancelling',
          to: 'cancelled',
        }),
      ).toBe(true);
      return runs.terminalStreamReference(tx, run.id);
    });

    expect(reference).toMatchObject({
      runId: run.id,
      sequence: 1,
      expectedVersion: 1,
      fence: 0,
    });
  } finally {
    await ai.close();
  }
});
