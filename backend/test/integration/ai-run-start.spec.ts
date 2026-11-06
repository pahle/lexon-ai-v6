import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import {
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
} from '../../src/infrastructure/db/index.js';
import { ModelAllowlistSchema } from '../../src/infrastructure/ai/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { RunRegistry, type RunProfile } from '../../src/modules/chat/index.js';
import { RunService } from '../../src/modules/chat/run.service.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { StepCoordinator } from '../../src/modules/chat/step-coordinator.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { AttemptService } from '../../src/modules/usage/index.js';

const model = 'openai/gpt-6-luna';
const profile: RunProfile = {
  id: 'fixture-profile',
  version: 1,
  allowedModels: [model],
  defaultModel: model,
  queue: 'ai-interactive',
  priority: 5,
  maxIterations: 3,
  tokenBudget: 1000,
  maxOutputTokens: 100,
  contextBudgets: {},
  capabilities: [],
  maxAttemptsPerStep: 3,
  childBounds: { maxDepth: 2, tokenBudget: 250 },
  maxToolInputBytes: 12000,
  maxToolResultBytes: 14000,
  maxToolTimeoutMs: 4000,
};
function identityScope(
  actor: { orgId: string; userId: string },
  auth: RunAuthorizationService,
  work: (
    actor: import('../../src/modules/identity-access/index.js').RunActor,
  ) => Promise<unknown>,
) {
  const request = {};
  const identities = new RequestIdentity();
  identities.prepare(
    request,
    {
      identity: {
        userId: actor.userId,
        sessionId: randomUUID(),
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
          name: 'Fixture',
          email: 'fixture@example.test',
          emailVerified: true,
          twoFactorEnabled: false,
          onboardingCompleted: true,
        },
        organization: {
          version: 1,
          id: actor.orgId,
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
function runService(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  outbox = new OutboxRepository(),
  profiles: readonly RunProfile[] = [profile],
) {
  const authorization = new RunAuthorizationService();
  const registry = new RunRegistry();
  registry.register({ profiles, contexts: [], tools: [] });
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  return {
    authorization,
    service: new RunService(
      ai.database,
      new AiRunRepository(),
      new AiStepRepository(),
      outbox,
      new RunActorFactsRepository(),
      authorization,
      registry,
      ai.capacity,
      ai.capacityConfig,
      allowlist,
    ),
  };
}

test('live actor start atomically stores provenance, initial step and deterministic outbox', async ({
  services,
}) => {
  const audit = createAuditInspector(services);
  const ai = await createAiFixture(services);
  try {
    const auditBefore = await audit.count('chat.run_started.v1');
    const tenant = ai.tenants[0]!;
    const { authorization, service } = runService(ai);
    const result = (await identityScope(tenant, authorization, (actor) =>
      service.start(actor, {
        profileId: profile.id,
        prompt: 'A synthetic prompt',
      }),
    )) as { runId: string };
    const record = await ai.withTenant(0, (tx) =>
      new AiRunRepository().find(tx, result.runId),
    );
    const step = await ai.withTenant(0, (tx) =>
      new AiStepRepository().find(tx, { runId: result.runId, sequence: 1 }),
    );
    expect(record).toMatchObject({
      status: 'queued',
      runVersion: 1,
      nextSequence: 1,
      initiatingUserId: tenant.userId,
      profileId: profile.id,
      modelId: model,
      inputBudgetTokens: 900,
      outputBudgetTokens: 100,
    });
    expect(record?.initiatingSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record?.resolvedConfig).toMatchObject({
      profileSnapshot: {
        id: profile.id,
        version: 1,
        allowedModels: [model],
        defaultModel: model,
        maxAttemptsPerStep: 3,
        maxIterations: 3,
        contextBudgets: {},
        capabilities: [],
        childBounds: { maxDepth: 2, tokenBudget: 250 },
        maxToolInputBytes: 12000,
        maxToolResultBytes: 14000,
        maxToolTimeoutMs: 4000,
      },
      queue: profile.queue,
      priority: profile.priority,
    });
    expect(step).toMatchObject({
      sequence: 1,
      expectedVersion: 1,
      state: 'pending',
    });
    expect(await ai.outboxForRun(0, result.runId)).toMatchObject({
      id: stepJobId(result.runId, 1),
      queue_name: profile.queue,
      priority: profile.priority,
      payload: { runId: result.runId, sequence: 1, expectedVersion: 1 },
    });
    expect(await ai.losingStartCounts(0)).toEqual({
      runs: 1,
      outbox: 1,
      slots: 1,
    });
    expect(await audit.count('chat.run_started.v1')).toBe(auditBefore + 1);
  } finally {
    await Promise.all([ai.close(), audit.close()]);
  }
});

test('profile replacement after start cannot alter the persisted execution snapshot', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const tenant = ai.tenants[0]!;
    const mutable = {
      ...structuredClone(profile),
      compatibilityFacts: { routeHints: ['reviewed-only'] },
    } as RunProfile & { compatibilityFacts: { routeHints: string[] } };
    const { authorization, service } = runService(ai, new OutboxRepository(), [
      mutable,
    ]);
    const result = (await identityScope(tenant, authorization, (actor) =>
      service.start(actor, {
        profileId: mutable.id,
        prompt: 'A synthetic prompt',
      }),
    )) as { runId: string };
    (mutable.contextBudgets as Record<string, number>).retrieval = 999;
    (mutable.capabilities as string[]).push('write:unexpected');
    (mutable as { queue: 'ai-interactive' | 'ai-batch' }).queue = 'ai-batch';
    mutable.compatibilityFacts.routeHints.push('mutated-later');
    const stored = await ai.withTenant(0, (tx) =>
      new AiRunRepository().find(tx, result.runId),
    );
    expect(stored?.resolvedConfig).toMatchObject({
      profileSnapshot: {
        contextBudgets: {},
        capabilities: [],
        compatibilityFacts: { routeHints: ['reviewed-only'] },
      },
      queue: 'ai-interactive',
      priority: 5,
    });
    const queued = {
      outboxId: stepJobId(result.runId, 1),
      type: 'run.start.v1' as const,
      ctx: tenant,
      payload: { runId: result.runId, sequence: 1, expectedVersion: 1 },
    };
    const runs = new AiRunRepository();
    const steps = new AiStepRepository();
    const coordinator = new StepCoordinator(
      ai.database,
      runs,
      steps,
      new AttemptService(),
      new OutboxRepository(),
      new JobExecutor(ai.database),
    );
    const claim = await coordinator.claim(queued);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') return;
    expect(
      await coordinator.commit(queued, claim.claim, {
        state: 'committed',
        text: 'first step',
        data: {},
        advancement: 'generation',
      }),
    ).toBe('committed');
    expect(await ai.outboxForRunSequence(0, result.runId, 2)).toMatchObject({
      id: stepJobId(result.runId, 2),
      type: 'run.advance.v1',
      queue_name: 'ai-interactive',
      priority: 5,
      payload: { runId: result.runId, sequence: 2, expectedVersion: 2 },
    });
  } finally {
    await ai.close();
  }
});

test('copied or expired RunActor cannot persist a run or admission slot', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const tenant = ai.tenants[0]!;
    const { authorization, service } = runService(ai);
    let escaped!: import('../../src/modules/identity-access/index.js').RunActor;
    await identityScope(tenant, authorization, async (actor) => {
      escaped = actor;
      const copied = {
        orgId: actor.orgId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        mfaVerifiedAt: actor.mfaVerifiedAt,
      } as import('../../src/modules/identity-access/index.js').RunActor;
      await expect(
        service.start(copied, { profileId: profile.id, prompt: 'No' }),
      ).rejects.toThrow();
      return undefined;
    });
    await expect(
      service.start(escaped, { profileId: profile.id, prompt: 'No' }),
    ).rejects.toThrow();
    expect(await ai.losingStartCounts(0)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
  } finally {
    await ai.close();
  }
});

test('unreviewed profile model is denied before rows or admission', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const tenant = ai.tenants[0]!;
    const authorization = new RunAuthorizationService();
    const unreviewed: RunProfile = {
      ...profile,
      allowedModels: ['unreviewed/model'],
      defaultModel: 'unreviewed/model',
    };
    const registry = new RunRegistry();
    registry.register({ profiles: [unreviewed], contexts: [], tools: [] });
    const allowlist = ModelAllowlistSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../config/model-allowlist.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const service = new RunService(
      ai.database,
      new AiRunRepository(),
      new AiStepRepository(),
      new OutboxRepository(),
      new RunActorFactsRepository(),
      authorization,
      registry,
      ai.capacity,
      ai.capacityConfig,
      allowlist,
    );
    await expect(
      identityScope(tenant, authorization, (actor) =>
        service.start(actor, {
          profileId: unreviewed.id,
          prompt: 'A synthetic prompt',
        }),
      ),
    ).rejects.toThrow('AI model route is not uniquely reviewed');
    expect(await ai.losingStartCounts(0)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
  } finally {
    await ai.close();
  }
});

test('outbox append failure rolls back run, initial step and admission slot', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const tenant = ai.tenants[0]!;
    const brokenOutbox = new (class extends OutboxRepository {
      override async append(): Promise<string> {
        throw new Error('append failure');
      }
    })();
    const { authorization, service } = runService(ai, brokenOutbox);
    await expect(
      identityScope(tenant, authorization, (actor) =>
        service.start(actor, {
          profileId: profile.id,
          prompt: 'A synthetic prompt',
        }),
      ),
    ).rejects.toThrow('append failure');
    expect(await ai.losingStartCounts(0)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
  } finally {
    await ai.close();
  }
});

test('run, initial sequence, and outbox admission roll back as one transaction', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await expect(ai.startThenRollback(0)).rejects.toThrow('fixture rollback');
    expect(await ai.losingStartCounts(0)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
  } finally {
    await ai.close();
  }
});

test('AI admission uses actual active organization slots', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await ai.start(0);
    expect(await ai.orgSlotCount(0)).toBe(1);
    expect(await ai.orgSlotCount(1)).toBe(0);
  } finally {
    await ai.close();
  }
});
