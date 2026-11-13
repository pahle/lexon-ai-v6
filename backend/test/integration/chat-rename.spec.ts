import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { RenameChatInputSchema, UuidSchema } from '@lexon/contracts';

test('chat rename route trims, limits and keeps owner and tenant authorization', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-rename-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const identityResponse = await fetch(`${origin}/api/identity`, {
      headers: owner,
    });
    const identity = (await identityResponse.json()) as {
      orgId?: string;
      userId?: string;
      organization?: { id: string };
      user?: { id: string };
    };
    const tenant = {
      orgId: identity.organization?.id ?? identity.orgId!,
      userId: identity.user?.id ?? identity.userId!,
    };
    const chatId = randomUUID();
    expect(UuidSchema.safeParse(chatId).success).toBe(true);
    expect(
      RenameChatInputSchema.safeParse({ title: 'Owner title' }).success,
    ).toBe(true);
    await fixture.chat.createFor(tenant, chatId, 'Original title');
    expect(
      (await fetch(`${origin}/api/chats/${chatId}`, { headers: owner })).status,
    ).toBe(200);

    const renamed = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Owner title' }),
    });
    expect(renamed.status, await renamed.clone().text()).toBe(204);
    const tree = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: owner,
    });
    expect((await tree.json()).title).toBe('Owner title');

    const boundaryTitle = 'B'.repeat(120);
    const boundary = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: boundaryTitle }),
    });
    expect(boundary.status, await boundary.clone().text()).toBe(204);

    const tooLong = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '😀'.repeat(121) }),
    });
    expect(tooLong.status).toBe(400);
    const unchanged = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: owner,
    });
    expect((await unchanged.json()).title).toBe(boundaryTitle);

    const hidden = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...foreign, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Foreign title' }),
    });
    expect(hidden.status).toBe(404);
    const noSession = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: owner.origin! },
      body: JSON.stringify({ title: 'No session' }),
    });
    expect(noSession.status).toBe(401);
  } finally {
    await app.close();
    await fixture.close();
  }
});
