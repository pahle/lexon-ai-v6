import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ChatShareSummary, OrgMemberSummary } from '@lexon/contracts';
import { expect, it, vi } from 'vitest';
import {
  ChatFloatingActions,
  type OpenChat,
} from '../src/components/chat/chat-floating-actions';
import { render, settle, settleUntil } from './render';

// F6 §10: the chat menu offers Share on owner standalone chats in a team
// workspace only — never on project chats, in a personal workspace, or for a
// reader. The dialog lists current access and grants/revokes through the
// chat-shares endpoints.

const navigation = vi.hoisted(() => ({ path: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.path,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const workspaceState = vi.hoisted(() => ({
  kind: 'team' as 'team' | 'personal',
}));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({
    setChatTitle: vi.fn(),
    chatTitleRefreshVersion: 0,
    identity: {
      organization: {
        id: 'org-1',
        kind: workspaceState.kind,
        role: 'owner',
      },
      user: { id: 'user-1' },
    },
  }),
}));

const clientState = vi.hoisted(() => ({
  listShares: vi.fn(async () => [] as ChatShareSummary[]),
  addShares: vi.fn(async () => [] as ChatShareSummary[]),
  removeShare: vi.fn(async () => undefined),
  searchMembers: vi.fn(async () => [] as OrgMemberSummary[]),
}));
vi.mock('../src/lib/chat-client.js', () => ({
  createChatClient: () => ({
    list: vi.fn(async () => ({ items: [], pageInfo: { nextCursor: null } })),
    get: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    listShares: clientState.listShares,
    addShares: clientState.addShares,
    removeShare: clientState.removeShare,
  }),
}));
vi.mock('../src/lib/matters-api.js', () => ({
  createMattersClient: () => ({
    searchMembers: clientState.searchMembers,
  }),
}));

const chatId = '11111111-1111-4111-8111-111111111111';
const open = (over: Partial<OpenChat> = {}): OpenChat => ({
  id: chatId,
  title: 'Due diligence checklist',
  ...over,
});

function tree(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

async function menuItems(view: { container: HTMLElement }) {
  navigation.path = `/chats/${chatId}`;
  const trigger = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Chat actions"]',
  )!;
  trigger.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
  await settle();
  return [...document.querySelectorAll('[role="menuitem"]')].map((el) =>
    el.textContent?.trim(),
  );
}

it('an owner standalone chat in a team workspace offers Share; the dialog grants and revokes access', async () => {
  clientState.listShares = vi.fn(
    async () =>
      [
        {
          version: 1,
          userId: '22222222-2222-4222-8222-222222222222',
          name: 'Rina Kusuma',
          email: 'rina@lexon.id',
          grantedByUserId: '33333333-3333-4333-8333-333333333333',
          createdAt: '2026-11-10T09:00:00.000Z',
        },
      ] satisfies ChatShareSummary[],
  );
  clientState.searchMembers = vi.fn(
    async () =>
      [
        {
          version: 1,
          userId: '44444444-4444-4444-8444-444444444444',
          name: 'Eko Prasetyo',
          email: 'eko@lexon.id',
          role: 'member',
        },
      ] satisfies OrgMemberSummary[],
  );
  const view = await render(tree(<ChatFloatingActions chat={open()} />));
  try {
    const items = await menuItems(view);
    expect(items).toContain('Share');
    const share = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === 'Share',
    )!;
    share.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await settleUntil(() => document.body.textContent!.includes('Rina Kusuma'));
    expect(document.body.textContent).toContain(
      'can read this chat. They can\u2019t reply, edit or delete it.',
    );
    expect(document.body.textContent).toContain('Rina Kusuma');
    expect(document.body.textContent).toContain('Can view');
    expect(clientState.listShares).toHaveBeenCalledWith(chatId);
    // Revoke through the row's remove control.
    const remove = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Remove Rina Kusuma',
    )!;
    remove.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await settleUntil(() => clientState.removeShare.mock.calls.length > 0);
    expect(clientState.removeShare).toHaveBeenCalledWith(
      chatId,
      '22222222-2222-4222-8222-222222222222',
    );
  } finally {
    await view.unmount();
  }
});

it('Share is hidden on a project-bound chat, in a personal workspace, and for a reader', async () => {
  // Project-bound.
  let view = await render(
    tree(<ChatFloatingActions chat={open({ projectBound: true })} />),
  );
  try {
    expect(await menuItems(view)).not.toContain('Share');
  } finally {
    await view.unmount();
  }
  // Personal workspace.
  workspaceState.kind = 'personal';
  view = await render(tree(<ChatFloatingActions chat={open()} />));
  try {
    expect(await menuItems(view)).not.toContain('Share');
  } finally {
    await view.unmount();
    workspaceState.kind = 'team';
  }
  // Reader — no mutating menu at all, so no trigger either.
  view = await render(
    tree(<ChatFloatingActions chat={open({ access: 'reader' })} />),
  );
  try {
    expect(
      view.container.querySelector('button[aria-label="Chat actions"]'),
    ).toBeNull();
  } finally {
    await view.unmount();
  }
});
