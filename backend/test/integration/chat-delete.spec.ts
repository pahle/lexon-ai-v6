import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { CancelSignals } from '../../src/infrastructure/queue/cancel-signals.js';

test('owner delete commits the marker and cleanup outbox before hiding the chat', async ({
  services,
}) => {
  const config = loadRuntimeConfig(
    'api',
    createAuthEnvironment(services, '/tmp/lexon-chat-delete-health.json'),
  );
  const app = await createTestApi(config);
  const remoteApp = await createTestApi(config);
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    await remoteApp.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const remoteOrigin = await remoteApp.getUrl();
    const headers = await apiHeaders(app);
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Private content removed after request',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as { runId: string };

    const oldStream = await fetch(
      `${remoteOrigin}/api/runs/${mutation.runId}/events`,
      {
        headers,
        signal: AbortSignal.timeout(5_000),
      },
    );
    expect(oldStream.status).toBe(200);
    const reader = oldStream.body!.getReader();
    const decoder = new TextDecoder();
    let initialFrames = '';
    while (!initialFrames.includes(': connected\n\n')) {
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      initialFrames += decoder.decode(value, { stream: true });
    }
    const closed = (async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) return true;
      }
    })();

    const deleted = await fetch(`${origin}/api/chats/${input.chatId}`, {
      method: 'DELETE',
      headers,
    });

    expect(deleted.status).toBe(204);
    expect(await fixture.inspect.runStatus(mutation.runId)).toBe('cancelling');
    expect(
      await Promise.race([
        closed,
        new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]),
    ).toBe(true);
    expect(
      await fetch(`${origin}/api/chats/${input.chatId}`, { headers }),
    ).toMatchObject({ status: 404 });
    expect(
      await fetch(`${origin}/api/runs/${mutation.runId}/events`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      }),
    ).toMatchObject({ status: 404 });
    const jsonHeaders = { ...headers, 'content-type': 'application/json' };
    const fencedMutations = await Promise.all([
      fetch(`${origin}/api/chats/${input.chatId}/messages`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          userMessageId: randomUUID(),
          parentMessageId: input.userMessageId,
          text: 'must not be restored',
          effort: 'high',
        }),
      }),
      fetch(
        `${origin}/api/chats/${input.chatId}/messages/${mutation.runId}/edit`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            messageId: mutation.runId,
            newMessageId: randomUUID(),
            text: 'must not be restored',
            effort: 'high',
          }),
        },
      ),
      fetch(
        `${origin}/api/chats/${input.chatId}/messages/${mutation.runId}/regenerate`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            messageId: mutation.runId,
            requestId: randomUUID(),
          }),
        },
      ),
      fetch(`${origin}/api/chats/${input.chatId}/viewed-leaf`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ leafId: mutation.runId }),
      }),
    ]);
    expect(fencedMutations.map(({ status }) => status)).toEqual([
      404, 404, 404, 404,
    ]);
    const resurrection = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(resurrection.status).toBe(404);
    const outbox = await fixture.inspect.outbox(input.chatId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      type: 'chat.cleanup.v1',
      payload: { chatId: input.chatId },
    });
  } finally {
    await app.close();
    await remoteApp.close();
    await fixture.close();
  }
});

test('remote SSE rechecks durable authorization when deletion races initial admission', async ({
  services,
}) => {
  const config = loadRuntimeConfig(
    'api',
    createAuthEnvironment(services, '/tmp/lexon-chat-delete-race-health.json'),
  );
  const deletingApp = await createTestApi(config);
  const subscribingApp = await createTestApi(config);
  const fixture = await createChatFixture(services);
  const inspector = new Redis(services.valkey.streamsUrl);
  let releaseSubscribe!: () => void;
  let signalSubscribeReached!: () => void;
  const subscribeBarrier = new Promise<void>((resolve) => {
    releaseSubscribe = resolve;
  });
  const subscribeReached = new Promise<void>((resolve) => {
    signalSubscribeReached = resolve;
  });
  try {
    await deletingApp.listen(0, '127.0.0.1');
    await subscribingApp.listen(0, '127.0.0.1');
    const deleteOrigin = await deletingApp.getUrl();
    const subscribeOrigin = await subscribingApp.getUrl();
    const headers = await apiHeaders(deletingApp);
    const identity = (await (
      await fetch(`${deleteOrigin}/api/identity`, { headers })
    ).json()) as { user: { id: string } };
    const chatId = randomUUID();
    const created = await fetch(`${deleteOrigin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'handshake race content',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };

    const signals = subscribingApp.get(CancelSignals);
    const subscribeDeletion = signals.subscribeDeletion.bind(signals);
    signals.subscribeDeletion = async (...args) => {
      signalSubscribeReached();
      await subscribeBarrier;
      return subscribeDeletion(...args);
    };
    const pendingStream = fetch(`${subscribeOrigin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    await subscribeReached;
    const deleted = await fetch(`${deleteOrigin}/api/chats/${chatId}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleted.status).toBe(204);
    releaseSubscribe();
    const response = await pendingStream;
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('handshake race content');

    signals.subscribeDeletion = subscribeDeletion;
    const secondChatId = randomUUID();
    const secondCreated = await fetch(`${deleteOrigin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: secondChatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'subscription return race content',
        effort: 'high',
      }),
    });
    expect(secondCreated.status).toBe(201);
    const secondRunId = ((await secondCreated.json()) as { runId: string })
      .runId;
    let releaseReturn!: () => void;
    let signalReturnReady!: () => void;
    const returnBarrier = new Promise<void>((resolve) => {
      releaseReturn = resolve;
    });
    const returnReady = new Promise<void>((resolve) => {
      signalReturnReady = resolve;
    });
    signals.subscribeDeletion = async (...args) => {
      const unsubscribe = await subscribeDeletion(...args);
      signalReturnReady();
      await returnBarrier;
      return unsubscribe;
    };
    const responseNotOpened = fetch(
      `${subscribeOrigin}/api/runs/${secondRunId}/events`,
      { headers, signal: AbortSignal.timeout(5_000) },
    );
    await returnReady;
    const secondDeleted = await fetch(
      `${deleteOrigin}/api/chats/${secondChatId}`,
      { method: 'DELETE', headers },
    );
    expect(secondDeleted.status).toBe(204);
    releaseReturn();
    const notOpened = await responseNotOpened;
    expect(notOpened.status).toBe(404);
    expect(notOpened.headers.get('content-type')).not.toContain(
      'text/event-stream',
    );
    expect(await notOpened.text()).not.toContain(
      'subscription return race content',
    );
    const channels = (await inspector.call(
      'PUBSUB',
      'NUMSUB',
      `${services.queuePrefix}:ai-cancel:deleted:${secondRunId}`,
    )) as [string, number | string][];
    expect(Number(channels[1])).toBe(0);
    const leaseCount = await inspector.zcard(
      `${services.queuePrefix}:{sse-connections}:${identity.user.id}`,
    );
    expect(leaseCount).toBe(0);
  } finally {
    releaseSubscribe();
    inspector.disconnect();
    await deletingApp.close();
    await subscribingApp.close();
    await fixture.close();
  }
});

test('remote SSE fails closed when the shared deletion subscriber is lost and reconnects', async ({
  services,
}) => {
  const config = loadRuntimeConfig(
    'api',
    createAuthEnvironment(
      services,
      '/tmp/lexon-chat-delete-subscriber-loss.json',
    ),
  );
  const owner = await createTestApi(config);
  const remote = await createTestApi(config);
  const inspector = new Redis(services.valkey.streamsUrl);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await owner.listen(0, '127.0.0.1');
    await remote.listen(0, '127.0.0.1');
    const ownerOrigin = await owner.getUrl();
    const remoteOrigin = await remote.getUrl();
    const headers = await apiHeaders(owner);
    const chatId = randomUUID();
    const created = await fetch(`${ownerOrigin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'subscriber loss proof',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const response = await fetch(`${remoteOrigin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    let initial = '';
    while (
      !initial.includes('snapshot-end') ||
      !initial.includes(': connected\n\n')
    ) {
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      initial += new TextDecoder().decode(value);
    }

    const clientsBefore = String(await inspector.client('LIST'));
    const named = clientsBefore
      .split('\n')
      .filter((line) =>
        line.includes(
          `name=lexon-chat-deletion-revocations:${services.queuePrefix}`,
        ),
      );
    expect(named).toHaveLength(1);
    const subscriber = named.find((line) => line.includes('flags=P'));
    expect(subscriber).toBeDefined();
    const subscriberId = /(?:^| )id=(\d+)(?: |$)/.exec(subscriber!)?.[1];
    expect(subscriberId).toBeDefined();
    expect(await inspector.call('CLIENT', 'KILL', 'ID', subscriberId!)).toBe(1);

    const lostConnectionClosed = await Promise.race([
      (async () => {
        for (;;) {
          const { done } = await reader!.read();
          if (done) return true;
        }
      })(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    expect(lostConnectionClosed).toBe(true);

    const recovered = await fetch(`${remoteOrigin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    expect(recovered.status).toBe(200);
    const recoveredReader = recovered.body!.getReader();
    let recoveryFrames = '';
    while (
      !recoveryFrames.includes('snapshot-end') ||
      !recoveryFrames.includes(': connected\n\n')
    ) {
      const { done, value } = await recoveredReader.read();
      expect(done).toBe(false);
      recoveryFrames += new TextDecoder().decode(value);
    }
    const clientsAfter = String(await inspector.client('LIST'));
    expect(
      clientsAfter
        .split('\n')
        .filter((line) =>
          line.includes(
            `name=lexon-chat-deletion-revocations:${services.queuePrefix}`,
          ),
        ),
    ).toHaveLength(1);
    expect(
      await fetch(`${ownerOrigin}/api/chats/${chatId}`, {
        method: 'DELETE',
        headers,
      }),
    ).toMatchObject({ status: 204 });
    const recoveredStreamClosed = await Promise.race([
      (async () => {
        for (;;) {
          const { done } = await recoveredReader.read();
          if (done) return true;
        }
      })(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    expect(recoveredStreamClosed).toBe(true);
    await recoveredReader.cancel();
  } finally {
    await reader?.cancel().catch(() => {});
    inspector.disconnect();
    await owner.close();
    await remote.close();
  }
});

test('delete transaction failure rolls back the marker and cleanup outbox', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-delete-rollback-health.json',
      ),
    ),
  );
  const fixture = await createChatFixture(services);
  let removeAuditFailure: (() => Promise<void>) | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Deletion rollback fixture',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    removeAuditFailure = await fixture.inspect.failChatDeletionAuditInsert();

    const deleted = await fetch(`${origin}/api/chats/${input.chatId}`, {
      method: 'DELETE',
      headers,
    });

    expect(deleted.status).toBe(500);
    const state = await fixture.inspect.deletionRequestState(input.chatId);
    expect(state).toEqual({ deletedAt: null, cleanupJobs: 0 });
  } finally {
    await removeAuditFailure?.();
    await app.close();
    await fixture.close();
  }
});

test('delete transaction durably marks active runs cancelling before post-commit wakeup', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-delete-durable-cancel-health.json',
      ),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Durable cancellation state',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as { runId: string };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as {
      user: { id: string };
      organization: { id: string };
    };

    const state = await fixture.inspect.requestDeletionStatusInsideTransaction(
      { orgId: identity.organization.id, userId: identity.user.id },
      input.chatId,
      mutation.runId,
    );

    expect(state).toEqual({ accepted: true, runStatus: 'cancelling' });
  } finally {
    await app.close();
    await fixture.close();
  }
});
