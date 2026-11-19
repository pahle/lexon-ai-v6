import { expect, test, vi } from 'vitest';
import { render } from './render';

const navigation = vi.hoisted(() => ({ pathname: '/workspace' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));
const workspace = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({ identity: workspace.identity }),
}));

import { WorkspaceNotFound } from '../src/components/states/workspace-not-found';
import { PlatformPage } from '../src/components/platform/platform-page';

// Guard: every status screen (not found, organization not found, workspace
// error, platform no access) is the one shared StatusPage.
const sources = import.meta.glob<string>(
  ['../src/app/**/{not-found,error,global-error}.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

test('every not-found and error route file renders a shared status component', () => {
  const files = Object.keys(sources).sort();
  expect(files.map((file) => file.replace('../src/app/', ''))).toEqual([
    '(workspace)/error.tsx',
    '(workspace)/not-found.tsx',
    'error.tsx',
    'not-found.tsx',
  ]);
  for (const [file, text] of Object.entries(sources))
    expect(text, file).toMatch(
      /<(StatusPage|StandaloneStatusPage|WorkspaceNotFound)\b/,
    );
});

test('the organizations not-found and the generic not-found render the shared StatusPage', async () => {
  for (const [pathname, title] of [
    ['/organizations/org_1', 'Workspace not found'],
    ['/workspace/missing', 'Page not found'],
  ] as const) {
    navigation.pathname = pathname;
    const view = await render(<WorkspaceNotFound />);
    expect(
      view.container.querySelector('[data-slot="status-page"]'),
      pathname,
    ).not.toBeNull();
    expect(view.container.querySelector('h1')?.textContent).toBe(title);
    await view.unmount();
  }
});

test('platform no-access renders the shared StatusPage for a non-administrator', async () => {
  for (const identity of [null, { platformAdmin: false }]) {
    workspace.identity = identity;
    const view = await render(
      <PlatformPage title="Accounts">
        <p>Platform content</p>
      </PlatformPage>,
    );
    expect(
      view.container.querySelector('[data-slot="status-page"]'),
    ).not.toBeNull();
    expect(view.container.querySelector('h1')?.textContent).toBe(
      'You do not have access',
    );
    expect(view.container.textContent).not.toContain('Platform content');
    await view.unmount();
  }
});
