import { afterEach, expect, test, vi } from 'vitest';
import { setupCommand } from '../src/lib/admin-setup-client';

const token = 'c'.repeat(43);
afterEach(() => vi.unstubAllGlobals());

test('posts the setup token to the same-origin setup command', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  vi.stubGlobal('fetch', fetch);
  await expect(setupCommand('redeem', token)).resolves.toBeUndefined();
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/identity/admin-setup/redeem');
  expect(init).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ token }),
  });
  expect(new Headers(init?.headers).get('content-type')).toBe(
    'application/json',
  );
});

test.each([
  ['an empty token', '', async () => new Response(null)],
  ['a network failure', token, async () => Promise.reject(new TypeError('x'))],
  [
    'an error response',
    token,
    async () => Response.json({ error: { code: 'X' } }, { status: 400 }),
  ],
] as const)(
  'reports %s as Setup unavailable',
  async (_case, value, respond) => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(respond));
    await expect(setupCommand('complete', value)).rejects.toThrow(
      new Error('Setup unavailable'),
    );
  },
);
