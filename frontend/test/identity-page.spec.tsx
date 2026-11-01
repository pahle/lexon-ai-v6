import { test, expect, vi } from 'vitest';
import { isValidElement } from 'react';
vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => '' }),
}));
vi.mock('../src/lib/server-identity-client', () => ({
  createServerIdentityClient: () => ({
    identity: async () => {
      throw Object.assign(new Error('Private dependency detail'), {
        status: 401,
        code: 'AUTH_REQUIRED',
      });
    },
  }),
}));
import { loadIdentityPage } from '../src/lib/identity-page';
test('server identity failures cross the client boundary as safe state only', async () => {
  const result = await loadIdentityPage();
  expect(isValidElement(result.view)).toBe(true);
  const props = result.view!.props as Record<string, unknown>;
  expect(Object.values(props).some((value) => value instanceof Error)).toBe(
    false,
  );
  expect(JSON.stringify(props).includes('Private dependency detail')).toBe(
    false,
  );
});
