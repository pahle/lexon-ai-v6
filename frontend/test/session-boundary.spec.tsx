import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
const signOut = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth-client', () => ({ authClient: { signOut } }));
import { SessionBoundary } from '../src/components/auth/session-boundary';
test('unavailable and expired states hide private content;503 preserves authentication', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(SessionBoundary, {
        state: 'unavailable',
        children: 'Private tenant content',
      }),
    ),
  );
  expect(host.textContent).not.toContain('Private');
  expect(signOut).not.toHaveBeenCalled();
  signOut.mockResolvedValue({ error: { code: 'AUTH_UNAVAILABLE' } });
  await act(async () =>
    root.render(
      createElement(SessionBoundary, {
        state: 'expired',
        children: 'Private tenant content',
      }),
    ),
  );
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('temporarily unavailable');
  expect(host.textContent).not.toContain('Private');
  await act(async () => root.unmount());
  host.remove();
});
