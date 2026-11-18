import { test, expect, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';
import { AdminSetup } from '../src/components/auth/admin-setup';
vi.mock('../src/lib/auth-client', () => ({
  authClient: { signOut: async () => ({ error: null }), $fetch: vi.fn() },
}));
test('Create setup account reveals the sign-up form once, with no further setup redemption', async () => {
  const redeem = vi.fn();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/redeem')) {
      redeem();
      return Response.json({ status: 'pending' });
    }
    return Response.json(
      { error: { code: 'AUTH_REQUIRED', message: 'Required' } },
      { status: 401 },
    );
  });
  const token = 'c'.repeat(43);
  window.history.replaceState(null, '', '/admin-setup?token=' + token);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminSetup setupToken={token} />
    </QueryClientProvider>,
  );
  await settle();
  const create = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Create setup account',
  );
  expect(create).toBeTruthy();
  const before = redeem.mock.calls.length;
  await act(async () => create!.click());
  await settle();
  expect(
    view.container.querySelector('input[autocomplete="name"]'),
  ).toBeTruthy();
  expect(redeem.mock.calls.length).toBe(before);
  expect(window.location.pathname).toBe('/admin-setup');
  await view.unmount();
});
