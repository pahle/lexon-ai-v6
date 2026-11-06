import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiCapacityRepository,
  OutboxRepository,
  TenantDatabase,
  DispatcherSession,
} from '../../src/infrastructure/db/index.js';
import {
  ModelAllowlistSchema,
  createScriptedModelGateway,
} from '../../src/infrastructure/ai/index.js';
import {
  QueueConsumer,
  QueueProducer,
} from '../../src/infrastructure/queue/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import { JobExecutor, JobRegistry, OutboxDispatcher } from '../../src/modules/platform/index.js';
import { createAiHarness, measureHop } from '../setup/ai-harness.js';
import type { RunProfile } from '../../src/modules/chat/run-contracts.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';

const model = 'openai/gpt-6-luna';
const profile: RunProfile = {
  id: 'hop-test-profile', version: 1, allowedModels: [model], defaultModel: model,
  queue: 'ai-interactive', priority: 5, maxIterations: 2,
  tokenBudget: 4000, maxOutputTokens: 100, contextBudgets: {}, capabilities: [],
};

function actorScope<T>(
  tenant: { orgId: string; userId: string },
  auth: RunAuthorizationService,
  work: (actor: RunActor) => Promise<T>,
) {
  const request = {};
  const identities = new RequestIdentity();
  identities.prepare(request, {
    identity: {
      userId: tenant.userId, sessionId: randomUUID(), activeOrganizationId: tenant.orgId,
      channel: 'cookie', platformAdmin: false, mfaVerifiedAt: null, reauthenticatedAt: null,
    },
    tenant: { orgId: tenant.orgId, userId: tenant.userId, role: 'owner' },
    summary: {
      version: 1,
      user: { version: 1, id: tenant.userId, name: 'Fixture', email: 'fixture@example.test', emailVerified: true, twoFactorEnabled: false, onboardingCompleted: true },
      organization: { version: 1, id: tenant.orgId, name: 'Fixture', slug: 'Fixture', kind: 'personal', state: 'active', require2fa: false, role: 'owner', createdAt: new Date().toISOString() },
      platformAdmin: false,
    },
  }, new Headers());
  return identities.run(request, () => auth.withActor(currentVerifiedIdentity(), work));
}

test('measureHop records commit-ready to durable run claim across actual dispatcher and worker', async ({ services }) => {
  const ai = await createAiFixture(services);
  const tenant = ai.tenants[0]!;
  const database = ai.database as TenantDatabase;
  const authorization = new RunAuthorizationService();
  const allowlist = ModelAllowlistSchema.parse(JSON.parse(readFileSync(new URL('../../config/model-allowlist.json', import.meta.url), 'utf8')));
  const claimAt = new Map<string, number>();
  const readyAt = new Map<string, number>();
  const waiters = new Map<string, (at: number) => void>();
  const scripts = Array.from({ length: 21 }, () => ({ events: [
    { type: 'text' as const, text: 'ok' },
    { type: 'usage' as const, usage: { inputTokens: 20, outputTokens: 1 } },
    { type: 'outcome' as const, outcome: { finishReason: 'stop' as const, attemptOutcome: 'succeeded' as const, retryable: false, usage: { inputTokens: 20, outputTokens: 1 } } },
  ] }));
  const harness = await createAiHarness({
    database, capacity: ai.capacity as AiCapacityRepository, capacityConfig: ai.capacityConfig,
    allowlist, authorization, close: async () => undefined,
  }, { profiles: [profile], contexts: [], tools: [] }, createScriptedModelGateway(scripts), {
    onStepClaim(outboxId, at) {
      claimAt.set(outboxId, at);
      const ready = readyAt.get(outboxId);
      if (ready !== undefined) waiters.get(outboxId)?.(at);
    },
  });
  const prefix = `${services.queuePrefix}:run-hop`;
  const producer = new QueueProducer({ url: services.valkey.queueUrl, prefix });
  const consumer = new QueueConsumer({ url: services.valkey.queueUrl, limiterUrl: services.valkey.limiterUrl, prefix }, new JobExecutor(database));
  const registry = new JobRegistry();
  for (const type of ['run.start.v1', 'run.advance.v1', 'run.resume.v1'])
    registry.register(type, { strategy: 'durable-step', handle: (job, context) => harness.execute(job, context) });
  const dispatcher = new OutboxDispatcher(
    new OutboxRepository(database), new DispatcherSession(services.appUrl), producer,
    { pollMs: 1000, retryBaseMs: 100, retryCapMs: 1000, batchSize: 50, leaseMs: 30_000, enqueueTimeoutMs: 2000 },
  );
  const abort = new AbortController();
  let dispatcherTask: Promise<void> | undefined;
  try {
    await consumer.start(registry);
    dispatcherTask = dispatcher.start(abort.signal);
    const result = await measureHop({
      async run(count) {
        const samples: number[] = [];
        for (let index = 0; index < count + 1; index++) {
          const run = await actorScope(tenant, authorization, (actor) => harness.start(actor, { profileId: profile.id, prompt: `Synthetic hop ${index}` }));
          const outboxId = stepJobId(run.runId, 1);
          const ready = performance.now();
          readyAt.set(outboxId, ready);
          const seen = claimAt.get(outboxId);
          if (seen !== undefined) samples.push(seen - ready);
          else samples.push(await new Promise<number>((resolve) => {
            waiters.set(outboxId, (at) => resolve(at - ready));
          }));
        }
        return samples;
      },
    }, { samples: 20 });
    console.log(JSON.stringify({
      event: 'f3_run_step_hop_latency',
      environment: { node: process.version, platform: process.platform, arch: process.arch, valkeyPrefix: prefix, pollFallbackMs: 1000, path: 'RunService outbox commit -> OutboxDispatcher -> BullMQ QueueConsumer -> StepCoordinator.claim (model time excluded)' },
      ...result,
    }));
    expect(result.samplesMs).toHaveLength(20);
    expect([result.coldMs, result.medianMs, result.p95Ms, result.maxMs, ...result.samplesMs].every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
  } finally {
    abort.abort();
    await dispatcherTask;
    await consumer.close();
    await producer.close();
    await ai.close();
  }
});
