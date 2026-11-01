import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoAccessState,
} from '../src/components/states/page-states';
import { PageHeader } from '../src/components/shell/page-header';
import { QueryFailure } from '../src/components/organizations/page-state';
import { IdentityClientError } from '../src/lib/identity-client';

test('shared states use status and alert semantics, with owned actions and safe copy', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const retry = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        'main',
        null,
        createElement(LoadingState, { message: 'Loading matters' }),
        createElement(EmptyState, {
          title: 'No matters',
          description: 'Create a matter to get started.',
          action: createElement('a', { href: '/matters/new' }, 'Create matter'),
        }),
        createElement(ErrorState, {
          message: 'Unable to load matters.',
          onRetry: retry,
        }),
        createElement(NoAccessState, {}),
        createElement(PageHeader, { title: 'Matters' }),
      ),
    ),
  );

  expect(host.querySelectorAll('main')).toHaveLength(1);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    'Loading matters',
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to load matters.',
  );
  const retryButton = host.querySelector('[role="alert"] button');
  expect(retryButton).not.toBeNull();
  await act(async () =>
    retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  expect(retry).toHaveBeenCalledTimes(1);
  expect(host.querySelector('a[href="/matters/new"]')?.textContent).toBe(
    'Create matter',
  );
  expect(host.textContent).toContain('No matters');
  expect(host.textContent).toContain('You do not have access to this page.');
  expect(host.querySelectorAll('h1')).toHaveLength(1);
  expect(host.querySelector('h1')?.textContent).toBe('Matters');
  await act(async () => root.unmount());
  host.remove();
});

test('query failures show safe copy and never render or log exception details', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const secret = 'Private dependency detail';
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () =>
    root.render(
      createElement(QueryFailure, {
        error: new IdentityClientError(secret, 403),
      }),
    ),
  );

  expect(host.textContent).not.toContain(secret);
  expect(host.textContent).toContain(
    'Unable to complete this action. Refresh and check your access.',
  );
  expect(logger).not.toHaveBeenCalledWith(expect.stringContaining(secret));
  logger.mockRestore();
  await act(async () => root.unmount());
  host.remove();
});

test('shared states use flex gaps on the design spacing grid', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        'div',
        null,
        createElement(LoadingState, {}),
        createElement(EmptyState, {
          title: 'Empty',
          description: 'Nothing here.',
        }),
        createElement(ErrorState, {}),
        createElement(NoAccessState, {}),
      ),
    ),
  );

  const states = host.querySelectorAll('section');
  expect(states).toHaveLength(4);
  for (const state of states) {
    expect(state.className).toContain('flex');
    expect(state.className).toContain('flex-col');
    expect(state.className).toContain('gap-2');
    expect(state.className).not.toMatch(/space-y-/);
  }
  await act(async () => root.unmount());
});

test('page heading uses the design-system size, weight, and line height', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(PageHeader, { title: 'Matters' })),
  );

  const heading = host.querySelector('h1');
  expect(heading?.className).toContain(
    'text-[length:var(--font-size-heading)]',
  );
  expect(heading?.className).toContain('font-semibold');
  expect(heading?.className).toContain('leading-[1.5]');
  await act(async () => root.unmount());
});
