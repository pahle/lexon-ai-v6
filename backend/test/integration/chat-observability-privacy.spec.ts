import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

test('chat content and search terms stay out of HTTP logs and validation errors', async ({
  services,
}) => {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown,
    ...args: unknown[]
  ) => {
    const value = String(chunk);
    if (value.startsWith('{')) {
      lines.push(value);
      const callback = args.find((x) => typeof x === 'function') as
        (() => void) | undefined;
      callback?.();
      return true;
    }
    return original(chunk as string);
  }) as typeof process.stdout.write);
  let app: Awaited<ReturnType<typeof createTestApi>> | undefined;

  try {
    app = await createTestApi(
      loadRuntimeConfig(
        'api',
        createAuthEnvironment(
          services,
          '/tmp/lexon-chat-observability-privacy-health.json',
        ),
      ),
    );
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const createRequestId = randomUUID();
    const readRequestId = randomUUID();
    const searchRequestId = randomUUID();
    const invalidRequestId = randomUUID();
    const chatContentCanary = `privatechat${randomUUID().replaceAll('-', '')}`;
    const searchTermCanary = `privatesearch${randomUUID().replaceAll('-', '')}`;

    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': createRequestId,
      },
      body: JSON.stringify({
        chatId,
        userMessageId,
        requestId: createRequestId,
        text: `${chatContentCanary} ${searchTermCanary} privacy fixture`,
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);

    const read = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: { ...headers, 'x-request-id': readRequestId },
    });
    expect(read.status).toBe(200);
    const readBody = await read.text();
    expect(readBody).toContain(chatContentCanary);
    expect(readBody).toContain(searchTermCanary);

    const searched = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': searchRequestId,
      },
      body: JSON.stringify({ query: searchTermCanary, limit: 10 }),
    });
    expect(searched.status).toBe(200);
    const searchBody = await searched.text();
    expect(searchBody).toContain(searchTermCanary);

    const invalid = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': invalidRequestId,
      },
      body: JSON.stringify({
        query: searchTermCanary,
        limit: 10,
        unknown: chatContentCanary,
      }),
    });
    expect(invalid.status).toBe(400);
    const errorBody = await invalid.text();
    expect(errorBody).not.toContain(chatContentCanary);
    expect(errorBody).not.toContain(searchTermCanary);

    await expect.poll(() => lines.join('')).toContain(searchRequestId);
    await expect.poll(() => lines.join('')).toContain(invalidRequestId);
    const logs = lines.join('');
    expect(logs).not.toContain(chatContentCanary);
    expect(logs).not.toContain(searchTermCanary);
  } finally {
    try {
      await app?.close();
    } finally {
      spy.mockRestore();
    }
  }
});
