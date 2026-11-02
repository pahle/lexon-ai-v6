import { expect, test, vi } from 'vitest';
const requestCookie = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => requestCookie.value }),
}));
import { loadWorkspaceBootstrap } from '../src/lib/workspace-bootstrap';

test('bootstrap forwards each request cookie unchanged and ignores sidebar preference for policy', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return new Response(null, { status: 401 });
  });
  const results = [];
  for (const cookie of [
    'session=one; sidebar_state=expanded',
    'session=two; sidebar_state=collapsed',
  ]) {
    requestCookie.value = cookie;
    results.push(await loadWorkspaceBootstrap());
  }
  expect(results).toEqual([{ status: 'expired' }, { status: 'expired' }]);
  expect(calls).toHaveLength(2);
  for (const [index, call] of calls.entries()) {
    expect(call.url).toBe('http://api:3001/api/identity');
    expect(call.options).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        cookie:
          index === 0
            ? 'session=one; sidebar_state=expanded'
            : 'session=two; sidebar_state=collapsed',
      },
    });
    expect(call.options.body).toBeUndefined();
  }
  vi.unstubAllGlobals();
});
