import { afterEach, expect, it, vi } from 'vitest';
import type { ChatDetail } from '@lexon/contracts';
import { createChatClient } from '../src/lib/chat-client.js';

// F4.4 hardening (spec §5 item 15): the client sends If-None-Match only when a
// tag is known, answers 304 before the generic error path, and returns the
// response ETag for both statuses.

const chatId = '11111111-1111-4111-8111-111111111111';
const tree: ChatDetail = {
  id: chatId,
  title: 'Probe',
  messages: [],
  viewedLeafId: null,
  access: 'owner',
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:01.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (init?: RequestInit) => Response) {
  const fetch = vi.fn((_url: unknown, init?: RequestInit) =>
    Promise.resolve(handler(init)),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

it('omits If-None-Match when no tag is stored', async () => {
  const fetch = stubFetch(
    () =>
      new Response(JSON.stringify(tree), {
        status: 200,
        headers: { etag: 'W/"v1.first"', 'content-type': 'application/json' },
      }),
  );
  const client = createChatClient({ baseUrl: '/api' });
  const result = await client.get(chatId);
  expect(fetch).toHaveBeenCalledTimes(1);
  const init = fetch.mock.calls[0]![1] as RequestInit;
  expect(new Headers(init.headers).get('if-none-match')).toBeNull();
  expect(result).toEqual({
    notModified: false,
    tree,
    etag: 'W/"v1.first"',
  });
});

it('sends the stored tag as If-None-Match', async () => {
  const fetch = stubFetch(
    () =>
      new Response(JSON.stringify(tree), {
        status: 200,
        headers: { etag: 'W/"v1.next"', 'content-type': 'application/json' },
      }),
  );
  const client = createChatClient({ baseUrl: '/api' });
  await client.get(chatId, { ifNoneMatch: 'W/"v1.known"' });
  const init = fetch.mock.calls[0]![1] as RequestInit;
  expect(new Headers(init.headers).get('if-none-match')).toBe('W/"v1.known"');
});

it('a 304 returns notModified before the error path and keeps no tree', async () => {
  stubFetch(
    () =>
      new Response(null, {
        status: 304,
        headers: { etag: 'W/"v1.unchanged"' },
      }),
  );
  const client = createChatClient({ baseUrl: '/api' });
  const result = await client.get(chatId, { ifNoneMatch: 'W/"v1.unchanged"' });
  // The caller must retain the previously received tree object: a 304 result
  // carries no replacement.
  expect(result).toEqual({ notModified: true, etag: 'W/"v1.unchanged"' });
  expect('tree' in result).toBe(false);
});

it('a non-OK non-304 status still throws the normal client error', async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ error: { code: 'CHAT_NOT_FOUND' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = createChatClient({ baseUrl: '/api' });
  await expect(
    client.get(chatId, { ifNoneMatch: 'W/"v1.any"' }),
  ).rejects.toMatchObject({ code: 'AI_INTERNAL' });
});
