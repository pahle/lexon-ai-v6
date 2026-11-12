import { expect, it, vi } from 'vitest';
import { WorkspaceBreadcrumb } from '../src/components/shell/workspace-breadcrumb.js';
import { render } from './render.js';

const route = vi.hoisted(() => ({
  pathname: '/chats/11111111-1111-4111-8111-111111111111',
}));

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({ identity: { organization: { kind: 'personal' } } }),
}));

it('identifies a chat thread route instead of marking it not found', async () => {
  const view = await render(<WorkspaceBreadcrumb />);
  try {
    expect(view.container.textContent).toContain('Chat');
    expect(view.container.textContent).not.toContain('Page not found');
  } finally {
    await view.unmount();
  }
});
