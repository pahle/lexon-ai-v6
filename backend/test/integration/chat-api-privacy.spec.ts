import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

test('chat API rejects unauthenticated, malformed and cross-origin cookie mutations without reflecting input', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-privacy-health.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const chatId = randomUUID();
    const unauthenticated = await fetch(`${origin}/api/chats/${chatId}`);
    expect(unauthenticated.status).toBe(401);

    const headers = await apiHeaders(app);
    const canary = `private-chat-canary-${randomUUID()}`;
    const invalid = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: {
        ...headers,
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: canary,
        effort: 'high',
        unknown: canary,
      }),
    });
    expect(invalid.status).toBe(403);
    expect(await invalid.text()).not.toContain(canary);

    const badShape = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: canary,
        effort: 'high',
        unknown: canary,
      }),
    });
    expect(badShape.status).toBe(400);
    expect(await badShape.text()).not.toContain(canary);

    const missingOrigin = await fetch(
      `${origin}/api/chats/${chatId}/messages`,
      {
        method: 'POST',
        headers: {
          cookie: headers.cookie!,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userMessageId: randomUUID(),
          parentMessageId: randomUUID(),
          text: canary,
          effort: 'high',
        }),
      },
    );
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.text()).not.toContain(canary);
  } finally {
    await app.close();
  }
});

test('chat ids are owner-scoped and missing or foreign ids share the same safe response', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-privacy-health.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'private owner chat',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const ownRead = await fetch(`${origin}/api/chats/${input.chatId}`, {
      headers: owner,
    });
    const foreignRead = await fetch(`${origin}/api/chats/${input.chatId}`, {
      headers: foreign,
    });
    const missingRead = await fetch(`${origin}/api/chats/${randomUUID()}`, {
      headers: owner,
    });
    expect(ownRead.status).toBe(200);
    const forgedTenant = await fetch(`${origin}/api/chats/${input.chatId}`, {
      headers: {
        ...owner,
        'x-org-id': randomUUID(),
        'x-tenant-id': randomUUID(),
      },
    });
    expect(forgedTenant.status).toBe(400);
    expect(await forgedTenant.text()).not.toContain(input.text);
    expect(foreignRead.status).toBe(404);
    expect(missingRead.status).toBe(404);
    const foreignBody = (await foreignRead.json()) as {
      error: { code: string; message: string };
    };
    const missingBody = (await missingRead.json()) as {
      error: { code: string; message: string };
    };
    expect(foreignBody.error).toEqual(missingBody.error);
  } finally {
    await app.close();
  }
});

test('same-team peers cannot read a chat and deleted create retries are unavailable', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-privacy-health.json'),
    ),
  );
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const peer = await apiHeaders(app);
    const ownerIdentity = (await (
      await fetch(`${origin}/api/identity`, { headers: owner })
    ).json()) as { user: { id: string } };
    const peerIdentity = (await (
      await fetch(`${origin}/api/identity`, { headers: peer })
    ).json()) as { user: { id: string } };
    const team = await organizations.seedTeam([
      ownerIdentity.user.id,
      peerIdentity.user.id,
    ]);
    for (const headers of [owner, peer]) {
      const switched = await fetch(`${origin}/api/organizations/active`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: team.id }),
      });
      expect(switched.status).toBe(200);
    }
    const input = {
      chatId: randomUUID(),
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'team-private chat',
      effort: 'high',
    };
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const peerRead = await fetch(`${origin}/api/chats/${input.chatId}`, {
      headers: peer,
    });
    expect(peerRead.status).toBe(404);

    await fixture.chat.deleteFor(
      { orgId: team.id, userId: ownerIdentity.user.id },
      input.chatId,
    );
    const retry = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(retry.status).toBe(404);
    expect(await retry.text()).not.toContain(input.text);
  } finally {
    await app.close();
    await organizations.close();
    await fixture.close();
  }
});
