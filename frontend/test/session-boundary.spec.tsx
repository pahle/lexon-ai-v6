import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { AuthCard } from '../src/components/auth/auth-card';
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
        embedded: true,
        children: 'Private tenant content',
      }),
    ),
  );
  expect(host.querySelectorAll('main')).toHaveLength(0);
  expect(
    host.querySelector('a[href="/sign-in?returnTo=%2Fworkspace"]'),
  ).toBeNull();
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('temporarily unavailable');
  expect(host.textContent).not.toContain('Private');
  await act(async () => root.unmount());
  host.remove();
});

test('expired embedded state offers sign-in with a sanitized return path', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState({}, '', '/workspace/cases?view=all');
  signOut.mockResolvedValue({ error: { code: 'AUTH_UNAVAILABLE' } });
  await act(async () =>
    root.render(
      createElement(SessionBoundary, {
        state: 'expired',
        embedded: true,
        children: 'Private tenant content',
      }),
    ),
  );

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/sign-in?returnTo=%2Fworkspace%2Fcases%3Fview%3Dall',
  );
  expect(host.textContent).not.toContain('Private tenant content');
  await act(async () => root.unmount());
  host.remove();
  window.history.replaceState({}, '', '/');
});

test('AuthCard uses a level-two heading when embedded and level one by default', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        'div',
        null,
        createElement(AuthCard, { title: 'Embedded sign in', headingLevel: 2 }),
        createElement(AuthCard, { title: 'Standalone sign in' }),
      ),
    ),
  );

  expect(host.querySelectorAll('h1')).toHaveLength(1);
  expect(host.querySelectorAll('h2')).toHaveLength(1);
  await act(async () => root.unmount());
  host.remove();
});
