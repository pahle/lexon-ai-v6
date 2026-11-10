import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  AiRunRepository,
  ChatRepository,
} from '../../src/infrastructure/db/index.js';
import { test } from '../setup/file-services.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createChatApiHarness } from '../setup/chat-api-harness.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';

test('deleted chats reject checkpoint and run-output writes while allowing lifecycle settlement', async ({
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
    expect(await fixture.chat.transitionStatus(0, run.id)).toBe(true);
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
