import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiAttemptRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
} from '../../src/infrastructure/db/index.js';
import {
  createScriptedModelGateway,
  ModelAllowlistSchema,
} from '../../src/infrastructure/ai/index.js';
import type { ModelGateway } from '../../src/infrastructure/ai/index.js';
import type { RunStreams } from '../../src/infrastructure/queue/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import {
  RunRegistry,
  type RunProfile,
  StepCoordinator,
  StepExecutor,
} from '../../src/modules/chat/index.js';
import { RunService } from '../../src/modules/chat/run.service.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { AttemptService } from '../../src/modules/usage/index.js';

const model = 'openai/gpt-6-luna';
const profile: RunProfile = {
  id: 'executor-test-profile',
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

function actorScope(
  tenant: { orgId: string; userId: string },
  auth: RunAuthorizationService,
  work: (actor: RunActor) => Promise<unknown>,
) {
  const request = {};
  const identities = new RequestIdentity();
  identities.prepare(
    request,
    {
      identity: {
        userId: tenant.userId,
        sessionId: randomUUID(),
        activeOrganizationId: tenant.orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      tenant: { orgId: tenant.orgId, userId: tenant.userId, role: 'owner' },
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
    auth.withActor(currentVerifiedIdentity(), work),
  );
}

async function setup(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  scripts: Parameters<typeof createScriptedModelGateway>[0],
  options: {
    leaseMs?: number;
    gateway?: ModelGateway;
    streams?: RunStreams;
  } = {},
) {
  const authorization = new RunAuthorizationService();
  const registry = new RunRegistry();
  registry.register({ profiles: [profile], contexts: [], tools: [] });
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const outbox = new OutboxRepository();
  const runService = new RunService(
    ai.database,
    runs,
    steps,
    outbox,
    new RunActorFactsRepository(),
    authorization,
    registry,
    ai.capacity,
    ai.capacityConfig,
    allowlist,
  );
  const attempts = new AttemptService();
  const coordinator = new StepCoordinator(
    ai.database,
    runs,
    steps,
    attempts,
    outbox,
    new JobExecutor(ai.database),
    options.leaseMs,
  );
  const stepExecutor = new StepExecutor({
    database: ai.database,
    runs,
    steps,
    facts: new RunActorFactsRepository(),
    authorization,
    coordinator,
    attempts,
    registry,
    gateway: options.gateway ?? createScriptedModelGateway(scripts),
    ...(options.streams ? { streams: options.streams } : {}),
  });
  const tenant = ai.tenants[0]!;
  const created = (await actorScope(tenant, authorization, (actor) =>
    runService.start(actor, {
      profileId: profile.id,
      prompt: 'Synthetic prompt',
    }),
  )) as { runId: string };
  return {
    tenant,
    runId: created.runId,
    runs,
    steps,
    outbox,
    coordinator,
    executor: stepExecutor,
    attempts: new AiAttemptRepository(),
    attemptService: attempts,
  };
}

function job(
  runId: string,
  tenant: { orgId: string; userId: string },
  sequence: number,
  expectedVersion: number,
  type: 'run.start.v1' | 'run.advance.v1',
) {
  return {
    outboxId: stepJobId(runId, sequence),
    type,
    ctx: tenant,
    payload: { runId, sequence, expectedVersion },
  } as const;
}

const usage = { inputTokens: 20, outputTokens: 3 };
const success = {
  type: 'outcome' as const,
  outcome: {
    finishReason: 'stop' as const,
    attemptOutcome: 'succeeded' as const,
    retryable: false,
    generationId: 'synthetic-generation',
    provider: 'openai',
    usage,
  },
};

test('one generation persists metadata, checkpoint, usage, output and terminal state', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      {
        events: [
          {
            type: 'metadata',
            generationId: 'synthetic-generation',
            provider: 'openai',
          },
          { type: 'text', text: 'Completed answer' },
          { type: 'usage', usage },
          success,
        ],
      },
    ]);
    expect(
      await h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: 'done' });
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(run).toMatchObject({
      status: 'completed',
      partialOutput: 'Completed answer',
      finalOutput: 'Completed answer',
      modelIterations: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'succeeded',
      generationId: 'synthetic-generation',
      provider: 'openai',
      reportedInputTokens: 20,
      reportedOutputTokens: 3,
    });
  } finally {
    await ai.close();
  }
});

test('metadata persistence failure escapes without becoming a provider outcome', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      {
        events: [
          { type: 'metadata', generationId: 'synthetic-generation' },
          success,
        ],
      },
    ]);
    const persistenceError = new Error('metadata database unavailable');
    h.attemptService.metadata = async () => {
      throw persistenceError;
    };
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(persistenceError);
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(run?.status).toBe('running');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.active).toBe(true);
  } finally {
    await ai.close();
  }
});

test('renews the PostgreSQL claim during a generation longer than its lease', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const gateway: ModelGateway = {
      async *generate() {
        await new Promise((resolve) => setTimeout(resolve, 350));
        yield { type: 'text', text: 'Slow answer' };
        yield success;
      },
    };
    const h = await setup(ai, [], { leaseMs: 90, gateway });
    const renew = vi.spyOn(h.coordinator, 'renew');
    await h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
      signal: new AbortController().signal,
    });
    expect(
      await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId)),
    ).toMatchObject({
      status: 'completed',
      finalOutput: 'Slow answer',
    });
    expect(renew).toHaveBeenCalled();
  } finally {
    await ai.close();
  }
});

test('flushes dirty provisional text on the checkpoint interval while generation is paused', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    let release!: () => void;
    let emitted!: () => void;
    const textEmitted = new Promise<void>((resolve) => (emitted = resolve));
    const continueGeneration = new Promise<void>(
      (resolve) => (release = resolve),
    );
    const gateway: ModelGateway = {
      generate() {
        return (async function* () {
          yield { type: 'text', text: 'dirty provisional text' };
          emitted();
          await continueGeneration;
          yield success;
        })();
      },
    };
    const h = await setup(ai, [], { gateway });
    const checkpoint = vi.spyOn(h.steps, 'checkpoint');
    const running = h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      { signal: new AbortController().signal },
    );
    await textEmitted;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(checkpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ text: 'dirty provisional text' }),
    );
    release();
    await running;
  } finally {
    await ai.close();
  }
});

test('confirmed claim renewal loss aborts generation and preserves the reservation', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const gateway: ModelGateway = {
      generate(input) {
        return (async function* () {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 400);
            input.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(input.signal.reason);
              },
              { once: true },
            );
          });
          yield success;
        })();
      },
    };
    const h = await setup(ai, [], { leaseMs: 90, gateway });
    vi.spyOn(h.coordinator, 'renew').mockResolvedValue(false);
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('AI step claim lost');
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ active: true, outcome: null });
  } finally {
    await ai.close();
  }
});

test('stream ownership loss escapes without becoming a provider outcome', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const streams = {
      recover: async () => undefined,
      publish: async () => 'stale' as const,
    } as unknown as RunStreams;
    const h = await setup(
      ai,
      [{ events: [{ type: 'text', text: 'provisional' }, success] }],
      { streams },
    );
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('AI step claim lost');
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(rows[0]).toMatchObject({ active: true, outcome: null });
  } finally {
    await ai.close();
  }
});

test('checkpoint ownership loss escapes and leaves no stale completion', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      { events: [{ type: 'text', text: 'x'.repeat(8192) }, success] },
    ]);
    vi.spyOn(h.steps, 'checkpoint').mockResolvedValue(false);
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('AI step claim lost');
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(run?.status).toBe('running');
    expect(rows[0]).toMatchObject({ active: true, outcome: null });
  } finally {
    await ai.close();
  }
});

test('a genuine gateway iteration error becomes a safe provider outcome', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const gateway: ModelGateway = {
      generate() {
        return (async function* () {
          throw new Error('raw provider payload');
          yield success;
        })();
      },
    };
    const h = await setup(ai, [], { gateway });
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: 'done' });
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(rows[0]).toMatchObject({ active: false, outcome: 'unknown' });
  } finally {
    await ai.close();
  }
});

test('retries only the second allowed physical attempt and commits its output', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      {
        events: [
          { type: 'text', text: 'discarded provisional text' },
          {
            type: 'outcome',
            outcome: {
              finishReason: 'error',
              attemptOutcome: 'failed',
              retryable: true,
              safeCode: 'AI_PROVIDER_UNAVAILABLE',
            },
          },
        ],
      },
      { events: [{ type: 'text', text: 'committed answer' }, success] },
    ]);
    await h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
      signal: new AbortController().signal,
    });
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.outcome)).toEqual(['failed', 'succeeded']);
    expect(run).toMatchObject({
      status: 'completed',
      finalOutput: 'committed answer',
    });
  } finally {
    await ai.close();
  }
});

test('two retryable failures never start a third physical attempt', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    let calls = 0;
    const scripted = createScriptedModelGateway([
      {
        events: [
          {
            type: 'outcome',
            outcome: {
              finishReason: 'error',
              attemptOutcome: 'failed',
              retryable: true,
              safeCode: 'AI_PROVIDER_UNAVAILABLE',
            },
          },
        ],
      },
      {
        events: [
          {
            type: 'outcome',
            outcome: {
              finishReason: 'error',
              attemptOutcome: 'failed',
              retryable: true,
              safeCode: 'AI_PROVIDER_UNAVAILABLE',
            },
          },
        ],
      },
    ]);
    const gateway: ModelGateway = {
      generate(input) {
        calls++;
        return scripted.generate(input);
      },
    };
    const h = await setup(ai, [], { gateway });
    await h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
      signal: new AbortController().signal,
    });
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(calls).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ordinal)).toEqual([1, 2]);
  } finally {
    await ai.close();
  }
});

test('terminal job redelivery performs no third generation or event publication', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    let generations = 0;
    const gateway: ModelGateway = {
      generate() {
        generations++;
        return createScriptedModelGateway([{ events: [success] }]).generate({
          model,
          provider: 'openai',
          messages: [],
          maxOutputTokens: 100,
          signal: new AbortController().signal,
        });
      },
    };
    const streams = {
      recover: vi.fn(async () => undefined),
      publish: vi.fn(async () => 'written' as const),
      finish: vi.fn(async () => undefined),
    } as unknown as RunStreams;
    const h = await setup(ai, [], { gateway, streams });
    const runJob = job(h.runId, h.tenant, 1, 1, 'run.start.v1');
    await h.executor.execute(runJob, { signal: new AbortController().signal });
    await h.executor.execute(runJob, { signal: new AbortController().signal });
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(generations).toBe(1);
    expect(rows).toHaveLength(1);
    expect(streams.recover).toHaveBeenCalledTimes(1);
    expect(streams.finish).toHaveBeenCalledTimes(1);
    expect(streams.publish).not.toHaveBeenCalled();
  } finally {
    await ai.close();
  }
});

test('model generation starts only after the tenant SQL transaction closes', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const original = ai.database.withTenant.bind(ai.database);
    let openTenantTransactions = 0;
    ai.database.withTenant = async <T>(
      context: Parameters<typeof ai.database.withTenant<T>>[0],
      work: Parameters<typeof ai.database.withTenant<T>>[1],
    ): Promise<T> =>
      original(context, async (tx) => {
        openTenantTransactions++;
        try {
          return await work(tx);
        } finally {
          openTenantTransactions--;
        }
      });
    const gateway: ModelGateway = {
      generate() {
        expect(openTenantTransactions).toBe(0);
        return createScriptedModelGateway([{ events: [success] }]).generate({
          model,
          provider: 'openai',
          messages: [],
          maxOutputTokens: 100,
          signal: new AbortController().signal,
        });
      },
    };
    const h = await setup(ai, [], { gateway });
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: 'done' });
    expect(openTenantTransactions).toBe(0);
  } finally {
    await ai.close();
  }
});

test('Valkey stream unavailability does not stop durable completion', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const streams = {
      recover: async () => undefined,
      publish: async () => 'unavailable' as const,
      finish: async () => undefined,
    } as unknown as RunStreams;
    const h = await setup(
      ai,
      [{ events: [{ type: 'text', text: 'durable answer' }, success] }],
      { streams },
    );
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: 'done' });
    expect(
      await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId)),
    ).toMatchObject({
      status: 'completed',
      finalOutput: 'durable answer',
    });
  } finally {
    await ai.close();
  }
});

test('iteration exhaustion fails after preserving partial output', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      {
        events: [
          { type: 'text', text: 'one' },
          {
            ...success,
            outcome: { ...success.outcome, finishReason: 'length' },
          },
        ],
      },
      {
        events: [
          { type: 'text', text: ' two' },
          {
            ...success,
            outcome: { ...success.outcome, finishReason: 'length' },
          },
        ],
      },
      {
        events: [
          { type: 'text', text: ' three' },
          {
            ...success,
            outcome: { ...success.outcome, finishReason: 'length' },
          },
        ],
      },
    ]);
    for (let sequence = 1; sequence <= 3; sequence++) {
      await h.executor.execute(
        job(
          h.runId,
          h.tenant,
          sequence,
          sequence,
          sequence === 1 ? 'run.start.v1' : 'run.advance.v1',
        ),
        { signal: new AbortController().signal },
      );
    }
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'AI_ITERATION_LIMIT',
      partialOutput: 'one two three',
    });
  } finally {
    await ai.close();
  }
});

test('successful output and next outbox roll back together on receipt failure', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      {
        events: [
          { type: 'text', text: 'must remain provisional' },
          {
            ...success,
            outcome: { ...success.outcome, finishReason: 'length' },
          },
        ],
      },
    ]);
    const append = vi
      .spyOn(h.outbox, 'append')
      .mockRejectedValue(new Error('outbox insert failed'));
    await expect(
      h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('outbox insert failed');
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(append).toHaveBeenCalledOnce();
    expect(run).toMatchObject({ status: 'running', partialOutput: '' });
    expect(rows[0]).toMatchObject({ active: true, outcome: null });
  } finally {
    await ai.close();
  }
});

test('retry reservation failure keeps the first attempt partial output and stops calls', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    let calls = 0;
    const gateway: ModelGateway = {
      generate() {
        calls++;
        return createScriptedModelGateway([
          {
            events: [
              { type: 'text', text: 'known partial answer' },
              { type: 'usage', usage: { inputTokens: 3000, outputTokens: 3 } },
              {
                type: 'outcome',
                outcome: {
                  finishReason: 'error',
                  attemptOutcome: 'failed',
                  retryable: true,
                  usage: { inputTokens: 3000, outputTokens: 3 },
                  safeCode: 'AI_PROVIDER_UNAVAILABLE',
                },
              },
            ],
          },
        ]).generate({
          model,
          provider: 'openai',
          messages: [],
          maxOutputTokens: 100,
          signal: new AbortController().signal,
        });
      },
    };
    const h = await setup(ai, [], { gateway });
    await h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
      signal: new AbortController().signal,
    });
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    expect(calls).toBe(1);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'AI_BUDGET_EXCEEDED',
      partialOutput: 'known partial answer',
    });
  } finally {
    await ai.close();
  }
});

test('length continuation uses the same profile route and commits each generation once', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(ai, [
      {
        events: [
          { type: 'text', text: 'Part one' },
          { type: 'usage', usage },
          {
            ...success,
            outcome: { ...success.outcome, finishReason: 'length' },
          },
        ],
      },
      {
        events: [
          { type: 'text', text: ' part two' },
          { type: 'usage', usage },
          success,
        ],
      },
    ]);
    await h.executor.execute(job(h.runId, h.tenant, 1, 1, 'run.start.v1'), {
      signal: new AbortController().signal,
    });
    const next = await ai.outboxForRunSequence(0, h.runId, 2);
    expect(next).toMatchObject({
      type: 'run.advance.v1',
      queue_name: profile.queue,
      priority: profile.priority,
      payload: { sequence: 2, expectedVersion: 2 },
    });
    await h.executor.execute(job(h.runId, h.tenant, 2, 2, 'run.advance.v1'), {
      signal: new AbortController().signal,
    });
    const run = await ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
    const rows = await ai.withTenant(0, (tx) => h.attempts.list(tx, h.runId));
    expect(run).toMatchObject({
      status: 'completed',
      partialOutput: 'Part one part two',
      finalOutput: 'Part one part two',
      modelIterations: 2,
    });
    expect(rows).toHaveLength(2);
  } finally {
    await ai.close();
  }
});
