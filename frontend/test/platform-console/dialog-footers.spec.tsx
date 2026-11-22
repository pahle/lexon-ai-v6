import { afterEach, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '../../src/components/data-views';
import { InviteDialog } from '../../src/components/platform-console/invite-dialog';
import { ProvisionDialog } from '../../src/components/platform-console/provision-dialog';
import { render, settle } from '../render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/platform/organizations',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

const withQuery = (node: ReactNode) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {node}
  </QueryClientProvider>
);

// LEX-DS-001 §5.5: buttons right-aligned in a row, 8px apart, on every
// width; on mobile only the dialog width changes. Same classes as the
// approved chat rename / delete dialogs.
function expectRowFooter(slot: 'dialog-footer' | 'alert-dialog-footer') {
  const footer = document.body.querySelector(`[data-slot="${slot}"]`);
  expect(footer).not.toBeNull();
  const classes = new Set(footer!.getAttribute('class')!.split(/\s+/));
  for (const token of ['flex', 'flex-row', 'justify-end', 'gap-2', 'mt-2'])
    expect(classes.has(token), token).toBe(true);
  // tailwind-merge drops the shared stacked default.
  expect(classes.has('flex-col-reverse')).toBe(false);
}

// The shared DialogContent renders an X button whose accessible text is "Close".
const closeButton = () =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Close',
  );

test('provision dialog: row footer and no close X', async () => {
  await render(withQuery(<ProvisionDialog open onOpenChange={vi.fn()} />));
  await settle();
  expect(document.body.textContent).toContain('Provision a team organization');
  expectRowFooter('dialog-footer');
  expect(closeButton()).toBeUndefined();
});

test('invite dialog: row footer and no close X', async () => {
  await render(withQuery(<InviteDialog open onOpenChange={vi.fn()} />));
  await settle();
  expect(document.body.textContent).toContain('Invite someone to Lexon');
  expectRowFooter('dialog-footer');
  expect(closeButton()).toBeUndefined();
});

test('kit confirm dialog: row footer', async () => {
  await render(
    <ConfirmDialog
      open
      onOpenChange={vi.fn()}
      title="Disable this account?"
      description="Rina Kusuma can no longer sign in."
      confirmLabel="Disable"
      destructive
      onConfirm={vi.fn()}
    />,
  );
  await settle();
  expectRowFooter('alert-dialog-footer');
  expect(closeButton()).toBeUndefined();
});

test('kit confirm dialog: header aligns left like the chat delete dialog', async () => {
  await render(
    <ConfirmDialog
      open
      onOpenChange={vi.fn()}
      title="Disable this account?"
      description="Rina Kusuma can no longer sign in."
      confirmLabel="Disable"
      destructive
      onConfirm={vi.fn()}
    />,
  );
  await settle();
  const classesOf = (slot: string) =>
    new Set(
      document.body
        .querySelector(`[data-slot="${slot}"]`)!
        .getAttribute('class')!
        .split(/\s+/),
    );
  const header = classesOf('alert-dialog-header');
  for (const token of ['gap-2', 'place-items-start', 'text-left'])
    expect(header.has(token), token).toBe(true);
  // tailwind-merge drops the shared centred defaults.
  expect(header.has('place-items-center')).toBe(false);
  expect(header.has('text-center')).toBe(false);
  expect(classesOf('alert-dialog-title').has('leading-[normal]')).toBe(true);
  const description = classesOf('alert-dialog-description');
  expect(description.has('text-wrap')).toBe(true);
  expect(description.has('md:text-wrap')).toBe(true);
});
