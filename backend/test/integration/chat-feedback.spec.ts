import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

test('owner can set, change, and clear one answer feedback rating', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-feedback-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const chatId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Synthetic feedback test input',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as { runId: string };
    const endpoint = `${origin}/api/chats/${chatId}/messages/${mutation.runId}/feedback`;

    const setGood = await feedback(endpoint, owner, 'good');
    expect(setGood.status).toBe(204);
    await expectFeedback(origin, owner, chatId, mutation.runId, 'good');
    const changeToBad = await feedback(endpoint, owner, 'bad');
    expect(changeToBad.status).toBe(204);
    await expectFeedback(origin, owner, chatId, mutation.runId, 'bad');
    const clear = await feedback(endpoint, owner, null);
    expect(clear.status).toBe(204);

    await expectFeedback(origin, owner, chatId, mutation.runId, null);

    const audit = await fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type='chat.message_feedback.v1' AND metadata->>'chatId'=$1
       ORDER BY occurred_at,event_id`,
      [chatId],
    );
    const auditRows = audit.rows as Array<{
      type: string;
      metadata: Record<string, string>;
    }>;
    expect(auditRows.map((row) => row.metadata.action)).toEqual([
      'set',
      'changed',
      'cleared',
    ]);
    expect(auditRows.every((row) =>
      Object.keys(row.metadata).every((key) =>
        ['chatId', 'messageId', 'runId', 'action'].includes(key),
      ),
    )).toBe(true);
    expect(JSON.stringify(auditRows)).not.toMatch(/good|bad|Synthetic feedback test input/);
    expect((await fixture.chat.feedbackWithoutTenant(chatId, mutation.runId).then((result) => result.rows)))
      .toEqual([]);
    const feedbackPolicy = await fixture.inspect.query(
      `SELECT relrowsecurity,relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='app' AND c.relname='message_feedback'`,
    );
    expect(feedbackPolicy.rows[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
    });

    const foreignWrite = await feedback(endpoint, foreign, 'good');
    expect(foreignWrite.status).toBe(404);
    const unknownMessage = await feedback(
      `${origin}/api/chats/${chatId}/messages/${randomUUID()}/feedback`,
      owner,
      'good',
    );
    expect(unknownMessage.status).toBe(404);

    const deleted = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'DELETE',
      headers: owner,
    });
    expect(deleted.status).toBe(204);
    expect((await feedback(endpoint, owner, 'good')).status).toBe(404);
  } finally {
    await app.close();
    await fixture.close();
  }
});

async function feedback(
  endpoint: string,
  headers: Record<string, string>,
  rating: 'good' | 'bad' | null,
) {
  return fetch(endpoint, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ rating }),
  });
}

async function expectFeedback(
  origin: string,
  headers: Record<string, string>,
  chatId: string,
  messageId: string,
  rating: 'good' | 'bad' | null,
) {
  const response = await fetch(`${origin}/api/chats/${chatId}`, { headers });
  expect(response.status).toBe(200);
  const tree = (await response.json()) as {
    messages: Array<{ id: string; feedback: 'good' | 'bad' | null }>;
  };
  expect(tree.messages.find((message) => message.id === messageId)?.feedback).toBe(rating);
}
