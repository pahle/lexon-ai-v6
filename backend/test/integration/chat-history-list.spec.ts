import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

test('chat history is cursor paginated, bounded, owner scoped, and excludes deleted chats', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-history-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const identity = await readIdentity(origin, owner);
    const chatIds = Array.from({ length: 4 }, () => randomUUID());
    for (const [index, chatId] of chatIds.entries())
      await fixture.chat.createFor(identity, chatId, `History ${index}`);
    await fixture.chat.deleteFor(identity, chatIds[3]!);

    const firstResponse = await fetch(`${origin}/api/chats?limit=2`, {
      headers: owner,
    });
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(200);
    const first = (await firstResponse.json()) as {
      items: Array<{ id: string }>;
      pageInfo: { nextCursor: string | null };
    };
    expect(first.items).toHaveLength(2);
    expect(first.pageInfo.nextCursor).toBeTruthy();

    const secondResponse = await fetch(
      `${origin}/api/chats?limit=2&cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`,
      { headers: owner },
    );
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as {
      items: Array<{ id: string }>;
      pageInfo: { nextCursor: string | null };
    };
    const listedIds = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(listedIds).size).toBe(listedIds.length);
    expect(listedIds).toHaveLength(3);
    expect(listedIds).not.toContain(chatIds[3]);

    const foreignResponse = await fetch(`${origin}/api/chats?limit=10`, {
      headers: foreign,
    });
    expect(foreignResponse.status).toBe(200);
    expect((await foreignResponse.json()).items).toEqual([]);
  } finally {
    await app.close();
    await fixture.close();
  }
});

async function readIdentity(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const response = await fetch(`${origin}/api/identity`, { headers });
  const body = (await response.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  return { orgId: body.organization.id, userId: body.user.id };
}
