import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { ChatMessageRepository } from '../../src/infrastructure/db/chat-message.repository.js';

test('ranked chat search returns owner matches and keeps search terms out of cursors', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-search-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const ownerIdentity = await identity(origin, owner);
    const firstId = randomUUID();
    const secondId = randomUUID();
    const secretTerm = `ranked-canary-${randomUUID()}`;
    await fixture.chat.createFor(ownerIdentity, firstId, 'First discussion');
    await fixture.chat.createFor(ownerIdentity, secondId, 'Second discussion');
    const messages = new ChatMessageRepository();
    await fixture.database.withTenant(ownerIdentity, async (tx) => {
      await messages.insertUser(tx, {
        chatId: firstId,
        messageId: randomUUID(),
        parentMessageId: null,
        text: `The ${secretTerm} governs this agreement`,
        effort: 'high',
      });
      await messages.insertUser(tx, {
        chatId: secondId,
        messageId: randomUUID(),
        parentMessageId: null,
        text: `A further ${secretTerm} discussion`,
        effort: 'high',
      });
    });

    const firstPageResponse = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ query: secretTerm, limit: 1 }),
    });
    expect(firstPageResponse.status).toBe(200);
    const firstPage = (await firstPageResponse.json()) as {
      items: Array<{ chatId: string; messageId: string | null; excerpt: string }>;
      pageInfo: { nextCursor: string | null };
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.messageId).toBeTruthy();
    expect(firstPage.items[0]?.excerpt).toContain(secretTerm);
    expect(firstPage.pageInfo.nextCursor).not.toContain(secretTerm);

    const secondPageResponse = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: secretTerm,
        limit: 1,
        cursor: firstPage.pageInfo.nextCursor,
      }),
    });
    expect(secondPageResponse.status).toBe(200);
    const secondPage = (await secondPageResponse.json()) as {
      items: Array<{ chatId: string }>;
    };
    expect(secondPage.items.map((item) => item.chatId)).toHaveLength(1);
    expect(secondPage.items[0]?.chatId).not.toBe(firstPage.items[0]?.chatId);

    const foreignResponse = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...foreign, 'content-type': 'application/json' },
      body: JSON.stringify({ query: secretTerm }),
    });
    expect(foreignResponse.status).toBe(200);
    expect((await foreignResponse.json()).items).toEqual([]);
  } finally {
    await app.close();
    await fixture.close();
  }
});

async function identity(
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
