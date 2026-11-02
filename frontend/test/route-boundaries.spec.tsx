import { test, expect, vi } from 'vitest';
import { render } from './render';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import OrganizationsPage from '../src/app/(workspace)/organizations/page';
import OrganizationPage from '../src/app/(workspace)/organizations/[orgId]/page';
import UnmatchedOrganizationPage from '../src/app/(workspace)/organizations/[orgId]/[...unmatched]/page';
import WorkspaceNotFound from '../src/app/(workspace)/not-found';
import RootNotFound from '../src/app/not-found';
import SettingsIndexPage from '../src/app/(workspace)/settings/page';
import OrganizationSettingsIndexPage from '../src/app/(workspace)/organizations/[orgId]/settings/page';
import UnmatchedWorkspacePage from '../src/app/(workspace)/workspace/[...unmatched]/page';
import UnmatchedSettingsPage from '../src/app/(workspace)/settings/[...unmatched]/page';
import UnmatchedPlatformPage from '../src/app/(workspace)/platform/[...unmatched]/page';
import UnmatchedOnboardingPage from '../src/app/(workspace)/onboarding/[...unmatched]/page';
import RootError from '../src/app/error';
import WorkspaceError from '../src/app/(workspace)/error';

test('bare organizations, bare organization IDs, and nested unknown paths call notFound', async () => {
  expect(() => OrganizationsPage()).toThrow('not-found');
  expect(() => OrganizationPage()).toThrow('not-found');
  expect(() => UnmatchedOrganizationPage()).toThrow('not-found');
});

test('settings indexes redirect to the intended default sections', async () => {
  expect(() => SettingsIndexPage()).toThrow('redirect:/settings/profile');
  await expect(
    OrganizationSettingsIndexPage({
      params: Promise.resolve({ orgId: 'team-42' }),
    }),
  ).rejects.toThrow('redirect:/organizations/team-42/settings/members');
});

test('each shell-prefix catch-all uses the shell not-found boundary', () => {
  expect(() => UnmatchedWorkspacePage()).toThrow('not-found');
  expect(() => UnmatchedSettingsPage()).toThrow('not-found');
  expect(() => UnmatchedPlatformPage()).toThrow('not-found');
  expect(() => UnmatchedOnboardingPage()).toThrow('not-found');
});

test('workspace not-found UI fits inside the shell main and offers a workspace link', async () => {
  const view = await render(<WorkspaceNotFound />);
  expect(view.container.querySelectorAll('main')).toHaveLength(0);
  expect(view.container.querySelectorAll('h1')).toHaveLength(1);
  expect(view.container.querySelector('a[href="/workspace"]')).not.toBeNull();
  await view.unmount();
});

test('root not-found UI stays generic and links home', async () => {
  const view = await render(<RootNotFound />);
  expect(view.container.querySelectorAll('main')).toHaveLength(1);
  expect(view.container.querySelectorAll('h1')).toHaveLength(1);
  expect(view.container.textContent).not.toContain('internal');
  expect(view.container.querySelector('a[href="/workspace"]')).not.toBeNull();
  await view.unmount();
});

test('error boundaries show safe copy and retry without rendering error details', async () => {
  const retry = vi.fn();
  const unsafe = new Error('sensitive backend response');
  const root = await render(<RootError error={unsafe} retry={retry} />);
  expect(root.container.textContent).not.toContain(unsafe.message);
  expect(root.container.querySelectorAll('main')).toHaveLength(1);
  await root.unmount();
  const workspace = await render(
    <WorkspaceError error={unsafe} retry={retry} />,
  );
  expect(workspace.container.textContent).not.toContain(unsafe.message);
  expect(workspace.container.querySelectorAll('main')).toHaveLength(0);
  expect(
    workspace.container.querySelector('a[href="/workspace"]'),
  ).not.toBeNull();
  await workspace.unmount();
});
