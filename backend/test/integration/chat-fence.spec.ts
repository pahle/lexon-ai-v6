import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  AiRunRepository,
  AiStepRepository,
  ChatMessageRepository,
  ChatRepository,
} from '../../src/infrastructure/db/index.js';
import { test } from '../setup/file-services.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createChatApiHarness } from '../setup/chat-api-harness.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';

test('same-org peers cannot read guessed chat-bound run content or write it directly', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const owner = await harness.client.identity.user('Run owner');
    const peer = await harness.client.identity.user('Run peer');
    const org = await organizations.seedTeam([
      owner.profile.id,
      peer.profile.id,
    ]);
    const ownerCtx = { orgId: org.id, userId: owner.profile.id };
    const peerCtx = { orgId: org.id, userId: peer.profile.id };
    const peerIdentity = (await (
      await harness.client.identity.call('/identity', peer.headers)
    ).json()) as { organization: { id: string } };
    const otherOrgCtx = {
      orgId: peerIdentity.organization.id,
      userId: peer.profile.id,
    };
    const chat = await harness.client.chat.createFor(ownerCtx);
    const { runId } = await harness.client.startAnswer(
      ownerCtx,
      chat.id,
      'Owner-only prompt',
    );
    await harness.associateStartedAnswer(ownerCtx, chat.id, runId);
    expect(
      await harness.client.directRunOutputAs(
        ownerCtx,
        runId,
        'private run output',
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await harness.client.directSetStepTextAs(
        ownerCtx,
        runId,
        'private step text',
      ),
    ).toMatchObject({ rowCount: 1 });
    const ownerRun = await harness.database.withTenant(ownerCtx, (tx) =>
      new AiRunRepository().find(tx, runId),
    );
    expect(ownerRun).toMatchObject({ partialOutput: 'private run output' });
    expect(
      await harness.database.withTenant(peerCtx, (tx) =>
        new AiRunRepository().find(tx, runId),
      ),
    ).toBeNull();
    expect(
      await harness.client.directRunOutputAs(peerCtx, runId, 'peer overwrite'),
    ).toMatchObject({
      rowCount: 0,
    });
    expect(
      await harness.client.directRelatedRunContent(peerCtx, runId),
    ).toEqual({
      steps: [],
      checkpoints: [],
      operations: [],
    });
    expect(
      await harness.database.withTenant(otherOrgCtx, (tx) =>
        new AiRunRepository().find(tx, runId),
      ),
    ).toBeNull();
    expect(await harness.client.runWithoutTenant(runId)).toMatchObject({
      rows: [],
    });
    expect(await harness.inspect.runs(runId)).toMatchObject({
      partial_output: 'private run output',
    });
    const legacyHeadless = await harness.database.withTenant(ownerCtx, (tx) =>
      new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: org.id,
        initiatingUserId: owner.profile.id,
        profileId: 'headless-legacy-test',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'legacy org-scoped prompt',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      }),
    );
    const legacyStepId = randomUUID();
    await harness.database.withTenant(ownerCtx, (tx) =>
      new AiStepRepository().insertInitial(tx, {
        id: legacyStepId,
        runId: legacyHeadless.id,
      }),
    );
    expect(
      await harness.database.withTenant(peerCtx, (tx) =>
        new AiRunRepository().find(tx, legacyHeadless.id),
      ),
    ).not.toBeNull();
    expect(
      await harness.client.directRunOutputAs(
        peerCtx,
        legacyHeadless.id,
        'legacy org-scoped output',
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await harness.client.directSetStepTextAs(
        peerCtx,
        legacyHeadless.id,
        'legacy org-scoped step text',
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await harness.client.directRelatedRunContent(peerCtx, legacyHeadless.id),
    ).toMatchObject({
      steps: [{ committed_text: 'legacy org-scoped step text' }],
    });
  } finally {
    await organizations.close();
    await harness.close();
  }
});

test('runtime cannot delete or truncate a chat run association', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const owner = await harness.client.identity.user('Immutable link owner');
    const org = await organizations.seedTeam([owner.profile.id]);
    const ctx = { orgId: org.id, userId: owner.profile.id };
    const chat = await harness.client.chat.createFor(ctx);
    const { runId } = await harness.client.startAnswer(ctx, chat.id, 'Prompt');
    await harness.associateStartedAnswer(ctx, chat.id, runId);
    expect(await harness.inspect.effectiveChatTablePrivileges()).toEqual([
      { table_name: 'chat_messages', can_delete: false, can_truncate: false },
      { table_name: 'chat_runs', can_delete: false, can_truncate: false },
      { table_name: 'chats', can_delete: false, can_truncate: false },
    ]);
    await expect(
      harness.client.deleteAssociationAs(ctx, runId),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await organizations.close();
    await harness.close();
  }
});

test('a chat-bound run cannot remove its declared resource to escape the fence', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const tenant = fixture.tenants[0]!;
    const chat = await fixture.chat.create(0);
    const run = await fixture.database.withTenant(tenant, (tx) =>
      new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: tenant.orgId,
        initiatingUserId: tenant.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'private prompt',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      }),
    );
    await fixture.chat.linkAnswer(0, chat.id, run.id);
    await expect(
      fixture.chat.setRunResourcesAs(tenant, run.id, []),
    ).rejects.toThrow();
    expect(await fixture.chat.tree(0, chat.id)).toBeDefined();
  } finally {
    await fixture.close();
  }
});

test('tree projection replaces committed checkpoints and ignores inactive attempts', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  try {
    const actor = await harness.client.identity.user(
      'Checkpoint projection owner',
    );
    const identity = (await (
      await harness.client.identity.call('/identity', actor.headers)
    ).json()) as { organization: { id: string } };
    const ctx = { orgId: identity.organization.id, userId: actor.profile.id };
    const chat = await harness.client.chat.createFor(ctx);
    const { runId } = await harness.client.startAnswer(ctx, chat.id, 'prompt');
    await harness.associateStartedAnswer(ctx, chat.id, runId);
    const userMessageId = randomUUID();
    const answerMessageId = randomUUID();
    const messages = new ChatMessageRepository();
    await harness.database.withTenant(ctx, async (tx) => {
      await messages.insertUser(tx, {
        chatId: chat.id,
        messageId: userMessageId,
        parentMessageId: null,
        text: 'prompt',
        effort: 'high',
      });
      await messages.insertAssistant(tx, {
        chatId: chat.id,
        messageId: answerMessageId,
        parentMessageId: userMessageId,
        runId,
      });
    });
    const job = harness.jobForAnswer(ctx, runId);
    const firstClaim = await harness.engine.dispatch(job);
    expect(firstClaim.kind).toBe('claimed');
    if (firstClaim.kind !== 'claimed')
      throw new Error('Expected initial claim');
    const firstAttempt = await harness.client.insertSyntheticAttemptFor(
      ctx,
      firstClaim.claim,
    );
    expect(
      await harness.client.checkpointFor(
        ctx,
        firstClaim.claim,
        firstAttempt,
        'first durable chunk',
      ),
    ).toBe(true);
    const beforeCommit = await harness.client.chat.treeAs(ctx, chat.id);
    expect(
      beforeCommit?.messages.find((message) => message.id === answerMessageId)
        ?.assistantText,
    ).toBe('first durable chunk');
    expect(
      await harness.engine.coordinator.commit(job, firstClaim.claim, {
        state: 'committed',
        text: 'first durable chunk',
        data: { outcome: 'succeeded' },
        advancement: 'generation',
      }),
    ).toBe('committed');
    const afterAdvance = await harness.client.chat.treeAs(ctx, chat.id);
    expect(
      afterAdvance?.messages.find((message) => message.id === answerMessageId)
        ?.assistantText,
    ).toBe('first durable chunk');

    const secondJob = {
      ...job,
      outboxId: stepJobId(runId, 2),
      payload: { runId, sequence: 2, expectedVersion: 2 },
    };
    const secondClaim = await harness.engine.dispatch(secondJob);
    expect(secondClaim.kind).toBe('claimed');
    if (secondClaim.kind !== 'claimed') throw new Error('Expected next claim');
    const staleAttempt = await harness.client.insertSyntheticAttemptFor(
      ctx,
      secondClaim.claim,
    );
    expect(
      await harness.client.checkpointFor(
        ctx,
        secondClaim.claim,
        staleAttempt,
        'inactive attempt text',
      ),
    ).toBe(true);
    await harness.client.deactivateAttemptFor(ctx, staleAttempt);
    const afterStaleAttempt = await harness.client.chat.treeAs(ctx, chat.id);
    expect(
      afterStaleAttempt?.messages.find(
        (message) => message.id === answerMessageId,
      )?.assistantText,
    ).toBe('first durable chunk');
  } finally {
    await harness.close();
  }
});

async function verifyDeletedCancellation(
  services: Parameters<typeof createChatApiHarness>[0],
  expired: boolean,
) {
  const harness = await createChatApiHarness(services);
  try {
    const actor = await harness.client.identity.user(
      'Deleted cancellation owner',
    );
    const identity = (await (
      await harness.client.identity.call('/identity', actor.headers)
    ).json()) as { organization: { id: string } };
    const ctx = { orgId: identity.organization.id, userId: actor.profile.id };
    const chat = await harness.client.chat.createFor(ctx);
    const { runId } = await harness.client.startAnswer(ctx, chat.id, 'prompt');
    await harness.associateStartedAnswer(ctx, chat.id, runId);
    const job = harness.jobForAnswer(ctx, runId);
    const claimResult = await harness.engine.dispatch(job);
    expect(claimResult.kind).toBe('claimed');
    if (claimResult.kind !== 'claimed')
      throw new Error('Expected answer claim');
    expect(
      await harness.database.withTenant(ctx, (tx) =>
        harness.engine.runs.transition(tx, {
          runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'cancelling',
        }),
      ),
    ).toBe(true);
    if (expired)
      expect(await harness.client.expireStepLeaseAs(ctx, runId)).toMatchObject({
        rowCount: 1,
      });
    expect(await harness.client.chat.deleteFor(ctx, chat.id)).toBe(true);
    const factsInput = {
      orgId: ctx.orgId,
      userId: ctx.userId,
      runId,
      expectedVersion: claimResult.claim.expectedVersion,
      sequence: claimResult.claim.sequence,
      stepId: claimResult.claim.stepId,
      fence: claimResult.claim.fence,
    };
    expect(
      await harness.client.deletedCancellationFactsAs(ctx, factsInput),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await harness.client.deletedCancellationFactsAs(ctx, {
        ...factsInput,
        userId: randomUUID(),
      }),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await harness.client.deletedCancellationFactsAs(ctx, {
        ...factsInput,
        orgId: randomUUID(),
      }),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await harness.client.deletedCancellationFactsAs(ctx, {
        ...factsInput,
        expectedVersion: factsInput.expectedVersion + 1,
      }),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await harness.client.deletedCancellationFactsWithoutTenant(factsInput),
    ).toMatchObject({ rowCount: 0 });
    expect(await harness.inspect.lifecycleFunctionPrivileges()).toEqual({
      app_can_execute: true,
      auth_can_execute: false,
      public_can_execute: false,
      app_can_finalize: true,
      auth_can_finalize: false,
      public_can_finalize: false,
    });
    const finalization = harness.engine.coordinator.finalizeCancellation(
      job,
      claimResult.claim,
      { text: 'cancellation content must not persist' },
    );
    expect(
      await stage(
        finalization,
        `${expired ? 'expired' : 'live'} cancellation finalization`,
      ),
    ).toBe('committed');
    const run = await harness.inspect.runs(runId);
    expect(run).toMatchObject({
      status: 'cancelled',
      partial_output: '',
      final_output: null,
    });
    expect(await harness.inspect.capacity(runId)).toHaveLength(0);
    expect(await harness.inspect.tree(chat.id)).toEqual([]);
    expect(
      await harness.engine.coordinator.finalizeCancellation(
        job,
        claimResult.claim,
        { text: 'duplicate cancellation' },
      ),
    ).toBe('stale');
    expect(await harness.inspect.runs(runId)).toMatchObject({
      status: 'cancelled',
      partial_output: '',
      final_output: null,
    });
  } finally {
    harness.model.release();
    await harness.close();
  }
}

test('deleted chat cancellation terminalizes a live claim without content', async ({
  services,
}) => verifyDeletedCancellation(services, false));

test('deleted chat cancellation terminalizes an expired claim without content', async ({
  services,
}) => verifyDeletedCancellation(services, true));

test('deletion after actual model start preserves one settlement and releases capacity', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  let worker: Promise<unknown> | undefined;
  try {
    const actor = await harness.client.identity.user(
      'In-flight deletion owner',
    );
    const org = await organizations.seedTeam([actor.profile.id]);
    const ctx = { orgId: org.id, userId: actor.profile.id };
    const chat = await harness.client.chat.createFor(ctx);
    const { runId } = await harness.client.startAnswer(ctx, chat.id, 'prompt');
    await harness.associateStartedAnswer(ctx, chat.id, runId);
    const job = harness.jobForAnswer(ctx, runId);
    worker = harness.engine.execute(job, {
      signal: new AbortController().signal,
    });
    const started = harness.model.started.then(() => 'started' as const);
    const workerOutcome = worker.then(
      (value) => `worker:${JSON.stringify(value)}`,
      (error) => `error:${String(error)}`,
    );
    const entered = await stage(
      Promise.race([started, workerOutcome]),
      'model generation entry or worker exit',
    );
    if (entered !== 'started') {
      const run = await harness.engine.inspect(ctx, runId);
      const step = await harness.database.withTenant(ctx, (tx) =>
        harness.engine.steps.find(tx, { runId, sequence: 1 }),
      );
      throw new Error(
        `Worker exited before model start: ${entered}; run=${run?.status}/${run?.errorCode}/${run?.runVersion}/${run?.nextSequence}; step=${step?.state}/${step?.fence}`,
      );
    }
    expect(await harness.inspect.runs(runId)).toMatchObject({
      status: 'running',
    });
    await harness.client.cancelFor(ctx, runId);
    expect(await harness.inspect.runs(runId)).toMatchObject({
      status: 'cancelling',
    });
    expect(await harness.client.chat.deleteFor(ctx, chat.id)).toBe(true);
    harness.model.release();
    await stage(worker, 'model and cancellation settlement');
    expect(await harness.inspect.runs(runId)).toMatchObject({
      status: 'cancelled',
      partial_output: '',
      final_output: null,
    });
    expect(await harness.inspect.tree(chat.id)).toEqual([]);
    expect(await harness.inspect.usageFor(ctx, runId)).toMatchObject([
      {
        outcome: 'succeeded',
        reported_input_tokens: 1,
        reported_output_tokens: 4,
      },
    ]);
    expect(await harness.inspect.capacity(runId)).toHaveLength(0);
  } finally {
    harness.model.release();
    await worker?.catch(() => undefined);
    await organizations.close();
    await harness.close();
  }
});

test('deleted chats reject checkpoint and run-output writes and block raw status writes', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const chat = await fixture.chat.create(0);
    const run = await fixture.database.withTenant(fixture.tenants[0]!, (tx) =>
      new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: fixture.tenants[0]!.orgId,
        initiatingUserId: fixture.tenants[0]!.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'private prompt',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      }),
    );
    await fixture.chat.linkAnswer(0, chat.id, run.id);
    const claimResult = await fixture.chat.claim(0, run.id);
    expect(claimResult).not.toBeNull();
    const claim = claimResult!.claim;
    const attemptId = await fixture.chat.insertAttempt(0, claim);
    expect(await fixture.chat.checkpoint(0, claim, attemptId)).toBe(true);
    const checkpoint = (await fixture.inspect.checkpoints(0, run.id))[0];
    expect(checkpoint).toBeDefined();
    expect(await fixture.chat.delete(0, chat.id)).toBe(true);
    expect(await fixture.chat.checkpoint(0, claim, attemptId)).toBe(false);
    expect(await fixture.chat.transitionOutput(0, run.id)).toBe(false);
    expect(await fixture.chat.claim(0, run.id)).toBeNull();
    await expect(
      fixture.chat.directCheckpointWrite(0, checkpoint.id),
    ).rejects.toThrow();
    expect(await fixture.chat.delete(0, chat.id)).toBe(false);
    await expect(fixture.chat.transitionStatus(0, run.id)).rejects.toThrow(
      /row-level security/i,
    );
    expect(await fixture.inspect.runs(run.id)).toMatchObject({
      status: 'queued',
    });
    expect(await fixture.chat.tree(0, chat.id)).toBeNull();
    expect(await fixture.inspect.chat(chat.id)).toMatchObject({
      deleted_at: expect.any(Date),
    });
    expect(await fixture.inspect.runs(run.id)).toMatchObject({
      partial_output: '',
      final_output: null,
    });
    expect(await fixture.inspect.outbox(chat.id)).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test('direct run-output SQL waits for deletion then fails without a deadlock or content change', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const chat = await fixture.chat.create(0);
    const tenant = fixture.tenants[0]!;
    const run = await fixture.database.withTenant(tenant, async (tx) => {
      return new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: tenant.orgId,
        initiatingUserId: tenant.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'private prompt',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      });
    });
    await fixture.chat.linkAnswer(0, chat.id, run.id);
    const locked = deferred();
    const release = deferred();
    const deletion = fixture.database.withTenant(tenant, async (tx) => {
      if (!(await new ChatRepository().lockLive(tx, chat.id)))
        throw new Error('Chat fixture lock unavailable');
      locked.resolve();
      await release.promise;
      if (!(await new ChatRepository().markDeleted(tx, chat.id)))
        throw new Error('Chat fixture delete unavailable');
    });
    await locked.promise;
    const writer = fixture.startDirectRunOutputWrite(tenant, run.id);
    const waiting = await fixture.waitForLockWait(await writer.pid);
    release.resolve();
    await deletion;
    expect(waiting).toBe(true);
    await expect(writer.done).rejects.toThrow();
    expect(await fixture.inspect.runs(run.id)).toMatchObject({
      partial_output: '',
      final_output: null,
    });
  } finally {
    await fixture.close();
  }
});

test('a real API actor and worker cannot persist a response after deletion commits during model I/O', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  let worker: Promise<unknown> | undefined;
  let claimGuard:
    Awaited<ReturnType<typeof harness.holdStepClaimGuard>> | undefined;
  try {
    const owner = await harness.client.identity.user('Chat membership owner');
    const actor = await harness.client.identity.user('Chat worker owner');
    const organization = await organizations.seedTeam([
      owner.profile.id,
      actor.profile.id,
    ]);
    const selection = await harness.client.identity.call(
      '/organizations/active',
      owner.headers,
      'POST',
      { organizationId: organization.id },
    );
    expect(selection.status).toBe(200);
    const member = organization.members.find(
      (candidate) => candidate.userId === actor.profile.id,
    )!;
    const ctx = { orgId: organization.id, userId: actor.profile.id };
    const chat = await harness.client.chat.createFor(ctx);
    const { runId } = await stage(
      harness.client.startAnswer(ctx, chat.id, 'Synthetic private prompt'),
      'start answer',
    );
    await stage(
      harness.associateStartedAnswer(ctx, chat.id, runId),
      'associate answer',
    );
    const job = harness.jobForAnswer(ctx, runId);
    claimGuard = await harness.holdStepClaimGuard(ctx);
    worker = harness.engine.execute(job, {
      signal: new AbortController().signal,
    });
    expect(await harness.waitForClaimLockWaiters(1)).toBe(true);
    const membershipRemoval = harness.client.identity.call(
      `/organizations/${organization.id}/members/${member.id}`,
      owner.headers,
      'DELETE',
    );
    const deletion = harness.client.chat.deleteFor(ctx, chat.id);
    expect(await harness.waitForClaimLockWaiters(2)).toBe(true);
    claimGuard.release();
    const [deleted, removed] = await stage(
      Promise.all([deletion, membershipRemoval]),
      'claim, chat deletion, and membership lock serialization',
    );
    expect(deleted).toBe(true);
    expect(removed.status, await removed.text()).toBe(204);
    harness.model.release();
    await stage(worker, 'worker settlement');
    expect(await harness.inspect.chat(chat.id)).toMatchObject({
      deleted_at: expect.any(Date),
    });
    expect(await harness.inspect.runs(runId)).toMatchObject({
      partial_output: '',
      final_output: null,
    });
    expect(await harness.inspect.tree(chat.id)).toEqual([]);
    expect(await harness.inspect.outbox(chat.id)).toHaveLength(1);
  } finally {
    claimGuard?.release();
    harness.model.release();
    await worker?.catch(() => undefined);
    await organizations.close();
    await harness.close();
  }
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function stage<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out at stage: ${label}`)),
          8_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
