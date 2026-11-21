import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  parseJsonResponse,
  requestJson,
  REQUEST_TIMEOUT_MS,
} from '../src/lib/request-json';

const unavailable = () => new Error('unavailable');

test('sends a same-origin, uncached JSON request with a timeout', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  await requestJson(
    '/api/items',
    { fetch, method: 'POST', body: { a: 1 }, headers: { cookie: 'c=1' } },
    unavailable,
  );
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/items');
  expect(init).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    body: '{"a":1}',
  });
  expect(new Headers(init?.headers).get('content-type')).toBe(
    'application/json',
  );
  expect(new Headers(init?.headers).get('cookie')).toBe('c=1');
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(REQUEST_TIMEOUT_MS).toBe(10_000);
});

test('defaults to GET with no body and no content type', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  await requestJson('/api/items', { fetch }, unavailable);
  const init = fetch.mock.calls[0]![1];
  expect(init?.method).toBe('GET');
  expect(init && 'body' in init).toBe(false);
  expect(new Headers(init?.headers).has('content-type')).toBe(false);
});

test('a caller abort still aborts the request', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  const controller = new AbortController();
  await requestJson(
    '/api/items',
    { fetch, signal: controller.signal },
    unavailable,
  );
  const signal = fetch.mock.calls[0]![1]?.signal;
  expect(signal?.aborted).toBe(false);
  controller.abort();
  expect(signal?.aborted).toBe(true);
});

test('uses the global fetch when none is injected', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  vi.stubGlobal('fetch', fetch);
  try {
    await requestJson('/api/items', {}, unavailable);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

test('maps a failure before any response to the caller error', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    throw new TypeError('network');
  });
  await expect(
    requestJson('/api/items', { fetch }, unavailable),
  ).rejects.toThrow('unavailable');
});

test('parses a JSON body with the schema, or maps invalid bodies', async () => {
  const schema = z.object({ id: z.string() });
  const invalid = () => new Error('invalid');
  await expect(
    parseJsonResponse(Response.json({ id: 'x' }), schema, invalid),
  ).resolves.toEqual({ id: 'x' });
  await expect(
    parseJsonResponse(Response.json({ id: 1 }), schema, invalid),
  ).rejects.toThrow('invalid');
  await expect(
    parseJsonResponse(new Response('not json'), schema, invalid),
  ).rejects.toThrow('invalid');
  await expect(
    parseJsonResponse(new Response('ignored'), null, invalid),
  ).resolves.toBeUndefined();
});
