import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createAiHarness } from '../setup/ai-harness.js';
import { RunStreams } from '../../src/infrastructure/queue/index.js';
import {
  AiAttemptRepository,
  AiRunRepository,
  AiStepRepository,
} from '../../src/infrastructure/db/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { IdentitySummarySchema } from '@lexon/contracts';
import { CHAT_PROFILES } from '../../src/modules/chat/chat-profiles.js';
import { ChatHistoryContextProvider } from '../../src/modules/chat/chat-history-context.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import {
  createRealModelGateway,
  ModelAllowlistSchema,
} from '../../src/infrastructure/ai/index.js';
import { test } from '../setup/file-services.js';

test('executor streams only typed summaries and reload matches measured timing', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  const tenant = fixture.tenants[0]!;
  const chat = await fixture.chat.create(0);
  const userMessageId = randomUUID();
  const rawCanary = 'executor raw reasoning must never persist';
  const summary = 'durable typed reasoning summary';
  let fetchCalls = 0;
  const redis = new Redis(services.valkey.streamsUrl);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: (claim) =>
        fixture.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamActiveProof(tx, claim),
        ),
      advanceStreamGeneration: (claim, observed) =>
        fixture.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.advanceStreamGeneration(tx, claim, observed),
          { timeoutMs: 500 },
        ),
      authorizeTerminal: (claim) =>
        fixture.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamTerminalProof(tx, claim),
        ),
      advanceTerminalStreamGeneration: (claim, observed) =>
        fixture.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.advanceTerminalStreamGeneration(tx, claim, observed),
          { timeoutMs: 500 },
        ),
      authorizeCommitted: (claim, event) =>
        fixture.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamCommittedProof(tx, claim, event),
        ),
      reconcile: async (entries) =>
        Promise.all(
          entries.map(async ({ runId, orgId, userId }) => {
            const result = await fixture.database.withTenant(
              { orgId, userId },
              (tx) => runs.streamRegistryState(tx, runId, userId),
            );
            return result.state === 'terminal'
              ? { runId, state: 'terminal' as const, claim: result.claim }
              : { runId, state: result.state };
          }),
        ),
    },
  });
  const auth = new RunAuthorizationService();
  const requestIdentity = new RequestIdentity();
  const summaryInfo = IdentitySummarySchema.parse({
    version: 1,
    platformAdmin: false,
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
  });
  const identityRequest = {};
  requestIdentity.prepare(
    identityRequest,
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
      summary: summaryInfo,
    },
    new Headers(),
  );
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  let clock = 100;
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only',
    attestation: '2026-11-05',
    reasoningClock: () => (clock += 1),
    fetch: async () => {
      fetchCalls++;
      const reasoningFrame = `data: ${JSON.stringify({
        id: `gen-reasoning-${fetchCalls}`,
        model: 'openai/gpt-6-luna',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_details: [
                { type: 'reasoning.summary', summary },
                { type: 'reasoning.text', text: rawCanary },
              ],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`;
      if (fetchCalls === 2) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(reasoningFrame));
              setTimeout(
                () =>
                  controller.error(
                    new TypeError('fetch failed', {
                      cause: Object.assign(
                        new Error('private transport detail'),
                        { code: 'ECONNRESET' },
                      ),
                    }),
                  ),
                10,
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      const answer =
        fetchCalls === 1
          ? 'answer paired with measured timing'
          : 'answer after retry without signal';
      return new Response(
        [
          ...(fetchCalls === 1 ? [reasoningFrame] : []),
          `data: ${JSON.stringify({ id: `gen-reasoning-${fetchCalls}`, model: 'openai/gpt-6-luna', choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id: `gen-reasoning-${fetchCalls}`, model: 'openai/gpt-6-luna', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
          'data: [DONE]\n\n',
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const engine = await createAiHarness(
    {
      database: fixture.database,
      capacity: fixture.capacity,
      capacityConfig: fixture.capacityConfig,
      allowlist,
      authorization: auth,
      close: async () => {},
    },
    {
      profiles: [CHAT_PROFILES.chat],
      contexts: [new ChatHistoryContextProvider(fixture.database)],
      tools: [],
    },
    gateway,
    undefined,
    { streams },
  );
  try {
    await fixture.chat.insertUser(0, {
      chatId: chat.id,
      messageId: userMessageId,
      parentMessageId: null,
      text: 'Mocked provider question',
      effort: 'high',
    });
    const run = await requestIdentity.run(identityRequest, () =>
      auth.withActor(currentVerifiedIdentity(), (actor) =>
        engine.start(actor, {
          profileId: CHAT_PROFILES.chat.id,
          prompt: 'Mocked provider question',
          resourceIds: [chat.id],
        }),
      ),
    );
    await fixture.chat.associateStartedAnswer(0, chat.id, run.runId);
    await fixture.chat.insertAssistant(0, {
      chatId: chat.id,
      messageId: run.runId,
      parentMessageId: userMessageId,
      runId: run.runId,
    });
    await engine.execute(
      {
        outboxId: stepJobId(run.runId, 1),
        type: 'run.start.v1',
        ctx: tenant,
        payload: { runId: run.runId, sequence: 1, expectedVersion: 1 },
      },
      { signal: new AbortController().signal },
    );
    const key = `${services.queuePrefix}:{run-streams}:${run.runId}:events`;
    const entries = await redis.xrange(key, '-', '+');
    const liveEvents = entries.map(([, fields]) =>
      JSON.parse(fields[fields.indexOf('event') + 1]!),
    );
    const liveSummary = liveEvents
      .filter((event) => event.type === 'reasoning-delta')
      .map((event) => event.delta)
      .join('');
    const liveEnd = liveEvents.find((event) => event.type === 'reasoning-end');
    expect(liveSummary).toBe(summary);
    expect(liveEnd).toMatchObject({ durationMs: 1 });
    expect(JSON.stringify(liveEvents)).not.toContain(rawCanary);
    const tree = await fixture.chat.tree(0, chat.id);
    const reloaded = tree?.messages.find((message) => message.id === run.runId);
    expect(reloaded).toMatchObject({
      assistantText: 'answer paired with measured timing',
      reasoningSummary: summary,
      reasoningDurationMs: 1,
    });
    expect(JSON.stringify(reloaded)).not.toContain(rawCanary);
    const checkpointText = await fixture.inspect.reasoningCheckpoints(
      0,
      run.runId,
    );
    expect(checkpointText).toEqual([
      {
        text: 'answer paired with measured timing',
        reasoning_summary: summary,
        reasoning_duration_ms: 1,
        stream_generation: expect.any(Number),
        stream_event_id: expect.stringMatching(/^\d+-\d+$/),
        stream_revision: expect.any(Number),
        stream_resumable: true,
      },
    ]);
    expect(
      entries.find(([id]) => id === checkpointText[0]?.stream_event_id)?.[0],
    ).toBe(checkpointText[0]?.stream_event_id);
    const runStreamMetadata = await fixture.inspect.streamMetadata(run.runId);
    expect(runStreamMetadata).toMatchObject({
      stream_generation: expect.any(Number),
      stream_snapshot_generation: checkpointText[0]?.stream_generation,
      stream_event_id: checkpointText[0]?.stream_event_id,
      stream_resumable: true,
    });
    expect(runStreamMetadata?.stream_generation).toBeGreaterThanOrEqual(
      runStreamMetadata?.stream_snapshot_generation ?? 0,
    );
    expect(JSON.stringify(checkpointText)).not.toContain(rawCanary);

    const retryChat = await fixture.chat.create(0);
    const retryUserId = randomUUID();
    await fixture.chat.insertUser(0, {
      chatId: retryChat.id,
      messageId: retryUserId,
      parentMessageId: null,
      text: 'Retry reset question',
      effort: 'high',
    });
    const retryIdentityRequest = {};
    requestIdentity.prepare(
      retryIdentityRequest,
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
        summary: summaryInfo,
      },
      new Headers(),
    );
    const retryRun = await requestIdentity.run(retryIdentityRequest, () =>
      auth.withActor(currentVerifiedIdentity(), (actor) =>
        engine.start(actor, {
          profileId: CHAT_PROFILES.chat.id,
          prompt: 'Retry reset question',
          resourceIds: [retryChat.id],
        }),
      ),
    );
    await fixture.chat.associateStartedAnswer(0, retryChat.id, retryRun.runId);
    await fixture.chat.insertAssistant(0, {
      chatId: retryChat.id,
      messageId: retryRun.runId,
      parentMessageId: retryUserId,
      runId: retryRun.runId,
    });
    await engine.execute(
      {
        outboxId: stepJobId(retryRun.runId, 1),
        type: 'run.start.v1',
        ctx: tenant,
        payload: { runId: retryRun.runId, sequence: 1, expectedVersion: 1 },
      },
      { signal: new AbortController().signal },
    );
    const retryEntries = await redis.xrange(
      `${services.queuePrefix}:{run-streams}:${retryRun.runId}:events`,
      '-',
      '+',
    );
    const retryEvents = retryEntries.map(([, fields]) =>
      JSON.parse(fields[fields.indexOf('event') + 1]!),
    );
    expect(
      retryEvents.some((event) => event.type === 'reset-step'),
      `${fetchCalls}: ${JSON.stringify(retryEvents)}`,
    ).toBe(true);
    expect(
      retryEvents.some(
        (event) => event.type === 'reasoning-delta' && event.delta === summary,
      ),
    ).toBe(true);
    expect(JSON.stringify(retryEvents)).not.toContain(rawCanary);
    const retryTree = await fixture.chat.tree(0, retryChat.id);
    expect(
      retryTree?.messages.find((message) => message.id === retryRun.runId),
    ).toMatchObject({
      assistantText: 'answer after retry without signal',
      reasoningSummary: null,
      reasoningDurationMs: null,
    });
    const retryRunRow = await fixture.database.withTenant(tenant, (tx) =>
      runs.find(tx, retryRun.runId),
    );
    expect(retryRunRow).toMatchObject({
      reasoningSummary: null,
      reasoningDurationMs: null,
    });
  } finally {
    await engine.close();
    await streams.close();
    redis.disconnect();
    await fixture.close();
  }
});

test('checkpoint writes roll back together if its lease expires between writes', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  let removeLeaseTrigger: (() => Promise<void>) | undefined;
  try {
    const tenant = fixture.tenants[0]!;
    const chat = await fixture.chat.create(0);
    const parentId = randomUUID();
    await fixture.chat.insertUser(0, {
      chatId: chat.id,
      messageId: parentId,
      parentMessageId: null,
      text: 'Synthetic question',
      effort: 'high',
    });
    const run = await fixture.database.withTenant(tenant, (tx) =>
      new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: tenant.orgId,
        initiatingUserId: tenant.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'Synthetic question',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      }),
    );
    await fixture.chat.linkAnswer(0, chat.id, run.id);
    await fixture.chat.insertAssistant(0, {
      chatId: chat.id,
      messageId: run.id,
      parentMessageId: parentId,
      runId: run.id,
    });
    removeLeaseTrigger = await fixture.expireCheckpointLeaseAfterInsert(run.id);
    await fixture.database.withTenant(tenant, async (tx) => {
      const result = await new AiStepRepository().claim(tx, {
        runId: run.id,
        sequence: 1,
        expectedVersion: 1,
        leaseMs: 30_000,
      });
      if (!result?.claim)
        throw new Error('Reasoning fixture claim unavailable');
      const attemptId = randomUUID();
      await new AiAttemptRepository().insert(tx, result.claim, {
        attemptId,
        orgId: tenant.orgId,
        runId: run.id,
        stepId: result.claim.stepId,
        ordinal: 1,
        modelId: 'synthetic/test',
        estimatorVersion: 'test-v1',
        estimatedInputTokens: 1,
        reservedInputTokens: 1,
        reservedOutputTokens: 4,
        generationId: null,
        provider: null,
        reportedInputTokens: null,
        reportedOutputTokens: null,
        cachedInputTokens: null,
        reasoningOutputTokens: null,
        costUsd: null,
        active: true,
        outcome: null,
        createdAt: new Date(),
        settledAt: null,
      });
      const saved = await new AiStepRepository().checkpoint(tx, result.claim, {
        attemptId,
        text: 'Synthetic partial answer',
        reasoningSummary: 'must roll back with answer',
        reasoningDurationMs: 2500,
      });
      expect(saved).toBe(false);
    });
    const persisted = await fixture.inspect.reasoningCheckpoints(0, run.id);
    expect(persisted).toEqual([]);
    const reloadedRun = await fixture.database.withTenant(tenant, (tx) =>
      new AiRunRepository().find(tx, run.id),
    );
    expect(reloadedRun).toMatchObject({
      reasoningSummary: null,
      reasoningDurationMs: null,
    });
  } finally {
    await removeLeaseTrigger?.();
    await fixture.close();
  }
});

test('chat reload preserves measured reasoning timing without a summary body', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const tenant = fixture.tenants[0]!;
    const chat = await fixture.chat.create(0);
    const parentId = randomUUID();
    await fixture.chat.insertUser(0, {
      chatId: chat.id,
      messageId: parentId,
      parentMessageId: null,
      text: 'Synthetic question',
      effort: 'high',
    });
    const run = await fixture.database.withTenant(tenant, (tx) =>
      new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: tenant.orgId,
        initiatingUserId: tenant.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'Synthetic question',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      }),
    );
    await fixture.chat.linkAnswer(0, chat.id, run.id);
    await fixture.chat.insertAssistant(0, {
      chatId: chat.id,
      messageId: run.id,
      parentMessageId: parentId,
      runId: run.id,
    });
    await fixture.database.withTenant(tenant, async (tx) => {
      const result = await new AiStepRepository().claim(tx, {
        runId: run.id,
        sequence: 1,
        expectedVersion: 1,
        leaseMs: 30_000,
      });
      if (!result?.claim)
        throw new Error('Reasoning fixture claim unavailable');
      const attemptId = randomUUID();
      await new AiAttemptRepository().insert(tx, result.claim, {
        attemptId,
        orgId: tenant.orgId,
        runId: run.id,
        stepId: result.claim.stepId,
        ordinal: 1,
        modelId: 'synthetic/test',
        estimatorVersion: 'test-v1',
        estimatedInputTokens: 1,
        reservedInputTokens: 1,
        reservedOutputTokens: 4,
        generationId: null,
        provider: null,
        reportedInputTokens: null,
        reportedOutputTokens: null,
        cachedInputTokens: null,
        reasoningOutputTokens: null,
        costUsd: null,
        active: true,
        outcome: null,
        createdAt: new Date(),
        settledAt: null,
      });
      const saved = await new AiStepRepository().checkpoint(tx, result.claim, {
        attemptId,
        text: 'Synthetic partial answer',
        reasoningSummary: null,
        reasoningDurationMs: 2500,
      });
      expect(saved).toBe(true);
    });
    expect(await fixture.inspect.reasoningCheckpoints(0, run.id)).toEqual([
      {
        text: 'Synthetic partial answer',
        reasoning_duration_ms: 2500,
        reasoning_summary: null,
        stream_generation: 0,
        stream_event_id: null,
        stream_revision: 0,
        stream_resumable: false,
      },
    ]);
    const tree = await fixture.chat.tree(0, chat.id);
    expect(
      tree?.messages.find((message) => message.id === run.id),
    ).toMatchObject({
      assistantText: 'Synthetic partial answer',
      reasoningSummary: null,
      reasoningDurationMs: 2500,
    });
    expect(await fixture.chat.delete(0, chat.id)).toBe(true);
    expect(await fixture.chat.directReasoningWrites(0, run.id)).toEqual({
      run: 0,
      checkpoint: 0,
    });
  } finally {
    await fixture.close();
  }
});
