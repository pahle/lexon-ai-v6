import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { ChatTreeSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createChatApiHarness } from '../setup/chat-api-harness.js';
import {
  AiRunRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';

test('owner stop retains one partial answer, clears busy state, and terminal repeats are no-ops', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-stop-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const sourceUserId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: sourceUserId,
        requestId: randomUUID(),
        text: 'Question to stop',
        effort: 'max',
      }),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    const partial = 'Answer text retained at stop.';
    await fixture.chat.setRunOutputFor(
      { orgId: identity.organization.id, userId: identity.user.id },
      mutation.runId,
      partial,
    );

    const stop = () =>
      fetch(`${origin}/api/runs/${mutation.runId}/cancel`, {
        method: 'POST',
        headers,
      });
    const firstStop = await stop();
    expect(firstStop.status).toBe(201);
    const secondStop = await stop();
    expect(secondStop.status).toBe(201);

    const run = await app
      .get(TenantDatabase)
      .withTenant(
        { orgId: identity.organization.id, userId: identity.user.id },
        (tx) => new AiRunRepository().find(tx, mutation.runId),
      );
    expect(run?.status).toBe('cancelled');
    expect(run?.partialOutput).toBe(partial);

    const treeResponse = await fetch(`${origin}/api/chats/${chatId}`, {
      headers,
    });
    const tree = ChatTreeSchema.parse(await treeResponse.json());
    expect(
      tree.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(1);
    expect(
      tree.messages.find(
        (message) => message.id === mutation.assistantMessageId,
      ),
    ).toMatchObject({
      role: 'assistant',
      status: 'cancelled',
      text: partial,
    });
    expect(await fixture.inspect.chat(chatId)).toMatchObject({
      active_answer_run_id: null,
    });

    const retryRequestId = randomUUID();
    const retry = await fetch(
      `${origin}/api/chats/${chatId}/messages/${mutation.assistantMessageId}/regenerate`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: mutation.assistantMessageId,
          requestId: retryRequestId,
        }),
      },
    );
    expect(retry.status).toBe(201);
    const retryResult = (await retry.json()) as {
      userMessageId: string;
      assistantMessageId: string;
      runId: string;
    };
    expect(retryResult).toMatchObject({
      userMessageId: sourceUserId,
      assistantMessageId: retryResult.runId,
    });
    expect(retryResult.assistantMessageId).not.toBe(
      mutation.assistantMessageId,
    );
    const retryRun = await app
      .get(TenantDatabase)
      .withTenant(
        { orgId: identity.organization.id, userId: identity.user.id },
        (tx) => new AiRunRepository().find(tx, retryResult.runId),
      );
    expect(retryRun?.resolvedConfig).toMatchObject({ resolvedEffort: 'max' });
    const retriedTree = ChatTreeSchema.parse(
      await (await fetch(`${origin}/api/chats/${chatId}`, { headers })).json(),
    );
    expect(
      retriedTree.messages.filter((message) => message.role === 'user'),
    ).toHaveLength(1);
    expect(
      retriedTree.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(2);
    expect(
      retriedTree.messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.parentId),
    ).toEqual([sourceUserId, sourceUserId]);
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('HTTP stop keeps the answer busy until the blocked worker acknowledges cancellation', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const redis = new Redis(services.valkey.streamsUrl);
  const controller = new AbortController();
  let execution: Promise<void> | undefined;
  try {
    const actor = await harness.client.identity.user('Blocked stop owner');
    const identity = (await (
      await harness.client.identity.call('/identity', actor.headers)
    ).json()) as { organization: { id: string } };
    const ctx = { orgId: identity.organization.id, userId: actor.profile.id };
    harness.model.blockAfterText();
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const created = await harness.client.identity.call(
      '/chats',
      actor.headers,
      'POST',
      {
        chatId,
        userMessageId,
        requestId: randomUUID(),
        text: 'Question whose answer is stopped',
        effort: 'max',
      },
    );
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    execution = harness.engine
      .execute(harness.jobForAnswer(ctx, mutation.runId), {
        signal: controller.signal,
      })
      .then(() => undefined);
    await harness.model.block();

    await expect
      .poll(
        async () => {
          const treeResponse = await harness.client.identity.call(
            `/chats/${chatId}`,
            actor.headers,
          );
          const tree = ChatTreeSchema.parse(await treeResponse.json());
          return tree.messages.find(
            (message) => message.id === mutation.assistantMessageId,
          );
        },
        { timeout: 5000, interval: 50 },
      )
      .toMatchObject({ role: 'assistant', text: 'synthetic partial answer' });
    expect(await harness.inspect.chat(chatId)).toMatchObject({
      active_answer_run_id: mutation.runId,
    });

    const stop = await harness.client.identity.call(
      `/runs/${mutation.runId}/cancel`,
      actor.headers,
      'POST',
    );
    expect(stop.status).toBe(201);
    await harness.model.aborted;
    const cancellingRun = await harness.engine.inspect(ctx, mutation.runId);
    expect(cancellingRun?.status).toBe('cancelling');
    expect(await harness.inspect.chat(chatId)).toMatchObject({
      active_answer_run_id: mutation.runId,
    });
    expect(await harness.inspect.capacity(mutation.runId)).toHaveLength(1);
    harness.model.release();
    await execution;
    execution = undefined;
    const stoppedTree = ChatTreeSchema.parse(
      await (
        await harness.client.identity.call(`/chats/${chatId}`, actor.headers)
      ).json(),
    );
    const repeatedStop = await harness.client.identity.call(
      `/runs/${mutation.runId}/cancel`,
      actor.headers,
      'POST',
    );
    expect(repeatedStop.status).toBe(201);

    expect(
      stoppedTree.messages.filter(
        (message) =>
          message.role === 'assistant' &&
          message.id === mutation.assistantMessageId,
      ),
    ).toMatchObject([
      {
        status: 'cancelled',
        text: 'synthetic partial answer',
        reasoningDurationMs: null,
      },
    ]);
    expect(await harness.inspect.chat(chatId)).toMatchObject({
      active_answer_run_id: null,
    });
    expect(await harness.inspect.capacity(mutation.runId)).toHaveLength(0);
    const streamKey = `${services.queuePrefix}:{run-streams}:${mutation.runId}:events`;
    const streamEntries = await redis.xrange(streamKey, '-', '+');
    const events = streamEntries.map(([, fields]) =>
      JSON.parse(fields[fields.indexOf('event') + 1]!),
    );
    expect(events.filter((event) => event.type === 'finish')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'finish' });

    const finalRun = await harness.engine.inspect(ctx, mutation.runId);
    expect(finalRun).toMatchObject({
      status: 'cancelled',
      partialOutput: 'synthetic partial answer',
    });
  } finally {
    harness.model.release();
    await execution?.catch(() => undefined);
    controller.abort();
    redis.disconnect();
    await harness.close();
  }
});

test('stop rejects nonowners, foreign organizations, deleted chats, and revoked owners without side effects', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-stop-authz-health.json'),
    ),
  );
  const organizations = createOrganizationInspector(services);
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const peer = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const identity = async (headers: Record<string, string>) =>
      (await (await fetch(`${origin}/api/identity`, { headers })).json()) as {
        user: { id: string };
      };
    const ownerId = (await identity(owner)).user.id;
    const peerId = (await identity(peer)).user.id;
    const team = await organizations.seedTeam([ownerId, peerId]);
    for (const headers of [owner, peer]) {
      expect(
        (
          await fetch(`${origin}/api/organizations/active`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ organizationId: team.id }),
          })
        ).status,
      ).toBe(200);
    }
    const createChat = async (
      headers: Record<string, string>,
      chatId: string,
      userMessageId: string,
    ) => {
      const response = await fetch(`${origin}/api/chats`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          chatId,
          userMessageId,
          requestId: randomUUID(),
          text: 'Stop authorization fixture',
          effort: 'max',
        }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as {
        userMessageId: string;
        assistantMessageId: string;
        runId: string;
      };
    };
    const nonownerChatId = randomUUID();
    const nonownerRun = await createChat(owner, nonownerChatId, randomUUID());
    const nonownerBaseline =
      await fixture.inspect.chatSendSnapshot(nonownerChatId);
    for (const headers of [peer, foreign]) {
      const rejected = await fetch(
        `${origin}/api/runs/${nonownerRun.runId}/cancel`,
        { method: 'POST', headers },
      );
      expect(rejected.status).toBe(404);
      expect(await fixture.inspect.chatSendSnapshot(nonownerChatId)).toEqual(
        nonownerBaseline,
      );
      expect(await fixture.inspect.runStatus(nonownerRun.runId)).toBe('queued');
      expect(await fixture.inspect.chat(nonownerChatId)).toMatchObject({
        active_answer_run_id: nonownerRun.runId,
      });
    }

    await fixture.chat.deleteFor(
      { orgId: team.id, userId: ownerId },
      nonownerChatId,
    );
    const deletedBaseline =
      await fixture.inspect.chatSendSnapshot(nonownerChatId);
    const deletedStop = await fetch(
      `${origin}/api/runs/${nonownerRun.runId}/cancel`,
      { method: 'POST', headers: owner },
    );
    expect(deletedStop.status).toBe(404);
    expect(await fixture.inspect.chatSendSnapshot(nonownerChatId)).toEqual(
      deletedBaseline,
    );
    expect(await fixture.inspect.runStatus(nonownerRun.runId)).toBe('queued');

    const revokedChatId = randomUUID();
    const revokedRun = await createChat(peer, revokedChatId, randomUUID());
    const revokedBaseline =
      await fixture.inspect.chatSendSnapshot(revokedChatId);
    const peerMember = team.members.find((member) => member.userId === peerId)!;
    await organizations.mutateMember(peerMember.id, 'delete');
    const revokedStop = await fetch(
      `${origin}/api/runs/${revokedRun.runId}/cancel`,
      { method: 'POST', headers: peer },
    );
    expect(revokedStop.status).toBe(404);
    expect(await fixture.inspect.chatSendSnapshot(revokedChatId)).toEqual(
      revokedBaseline,
    );
    expect(await fixture.inspect.runStatus(revokedRun.runId)).toBe('queued');
    expect(await fixture.inspect.chat(revokedChatId)).toMatchObject({
      active_answer_run_id: revokedRun.runId,
    });
  } finally {
    await app.close();
    await organizations.close();
    await fixture.close();
  }
});
