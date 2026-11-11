import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

test('owner can set, change, and clear one answer feedback rating', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-feedback-health.json'),
    ),
  );
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
    const changeToBad = await feedback(endpoint, owner, 'bad');
    expect(changeToBad.status).toBe(204);
    const clear = await feedback(endpoint, owner, null);
    expect(clear.status).toBe(204);

    const foreignWrite = await feedback(endpoint, foreign, 'good');
    expect(foreignWrite.status).toBe(404);
    const unknownMessage = await feedback(
      `${origin}/api/chats/${chatId}/messages/${randomUUID()}/feedback`,
      owner,
      'good',
    );
    expect(unknownMessage.status).toBe(404);
  } finally {
    await app.close();
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
