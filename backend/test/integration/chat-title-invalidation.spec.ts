import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { ChatRepository } from '../../src/infrastructure/db/index.js';

test('chat invalidation stream is authenticated and delivers only owner-scoped IDs', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-title-events-health.json',
      ),
    ),
  );
  const fixture = await createChatFixture(services);
  const opened: Response[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const unauthenticated = await fetch(`${origin}/api/chats/events`);
    expect(unauthenticated.status).toBe(401);

    const ownerAHeaders = await apiHeaders(app);
    const ownerBHeaders = await apiHeaders(app);
    const identityA = await readIdentity(origin, ownerAHeaders);
    const identityB = await readIdentity(origin, ownerBHeaders);
    expect(identityA.userId).not.toBe(identityB.userId);
    expect(identityA.orgId).not.toBe(identityB.orgId);
    const chatA = await fixture.chat.createFor(
      identityA,
      randomUUID(),
      'owner A excerpt',
    );
    const chatB = await fixture.chat.createFor(
      identityB,
      randomUUID(),
      'owner B excerpt',
    );

    const responseA = await fetch(`${origin}/api/chats/events`, {
      headers: ownerAHeaders,
    });
    opened.push(responseA);
    const responseB = await fetch(`${origin}/api/chats/events`, {
      headers: ownerBHeaders,
    });
    opened.push(responseB);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const readerA = responseA.body!.getReader();
    const readerB = responseB.body!.getReader();
    await expect(readEvent(readerA)).resolves.toBe(': connected');
    await expect(readEvent(readerB)).resolves.toBe(': connected');

    await expect(
      fixture.database.withTenant(identityB, (tx) =>
        new ChatRepository().rename(tx, chatB.id, 'Renamed owner B'),
      ),
    ).resolves.toBe(true);
    const eventB = JSON.parse(await readEvent(readerB)) as Record<
      string,
      unknown
    >;
    expect(eventB).toEqual({
      version: 1,
      type: 'chat.invalidated',
      chatId: chatB.id,
    });
    await fixture.database.withTenant(identityA, (tx) =>
      new ChatRepository().rename(tx, chatA.id, 'Renamed owner A'),
    );
    const eventA = JSON.parse(await readEvent(readerA)) as Record<
      string,
      unknown
    >;
    expect(eventA).toEqual({
      version: 1,
      type: 'chat.invalidated',
      chatId: chatA.id,
    });
    await expectNoEvent(readerB);
    await Promise.all([readerA.cancel(), readerB.cancel()]);
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => {});
    await app.close();
    await fixture.close();
  }
});

async function readIdentity(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const response = await fetch(`${origin}/api/identity`, { headers });
  const identity = (await response.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  return { orgId: identity.organization.id, userId: identity.user.id };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return Promise.race([
    readEventFrame(reader),
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for SSE event')),
        3000,
      );
      timeout.unref();
    }),
  ]);
}

async function readEventFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE stream closed before event');
    text += decoder.decode(value, { stream: true });
    const separator = text.indexOf('\n\n');
    if (separator < 0) continue;
    const frame = text.slice(0, separator);
    if (frame.startsWith(': ')) return frame;
    const data = frame.split('\n').find((line) => line.startsWith('data: '));
    if (data) return data.slice('data: '.length);
  }
}

async function expectNoEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    reader.read().then(() => 'event'),
    new Promise<'quiet'>((resolve) => {
      timeout = setTimeout(() => resolve('quiet'), 100);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  expect(result).toBe('quiet');
}
