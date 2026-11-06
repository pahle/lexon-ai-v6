import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
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
    gateway: createScriptedModelGateway(scripts),
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
    executor: stepExecutor,
    attempts: new AiAttemptRepository(),
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
