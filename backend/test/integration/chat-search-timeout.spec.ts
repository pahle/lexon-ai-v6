import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { ChatMessageRepository } from '../../src/infrastructure/db/index.js';

test('search statement timeout returns the fixed bounded response', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig('api', {
      ...createAuthEnvironment(
        services,
        '/tmp/lexon-chat-search-timeout-health.json',
      ),
      DATABASE_STATEMENT_TIMEOUT_MS: '250',
    }),
  );
  const fixture = await createChatFixture(services);
  let lockHeld = false;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const identityResponse = await fetch(`${origin}/api/identity`, {
      headers: owner,
    });
    const identity = (await identityResponse.json()) as {
      user: { id: string };
      organization: { id: string };
    };
    const ownerContext = {
      userId: identity.user.id,
      orgId: identity.organization.id,
    };
    const chatId = randomUUID();
    await fixture.chat.createFor(ownerContext, chatId, 'Timeout fixture');
    const messageId = randomUUID();
    await fixture.database.withTenant(ownerContext, (tx) =>
      new ChatMessageRepository().insertUser(tx, {
        chatId,
        messageId,
        parentMessageId: null,
        text: 'Timeout search marker',
        effort: 'high',
      }),
    );
    await fixture.inspect.query('BEGIN');
    await fixture.inspect.query(
      'LOCK TABLE app.chat_messages IN ACCESS EXCLUSIVE MODE',
    );
    lockHeld = true;
    const query = `timeout-${randomUUID()}`;
    const response = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'CHAT_SEARCH_TIMEOUT',
      message: 'Search took too long. Try more specific words.',
    });
    expect(JSON.stringify(body)).not.toContain(query);
    expect(JSON.stringify(body)).not.toContain('57014');
  } finally {
    if (lockHeld) await fixture.inspect.query('ROLLBACK');
    await app.close();
    await fixture.close();
  }
});
