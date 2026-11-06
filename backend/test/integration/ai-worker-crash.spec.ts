import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiAttemptRepository,
  AiRunRepository,
  RunActorFactsRepository,
  AiStepRepository,
  type JobEnvelope,
} from '../../src/infrastructure/db/index.js';
import {
  ModelAllowlistSchema,
  createScriptedModelGateway,
} from '../../src/infrastructure/ai/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { createAiHarness } from '../setup/ai-harness.js';
import type { RunProfile } from '../../src/modules/chat/run-contracts.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { CancelService } from '../../src/modules/chat/cancel.service.js';
import { QueueProducer } from '../../src/infrastructure/queue/index.js';
import { spawnAiWorker } from '../process/ai-worker-harness.js';

const modelId = 'openai/gpt-6-luna';
const profile: RunProfile = {
  id: 'process-crash-profile',
  version: 1,
  allowedModels: [modelId],
  defaultModel: modelId,
  queue: 'ai-interactive',
  priority: 5,
  maxIterations: 3,
  tokenBudget: 4000,
  maxOutputTokens: 100,
  contextBudgets: {},
  capabilities: [],
};

async function asActor<T>(
  tenant: { orgId: string; userId: string },
  authorization: RunAuthorizationService,
  work: (
    actor: import('../../src/modules/identity-access/index.js').RunActor,
  ) => Promise<T>,
): Promise<T> {
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

test('SIGKILL before final receipt recovers unknown attempt under a new fence', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const tenant = ai.tenants[0]!;
  const authorization = new RunAuthorizationService();
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
  const run = await asActor(tenant, authorization, (actor) =>
    harness.start(actor, { profileId: profile.id, prompt: 'Synthetic prompt' }),
  );
  const job: JobEnvelope = {
    outboxId: stepJobId(run.runId, 1),
    type: 'run.start.v1',
    ctx: tenant,
    payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
  };
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  });
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  let crashed: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  let replacement: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  try {
    crashed = await spawnAiWorker({
      services,
      tenant,
      profile,
      pause: 'after-model-response',
      resultText: 'uncommitted model output',
      generationId: 'generation-before-kill',
    });
    await producer.enqueue(job);
    await crashed.checkpoint('model-responded-before-persistence');
    await expect
      .poll(async () =>
        ai.withTenant(0, async (tx) =>
          new AiAttemptRepository().list(tx, run.runId),
        ),
      )
      .toHaveLength(1);
    await crashed.kill();
    replacement = await spawnAiWorker({
      services,
      tenant,
      profile,
      resultText: 'recovered answer',
      generationId: 'generation-after-recovery',
    });
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
        timeout: 20_000,
      })
      .toBe('completed');
    const terminal = await harness.inspect(tenant, run.runId);
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, run.runId),
    );
    expect(attempts.map((attempt) => attempt.outcome)).toEqual([
      'unknown',
      'succeeded',
    ]);
    expect(attempts.map((attempt) => attempt.generationId)).toEqual([
      'generation-before-kill',
      'generation-after-recovery',
    ]);
    expect(terminal).toMatchObject({
      status: 'completed',
      partialOutput: 'recovered answer',
      finalOutput: 'recovered answer',
    });
    const step = await ai.withTenant(0, (tx) =>
      new AiStepRepository().find(tx, { runId: run.runId, sequence: 1 }),
    );
    expect(step?.committedText).toBe('recovered answer');
    expect(
      attempts.filter((attempt) => attempt.outcome === 'succeeded'),
    ).toHaveLength(1);
  } finally {
    await crashed?.close();
    await replacement?.close();
    await producer.close();
    await queue.close();
    await ai.close();
  }
});

test('SIGKILL after cancellation persists recovers the exact old fence and finalizes partial output', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const tenant = ai.tenants[0]!;
  const authorization = new RunAuthorizationService();
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
  const run = await asActor(tenant, authorization, (actor) =>
    harness.start(actor, {
      profileId: profile.id,
      prompt: 'Cancel before crash',
    }),
  );
  const job: JobEnvelope = {
    outboxId: stepJobId(run.runId, 1),
    type: 'run.start.v1',
    ctx: tenant,
    payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
  };
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  });
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  let crashed: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  let replacement: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  let signalEntered!: () => void;
  let releaseSignal!: () => void;
  const signalStarted = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const signalGate = new Promise<void>((resolve) => {
    releaseSignal = resolve;
  });
  try {
    crashed = await spawnAiWorker({
      services,
      tenant,
      profile,
      pause: 'after-model-response',
      resultText: 'partial before cancellation',
      generationId: 'generation-cancel-crash',
    });
    await producer.enqueue(job);
    await crashed.checkpoint('model-responded-before-persistence');
    await expect
      .poll(async () =>
        ai.withTenant(
          0,
          async (tx) =>
            (await new AiRunRepository().latestCheckpointText(tx, run.runId, 1))
              .length,
        ),
      )
      .toBeGreaterThan(0);
    const cancel = new CancelService(
      ai.database,
      harness.runs,
      harness.steps,
      new RunActorFactsRepository(),
      authorization,
      undefined,
      {
        publish: async () => {
          signalEntered();
          await signalGate;
        },
      },
    );
    const cancellation = asActor(tenant, authorization, (actor) =>
      cancel.cancel(actor, run.runId),
    );
    await signalStarted;
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'cancelling',
    });
    await crashed.kill();
    releaseSignal();
    await cancellation;
    replacement = await spawnAiWorker({
      services,
      tenant,
      profile,
      resultText: 'must not generate',
      generationId: 'must-not-generate',
    });
    await expect
      .poll(async () => (await harness.inspect(tenant, run.runId))?.status, {
        timeout: 20_000,
      })
      .toBe('cancelled');
    const terminal = await harness.inspect(tenant, run.runId);
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, run.runId),
    );
    expect(terminal?.partialOutput).toBe('partial before cancellation');
    expect(attempts).toMatchObject([
      {
        generationId: 'generation-cancel-crash',
        outcome: 'unknown',
        active: false,
      },
    ]);
    expect(await ai.orgSlotCount(0)).toBe(0);
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState())
      .toBe('completed');
  } finally {
    releaseSignal?.();
    if (crashed) await crashed.close();
    if (replacement) await replacement.close();
    await producer.close();
    await queue.close();
    await harness.close();
  }
});

test('SIGKILL after final receipt commit acknowledges without another generation', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const tenant = ai.tenants[0]!;
  const authorization = new RunAuthorizationService();
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
  const run = await asActor(tenant, authorization, (actor) =>
    harness.start(actor, { profileId: profile.id, prompt: 'Synthetic prompt' }),
  );
  const job: JobEnvelope = {
    outboxId: stepJobId(run.runId, 1),
    type: 'run.start.v1',
    ctx: tenant,
    payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
  };
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  });
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  let crashed: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  let replacement: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  try {
    crashed = await spawnAiWorker({
      services,
      tenant,
      profile,
      pause: 'after-final-commit-before-ack',
      resultText: 'committed answer',
      generationId: 'generation-committed',
    });
    await producer.enqueue(job);
    await crashed.checkpoint('final-commit-before-ack');
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'completed',
      finalOutput: 'committed answer',
    });
    expect(
      await ai.withTenant(0, (tx) =>
        new AiAttemptRepository().list(tx, run.runId),
      ),
    ).toHaveLength(1);
    await crashed.kill();
    replacement = await spawnAiWorker({
      services,
      tenant,
      profile,
      resultText: 'must not run',
      generationId: 'generation-must-not-run',
    });
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
        timeout: 20_000,
      })
      .toBe('completed');
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, run.runId),
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      outcome: 'succeeded',
      generationId: 'generation-committed',
    });
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      partialOutput: 'committed answer',
      finalOutput: 'committed answer',
    });
  } finally {
    await crashed?.close();
    await replacement?.close();
    await producer.close();
    await queue.close();
    await ai.close();
  }
});

test('paused old worker cannot write after replacement commits a new fence', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const tenant = ai.tenants[0]!;
  const authorization = new RunAuthorizationService();
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
  const run = await asActor(tenant, authorization, (actor) =>
    harness.start(actor, { profileId: profile.id, prompt: 'Synthetic prompt' }),
  );
  const job: JobEnvelope = {
    outboxId: stepJobId(run.runId, 1),
    type: 'run.start.v1',
    ctx: tenant,
    payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
  };
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  });
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  const redis = new Redis(services.valkey.streamsUrl);
  let old: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  let replacement: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  try {
    old = await spawnAiWorker({
      services,
      tenant,
      profile,
      pause: 'after-model-response',
      resultText: 'old worker output',
      generationId: 'old-generation',
    });
    await producer.enqueue(job);
    await old.checkpoint('model-responded-before-persistence');
    old.stop();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    replacement = await spawnAiWorker({
      services,
      tenant,
      profile,
      resultText: 'replacement output',
      generationId: 'replacement-generation',
    });
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
        timeout: 20_000,
      })
      .toBe('completed');
    const streamKey = `${services.queuePrefix}:{run-streams}:${run.runId}:events`;
    const beforeRelease = await redis.xlen(streamKey);
    expect(beforeRelease).toBeGreaterThan(0);
    old.release();
    old.resume();
    await old.checkpoint('model-pause-released', 5000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await redis.xlen(streamKey)).toBe(beforeRelease);
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'completed',
      partialOutput: 'replacement output',
      finalOutput: 'replacement output',
    });
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, run.runId),
    );
    expect(attempts.map((attempt) => attempt.outcome)).toEqual([
      'unknown',
      'succeeded',
    ]);
  } finally {
    await old?.close();
    await replacement?.close();
    redis.disconnect();
    await producer.close();
    await queue.close();
    await ai.close();
  }
});

test('worker shutdown aborts active generation and closes within a bounded interval', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const tenant = ai.tenants[0]!;
  const authorization = new RunAuthorizationService();
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
  const run = await asActor(tenant, authorization, (actor) =>
    harness.start(actor, { profileId: profile.id, prompt: 'Synthetic prompt' }),
  );
  const job: JobEnvelope = {
    outboxId: stepJobId(run.runId, 1),
    type: 'run.start.v1',
    ctx: tenant,
    payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
  };
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  });
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  let shuttingDown: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  let replacement: Awaited<ReturnType<typeof spawnAiWorker>> | undefined;
  try {
    shuttingDown = await spawnAiWorker({
      services,
      tenant,
      profile,
      pause: 'after-model-response',
      resultText: 'shutdown partial',
      generationId: 'shutdown-generation',
    });
    await producer.enqueue(job);
    await shuttingDown.checkpoint('model-responded-before-persistence');
    const startedAt = Date.now();
    await shuttingDown.terminate();
    expect(Date.now() - startedAt).toBeLessThan(5000);
    await shuttingDown.checkpoint('shutdown-complete');

    replacement = await spawnAiWorker({
      services,
      tenant,
      profile,
      resultText: 'after shutdown',
      generationId: 'after-shutdown-generation',
    });
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
        timeout: 20_000,
      })
      .toBe('completed');
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, run.runId),
    );
    expect(attempts.map((attempt) => attempt.outcome)).toEqual([
      'unknown',
      'succeeded',
    ]);
    expect(await harness.inspect(tenant, run.runId)).toMatchObject({
      status: 'completed',
      finalOutput: 'after shutdown',
    });
  } finally {
    await shuttingDown?.close();
    await replacement?.close();
    await producer.close();
    await queue.close();
    await ai.close();
  }
});
