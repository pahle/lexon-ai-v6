import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createChatApiHarness } from '../setup/chat-api-harness.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import {
  ChatCleanupWorker,
  type ChatCleanupMetric,
} from '../../src/modules/chat/chat-cleanup.worker.js';
import { RunStreams } from '../../src/infrastructure/queue/run-streams.js';
import { StepPermitManager } from '../../src/infrastructure/queue/step-permits.js';
import {
  ChatDeletionRepository,
  StepPermitReferenceRepository,
  type JobEnvelope,
  type StepClaim,
} from '../../src/infrastructure/db/index.js';

test('cleanup advances one durable phase at a time and permanently retains identity tombstones', async ({
  services,
}) => {
  const cleanupMetrics: ChatCleanupMetric[] = [];
  const app = await createTestApi(
    loadRuntimeConfig('api', {
      ...createAuthEnvironment(
        services,
        '/tmp/lexon-chat-delete-worker-health.json',
      ),
      CHAT_DELETE_GRACE_MS: '25',
      CHAT_DELETE_TARGET_MS: '60000',
    }),
  );
  const fixture = await createChatFixture(services);
  let lateClaim: StepClaim | undefined;
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: `${services.queuePrefix}:delete-worker-test`,
    authority: {
      authorizeActive: async (claim) =>
        lateClaim?.runId === claim.runId
          ? {
              runVersion: claim.expectedVersion,
              nextSequence: claim.sequence,
              status: 'running' as const,
              stepId: claim.stepId,
              sequence: claim.sequence,
              expectedVersion: claim.expectedVersion,
              fence: claim.fence,
              leaseUntil: new Date(Date.now() + 60_000),
            }
          : undefined,
      advanceStreamGeneration: async (_claim, observed) => observed + 1,
      authorizeTerminal: async () => undefined,
      reconcile: async (entries) =>
        entries.map(({ runId }) => ({ runId, state: 'missing' as const })),
    },
  });
  const permits = await StepPermitManager.create({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:delete-worker-test`,
  });
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as {
      user: { id: string };
      organization: { id: string };
    };
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'This content must be removed',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as { runId: string };
    lateClaim = {
      orgId: identity.organization.id,
      userId: identity.user.id,
      runId: mutation.runId,
      stepId: randomUUID(),
      sequence: 1,
      expectedVersion: 1,
      fence: 1,
      leaseUntil: new Date(Date.now() + 60_000),
    };
    const acceptedAt = Date.now();
    const deleted = await fetch(`${origin}/api/chats/${input.chatId}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleted.status).toBe(204);
    expect(
      await fixture.inspect.deletedChatWithoutTenant({
        orgId: identity.organization.id,
        userId: identity.user.id,
        chatId: input.chatId,
      }),
    ).toBe(false);
    const otherTenant = await fixture.database.withTenant(
      { orgId: randomUUID(), userId: identity.user.id },
      async (tx) => ({
        visible: await new ChatDeletionRepository().wasDeleted(
          tx,
          'chat',
          input.chatId,
        ),
        work: await new ChatDeletionRepository().read(tx, input.chatId),
      }),
    );
    expect(otherTenant).toEqual({ visible: false, work: null });
    const [initial] = await fixture.inspect.outbox(input.chatId);
    const job = {
      outboxId: initial.id,
      type: 'chat.cleanup.v1',
      ctx: { orgId: identity.organization.id, userId: identity.user.id },
      payload: { chatId: input.chatId, phase: 'grace' },
    } satisfies JobEnvelope;
    const worker = new ChatCleanupWorker(
      fixture.database,
      streams,
      permits,
      { now: () => Date.now() },
      {
        targetMs: 60_000,
        observer: {
          record: (metric) => cleanupMetrics.push(metric),
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await worker.advance(job)).toBe('pending');
    expect(cleanupMetrics[0]).toMatchObject({ event: 'retry', phase: 'grace' });
    expect(cleanupMetrics[0]!.elapsedMs).toBeLessThan(60_000);
    expect(cleanupMetrics[0]!.overdueMs).toBe(0);
    const dbPhase = (await fixture.inspect.outbox(input.chatId)).find(
      (entry) => entry.payload.phase === 'purge_db',
    );
    expect(dbPhase).toBeDefined();
    const dbWorker = new ChatCleanupWorker(fixture.database, streams, permits);
    expect(
      await dbWorker.advance({
        ...job,
        outboxId: dbPhase!.id,
        payload: { chatId: input.chatId, phase: 'purge_db' },
      }),
    ).toBe('pending');
    const valkeyPhase = (await fixture.inspect.outbox(input.chatId)).find(
      (entry) => entry.payload.phase === 'purge_valkey',
    );
    expect(valkeyPhase).toBeDefined();
    const valkeyWorker = new ChatCleanupWorker(
      fixture.database,
      streams,
      permits,
      { now: () => Date.now() },
      {
        targetMs: 60_000,
        observer: {
          record: (metric) => cleanupMetrics.push(metric),
        },
      },
    );
    const removeRuns = streams.removeRuns.bind(streams);
    let valkeyAvailable = false;
    streams.removeRuns = async (runIds) => {
      if (!valkeyAvailable) throw new Error('injected Valkey outage');
      await removeRuns(runIds);
    };
    const overdueRetryWorker = new ChatCleanupWorker(
      fixture.database,
      streams,
      permits,
      { now: () => Date.now() + 120_000 },
      {
        targetMs: 60_000,
        observer: {
          record: (metric) => cleanupMetrics.push(metric),
        },
      },
    );
    expect(
      await overdueRetryWorker.advance({
        ...job,
        outboxId: valkeyPhase!.id,
        payload: { chatId: input.chatId, phase: 'purge_valkey' },
      }),
    ).toBe('pending');
    expect(cleanupMetrics).toContainEqual(
      expect.objectContaining({
        event: 'retry',
        phase: 'purge_valkey',
        overdueMs: expect.any(Number),
      }),
    );
    expect(
      cleanupMetrics.find((metric) => metric.phase === 'purge_valkey')!
        .overdueMs,
    ).toBeGreaterThan(0);
    valkeyAvailable = true;
    const removeCompletionFailure =
      await fixture.inspect.failChatDeletionAuditInsert(
        'chat.deletion_completed.v1',
      );
    expect(
      await valkeyWorker
        .advance({
          ...job,
          outboxId: valkeyPhase!.id,
          payload: { chatId: input.chatId, phase: 'purge_valkey' },
        })
        .catch(() => 'database-failed'),
    ).toBe('database-failed');
    await removeCompletionFailure();
    const restartedWorker = new ChatCleanupWorker(
      fixture.database,
      streams,
      permits,
      { now: () => Date.now() },
    );
    expect(
      await restartedWorker.advance({
        ...job,
        outboxId: valkeyPhase!.id,
        payload: { chatId: input.chatId, phase: 'purge_valkey' },
      }),
    ).toBe('complete');
    expect(Date.now() - acceptedAt).toBeLessThan(60_000);
    expect(
      await worker.advance({
        ...job,
        outboxId: valkeyPhase!.id,
        payload: { chatId: input.chatId, phase: 'purge_valkey' },
      }),
    ).toBe('complete');
    expect(
      await fixture.inspect.deletionCounts(input.chatId, mutation.runId),
    ).toEqual({
      chats: 0,
      messages: 0,
      runs: 0,
      slots: 0,
      completedAudit: 1,
    });
    expect(
      await fixture.inspect.deletedRunFactsWithoutTenant({
        orgId: identity.organization.id,
        userId: identity.user.id,
        runId: mutation.runId,
        expectedVersion: lateClaim!.expectedVersion,
        sequence: lateClaim!.sequence,
        stepId: lateClaim!.stepId,
        fence: lateClaim!.fence,
      }),
    ).toMatchObject({ purged: false });

    const retry = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(retry.status).toBe(404);
    await fixture.inspect.expireChatCreateRequest(input.chatId);
    const afterReceiptExpiry = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(afterReceiptExpiry.status).toBe(404);
    const reusedMessageId = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        chatId: randomUUID(),
        requestId: randomUUID(),
      }),
    });
    expect(reusedMessageId.status).toBe(404);
    expect(await worker.advance(job)).toBe('complete');
    expect(
      await streams.publish(lateClaim!, {
        version: 1,
        runId: mutation.runId,
        type: 'text-start',
        id: randomUUID(),
      }),
    ).toBe('stale');
  } finally {
    await app.close();
    await streams.close();
    await permits.close();
    await fixture.close();
  }
});

test('cleanup releases exact run capacity while a started model call remains blocked past grace', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const permits = await StepPermitManager.create({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:delete-late-model-test`,
  });
  let execution: Promise<unknown> | undefined;
  let runningPermit:
    Awaited<ReturnType<StepPermitManager['acquire']>> | undefined;
  let replacementPermits: NonNullable<
    Awaited<ReturnType<StepPermitManager['acquire']>>
  >[] = [];
  try {
    const actor = await harness.client.identity.user('Late delete owner');
    const remainingOwner = await harness.client.identity.user(
      'Remaining team owner',
    );
    const org = await organizations.seedTeam([
      actor.profile.id,
      remainingOwner.profile.id,
    ]);
    const ctx = { orgId: org.id, userId: actor.profile.id };
    const baselineSlots = await harness.inspect.activeSlotCount();
    const baselinePermitA = await permits.acquire(org.id);
    const baselinePermitB = await permits.acquire(org.id);
    expect(baselinePermitA).not.toBeNull();
    expect(baselinePermitB).not.toBeNull();
    expect(await permits.acquire(org.id)).toBeNull();
    await baselinePermitA?.release();
    await baselinePermitB?.release();
    const chat = await harness.client.chat.createFor(ctx);
    const { runId } = await harness.client.startAnswer(
      ctx,
      chat.id,
      'late model prompt',
    );
    await harness.associateStartedAnswer(ctx, chat.id, runId);
    const titleRun = await harness.client.startAnswer(
      ctx,
      chat.id,
      'title generation prompt',
    );
    await harness.associateTitleRun(ctx, chat.id, titleRun.runId);
    const titleClaim = await harness.database.withTenant(ctx, (tx) =>
      harness.engine.steps.claim(tx, {
        runId: titleRun.runId,
        sequence: 1,
        expectedVersion: 1,
        leaseMs: 30_000,
      }),
    );
    expect(titleClaim).not.toBeNull();
    await harness.client.insertSyntheticAttemptFor(ctx, titleClaim!.claim);
    const job = harness.jobForAnswer(ctx, runId);
    execution = harness.engine.execute(job, {
      signal: new AbortController().signal,
    });
    await Promise.race([
      harness.model.block(),
      execution.then(() => {
        throw new Error('Model call exited before the barrier');
      }),
    ]);
    expect(await harness.inspect.capacity(runId)).toHaveLength(1);
    runningPermit = await permits.acquire(org.id);
    expect(runningPermit).not.toBeNull();
    const step = await harness.database.withTenant(ctx, (tx) =>
      harness.engine.steps.find(tx, { runId, sequence: 1 }),
    );
    expect(step).not.toBeNull();
    if (!step || !runningPermit) throw new Error('Expected active step permit');
    await new StepPermitReferenceRepository(harness.database).record(
      runningPermit.ownerReference,
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        runId,
        sequence: step.sequence,
        expectedVersion: step.expectedVersion,
        stepId: step.id,
        fence: step.fence,
        leaseUntil: step.leaseUntil!,
      },
    );
    const deletions = new ChatDeletionRepository();
    const accepted = await harness.database.withTenant(ctx, (tx) =>
      deletions.request(tx, chat.id, 30_000),
    );
    expect(accepted).toBe(true);
    await organizations.mutateMember(org.members[0]!.id, 'delete');
    const deletionWork = await harness.database.withTenant(ctx, (tx) =>
      deletions.read(tx, chat.id),
    );
    expect(deletionWork?.permitRefs).toHaveLength(1);
    expect(deletionWork?.runIds).toContain(titleRun.runId);
    expect(deletionWork?.permitRefs[0]).toMatchObject({
      orgId: ctx.orgId,
      runId,
      sequence: 1,
      expectedVersion: step.expectedVersion,
      stepId: step.id,
      fence: step.fence,
      slot: runningPermit.slot,
      ownerToken: runningPermit.ownerReference.ownerToken,
    });
    const [graceJob] = await harness.inspect.outbox(chat.id);
    const cleanup = new ChatCleanupWorker(
      harness.database,
      harness.streams,
      permits,
      { now: () => Date.now() + 120_000 },
    );
    const envelope = {
      outboxId: graceJob!.id,
      type: 'chat.cleanup.v1',
      ctx,
      payload: { chatId: chat.id, phase: 'grace' },
    } satisfies JobEnvelope;

    expect(await cleanup.advance(envelope)).toBe('pending');
    const dbJob = (await harness.inspect.outbox(chat.id)).find(
      (entry) => entry.payload.phase === 'purge_db',
    );
    expect(dbJob).toBeDefined();
    expect(
      await cleanup.advance({
        ...envelope,
        outboxId: dbJob!.id,
        payload: { chatId: chat.id, phase: 'purge_db' },
      }),
    ).toBe('pending');
    const valkeyJob = (await harness.inspect.outbox(chat.id)).find(
      (entry) => entry.payload.phase === 'purge_valkey',
    );
    expect(valkeyJob).toBeDefined();
    expect(
      await cleanup.advance({
        ...envelope,
        outboxId: valkeyJob!.id,
        payload: { chatId: chat.id, phase: 'purge_valkey' },
      }),
    ).toBe('complete');

    expect(await harness.inspect.capacity(runId)).toHaveLength(0);
    expect(await harness.inspect.runs(titleRun.runId)).toBeNull();
    expect(await harness.inspect.usage(titleRun.runId)).toMatchObject([
      { outcome: 'unknown' },
    ]);
    expect(await harness.inspect.activeSlotCount()).toBe(baselineSlots);
    expect(await harness.inspect.tree(chat.id)).toEqual([]);
    expect(await harness.inspect.usageFor(ctx, runId)).toHaveLength(1);
    expect(await runningPermit!.renew()).toBe('lost');
    replacementPermits = [
      await permits.acquire(org.id),
      await permits.acquire(org.id),
    ].filter((permit): permit is NonNullable<typeof permit> => permit !== null);
    expect(replacementPermits).toHaveLength(2);
    expect(await permits.acquire(org.id)).toBeNull();
    await runningPermit.release();
    expect(await replacementPermits[0]!.renew()).toBe('renewed');

    harness.model.release();
    await execution;
    expect(await harness.inspect.usageFor(ctx, runId)).toMatchObject([
      {
        outcome: 'succeeded',
        reported_input_tokens: 1,
        reported_output_tokens: 4,
      },
    ]);
  } finally {
    harness.model.release();
    await runningPermit?.release();
    await Promise.all(replacementPermits.map((permit) => permit.release()));
    await execution?.catch(() => undefined);
    await permits.close();
    await organizations.close();
    await harness.close();
  }
});
