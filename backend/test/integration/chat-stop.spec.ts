import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { ChatTreeSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
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
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Question to stop',
        effort: 'high',
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

    const retry = await fetch(`${origin}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        userMessageId: randomUUID(),
        parentMessageId: mutation.assistantMessageId,
        text: 'Try again from the stopped turn',
        effort: 'high',
      }),
    });
    expect(retry.status).toBe(201);
    const retryResult = (await retry.json()) as { runId: string };
    const retryRun = await app
      .get(TenantDatabase)
      .withTenant(
        { orgId: identity.organization.id, userId: identity.user.id },
        (tx) => new AiRunRepository().find(tx, retryResult.runId),
      );
    expect(retryRun?.resolvedConfig).toMatchObject({ resolvedEffort: 'high' });
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
