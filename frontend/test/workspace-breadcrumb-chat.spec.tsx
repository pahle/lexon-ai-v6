import { expect, it, vi } from 'vitest';
import { WorkspaceBreadcrumb } from '../src/components/shell/workspace-breadcrumb.js';
import { render } from './render.js';

const route = vi.hoisted(() => ({
  pathname: '/chats/11111111-1111-4111-8111-111111111111',
}));
const workspace = vi.hoisted(() => ({
  identity: {
    organization: { id: 'org-id', kind: 'personal' },
    user: { id: 'user-id' },
  },
  chatTitle: {
    chatId: '11111111-1111-4111-8111-111111111111',
    actorScope: 'org-id:user-id',
    title: 'Employment agreement review',
  },
}));

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => workspace,
}));

it('identifies a chat thread route instead of marking it not found', async () => {
  const view = await render(<WorkspaceBreadcrumb />);
  try {
    expect(view.container.textContent).toContain('Chats');
    expect(view.container.textContent).toContain('Employment agreement review');
    expect(view.container.textContent).not.toContain('New chat');
    expect(view.container.textContent).not.toContain('Page not found');
  } finally {
    await view.unmount();
  }
});

it('shows only Chats in the Chats page breadcrumb', async () => {
  route.pathname = '/chats';
  const view = await render(<WorkspaceBreadcrumb />);
  try {
    expect(view.container.textContent).toBe('Chats');
  } finally {
    await view.unmount();
  }
});
