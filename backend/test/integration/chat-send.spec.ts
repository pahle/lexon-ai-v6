import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { ChatTreeSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  TenantDatabase,
  AiRunRepository,
} from '../../src/infrastructure/db/index.js';

test('POST /api/chats creates the first user message and answer run', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-send-health.json'),
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
      text: 'A first legal question',
      effort: 'high',
    };
    const post = () =>
      fetch(`${origin}/api/chats`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    const [first, second] = await Promise.all([post(), post()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstResult = (await first.json()) as Record<string, unknown>;
    const secondResult = (await second.json()) as Record<string, unknown>;
    expect(firstResult).toMatchObject({
      chatId: input.chatId,
      userMessageId: input.userMessageId,
      assistantMessageId: expect.any(String),
      runId: expect.any(String),
    });
    expect(secondResult).toEqual(firstResult);
    const treeResponse = await fetch(`${origin}/api/chats/${input.chatId}`, {
      headers,
    });
    expect(treeResponse.status).toBe(200);
    const tree = ChatTreeSchema.parse(await treeResponse.json());
    expect(tree.messages).toHaveLength(2);

    expect(
      await fixture.inspect.mutationCounts({
        chatId: input.chatId,
        runId: String(firstResult.runId),
      }),
    ).toEqual({
      messages: '2',
      answers: '1',
      create_requests: '1',
      runs: '1',
      start_outbox: '1',
      start_audit: '1',
      chat_audit: '2',
      slots: '1',
    });
    expect(await fixture.inspect.chatAudit(input.chatId)).toEqual([
      {
        type: 'chat.created.v1',
        metadata: { chatId: input.chatId },
      },
      {
        type: 'chat.message_sent.v1',
        metadata: { chatId: input.chatId, messageId: input.userMessageId },
      },
    ]);
    await expect(
      fixture.inspect.insertRawAudit({
        eventId: randomUUID(),
        actorUserId: '00000000-0000-4000-8000-000000000001',
        orgId: '00000000-0000-4000-8000-000000000002',
        metadata: {
          chatId: input.chatId,
          prompt: 'must not enter chat audit',
        },
      }),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('create and send reject whitespace-only text with a fixed validation error', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-send-health.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const post = (url: string, body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const invalidCreate = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: ' \t\n ',
      effort: 'high',
    };
    const createResponse = await post(`${origin}/api/chats`, invalidCreate);
    const createError = await createResponse.json();

    const validCreate = {
      ...invalidCreate,
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Valid initial question',
    };
    const created = await post(`${origin}/api/chats`, validCreate);
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    const tenant = {
      orgId: identity.organization.id,
      userId: identity.user.id,
    };
    const terminalized = await app
      .get(TenantDatabase)
      .withTenant(tenant, (tx) =>
        new AiRunRepository().transition(tx, {
          runId: mutation.runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'completed',
          finalizeOutput: true,
        }),
      );
    expect(terminalized).toBe(true);
    const invalidSend = await post(
      `${origin}/api/chats/${validCreate.chatId}/messages`,
      {
        userMessageId: randomUUID(),
        parentMessageId: mutation.assistantMessageId,
        text: ' \t\n ',
        effort: 'high',
      },
    );
    const sendError = await invalidSend.json();
    expect([createResponse.status, invalidSend.status]).toEqual([400, 400]);
    expect(createError).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
    expect(sendError).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  } finally {
    await app.close();
  }
});

test('a create failure after engine start rolls back chat, messages, run, outbox, slot and audit', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-send-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  let removeFailure: (() => Promise<void>) | undefined;
  try {
    removeFailure = await fixture.inspect.failChatCreateRequestInsert();
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: `atomic rollback ${randomUUID()}`,
      effort: 'high',
    };
    const response = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(input.text);
    expect(
      await fixture.inspect.rollbackCounts({
        chatId: input.chatId,
        prompt: input.text,
      }),
    ).toEqual({
      chats: '0',
      messages: '0',
      runs: '0',
      outbox: '0',
      audit: '0',
      chat_audit: '0',
      slots: '0',
    });
  } finally {
    await app.close();
    await removeFailure?.();
    await fixture.close();
  }
});

test('send retries preserve identity, reject changed content and block a second active answer', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-send-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const initial = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Initial question',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(initial),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    const tenant = {
      orgId: identity.organization.id,
      userId: identity.user.id,
    };
    const database = app.get(TenantDatabase);
    const runs = new AiRunRepository();
    const transition = (
      runId: string,
      expectedVersion: number,
      from: string,
      to: string,
    ) =>
      database.withTenant(tenant, (tx) =>
        runs.transition(tx, {
          runId,
          expectedVersion,
          from: from as
            'queued' | 'running' | 'awaiting_approval' | 'cancelling',
          to: to as
            | 'running'
            | 'awaiting_approval'
            | 'cancelling'
            | 'cancelled'
            | 'completed',
        }),
      );
    expect(await transition(mutation.runId, 1, 'queued', 'running')).toBe(true);

    const send = {
      userMessageId: randomUUID(),
      parentMessageId: mutation.assistantMessageId,
      text: 'A follow-up question',
      effort: 'max',
    };
    const post = () =>
      fetch(`${origin}/api/chats/${initial.chatId}/messages`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(send),
      });
    const blocked = async () => {
      const response = await fetch(
        `${origin}/api/chats/${initial.chatId}/messages`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ ...send, userMessageId: randomUUID() }),
        },
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('CHAT_CONFLICT');
    };
    await blocked();
    expect(
      await transition(mutation.runId, 2, 'running', 'awaiting_approval'),
    ).toBe(true);
    await blocked();
    expect(
      await transition(mutation.runId, 3, 'awaiting_approval', 'cancelling'),
    ).toBe(true);
    await blocked();
    expect(await transition(mutation.runId, 4, 'cancelling', 'cancelled')).toBe(
      true,
    );
    const [first, second] = await Promise.all([post(), post()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstResult = (await first.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    const secondResult = await second.json();
    expect(secondResult).toEqual(firstResult);

    const changed = await fetch(
      `${origin}/api/chats/${initial.chatId}/messages`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...send, text: 'Changed follow-up content' }),
      },
    );
    expect(changed.status).toBe(409);
    expect((await changed.json()).error.code).toBe('CHAT_CONFLICT');

    const secondNewMessage = await fetch(
      `${origin}/api/chats/${initial.chatId}/messages`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...send, userMessageId: randomUUID() }),
      },
    );
    expect(secondNewMessage.status).toBe(409);
    expect((await secondNewMessage.json()).error.code).toBe('CHAT_CONFLICT');

    expect(await transition(firstResult.runId, 1, 'queued', 'completed')).toBe(
      true,
    );
    const beforeRace = await fixture.inspect.chatSendSnapshot(initial.chatId);
    const distinctSends = [
      {
        userMessageId: randomUUID(),
        parentMessageId: firstResult.assistantMessageId,
        text: 'Concurrent distinct send one',
        effort: 'high',
      },
      {
        userMessageId: randomUUID(),
        parentMessageId: firstResult.assistantMessageId,
        text: 'Concurrent distinct send two',
        effort: 'high',
      },
    ];
    const raceResponses = await Promise.all(
      distinctSends.map((body) =>
        fetch(`${origin}/api/chats/${initial.chatId}/messages`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    );
    expect(raceResponses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const winner = raceResponses.find((response) => response.status === 201)!;
    const winnerResult = (await winner.json()) as {
      userMessageId: string;
      runId: string;
    };
    expect(
      distinctSends.some(
        (send) => send.userMessageId === winnerResult.userMessageId,
      ),
    ).toBe(true);
    const conflict = raceResponses.find((response) => response.status === 409)!;
    expect((await conflict.json()).error.code).toBe('CHAT_CONFLICT');
    const afterRace = await fixture.inspect.chatSendSnapshot(initial.chatId);
    expect(afterRace).toEqual({
      messages: String(Number(beforeRace.messages) + 2),
      answers: String(Number(beforeRace.answers) + 1),
      runs: String(Number(beforeRace.runs) + 1),
      start_outbox: String(Number(beforeRace.start_outbox) + 1),
      start_audit: String(Number(beforeRace.start_audit) + 1),
      message_audit: String(Number(beforeRace.message_audit) + 1),
      slots: String(Number(beforeRace.slots) + 1),
    });
    expect(await fixture.inspect.chat(initial.chatId)).toMatchObject({
      active_answer_run_id: winnerResult.runId,
    });
    expect(
      await fixture.chat.chatRunAssociatedWithoutTenant({
        orgId: tenant.orgId,
        userId: tenant.userId,
        runId: winnerResult.runId,
      }),
    ).toMatchObject({ rows: [{ associated: true }] });
  } finally {
    await app.close();
    await fixture.close();
  }
});
