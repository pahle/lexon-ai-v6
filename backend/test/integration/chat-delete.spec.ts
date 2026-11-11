import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

test('owner delete commits the marker and cleanup outbox before hiding the chat', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-delete-health.json'),
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
      `${origin}/api/runs/${mutation.runId}/events`,
      {
        headers,
        signal: AbortSignal.timeout(5_000),
      },
    );
    expect(oldStream.status).toBe(200);
    const reader = oldStream.body!.getReader();
    await reader.read();
    const closed = reader.read().then(({ done }) => done);

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
    await fixture.close();
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
