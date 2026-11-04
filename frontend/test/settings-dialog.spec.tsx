import { afterEach, test, expect, vi } from 'vitest';
import { act } from 'react';
import {
  getSettingsFinalFocusTarget,
  readSettingsSection,
  settingsHref,
} from '../src/components/settings/settings-url';
import { SettingsDialog } from '../src/components/settings/settings-dialog';
import { SettingsNavigation } from '../src/components/settings/settings-navigation';
import { render } from './render';

const locationState = vi.hoisted(() => ({
  pathname: '/workspace',
  search: '',
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => locationState.pathname,
  useSearchParams: () => new URLSearchParams(locationState.search),
  useRouter: () => router,
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    status: 'ready',
    identity: {
      version: 1,
      user: {
        id: 'user-1',
        name: 'Taylor',
        email: 'taylor@example.test',
        onboardingCompleted: true,
      },
      organization: {
        id: 'personal-1',
        kind: 'personal',
        name: 'Personal',
        role: 'owner',
      },
      platformAdmin: false,
    },
  }),
}));
vi.mock('../src/components/settings/profile-settings', async () => {
  const {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } = await import('../src/components/ui/dropdown-menu');
  return {
    ProfileSettings: () => (
      <section>
        <label>
          Display name
          <input defaultValue="Taylor" />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger>Profile actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Test-only profile action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
    ),
  };
});

afterEach(() => {
  locationState.pathname = '/workspace';
  locationState.search = '';
});

test.each([
  ['absent', new URLSearchParams(), null],
  ['profile', new URLSearchParams('settings=profile'), 'profile'],
  ['appearance', new URLSearchParams('settings=appearance'), 'appearance'],
  ['security', new URLSearchParams('settings=security'), 'security'],
  ['members', new URLSearchParams('settings=members'), 'members'],
  ['invitations', new URLSearchParams('settings=invitations'), 'invitations'],
  ['general', new URLSearchParams('settings=general'), 'general'],
  ['unknown', new URLSearchParams('settings=other'), 'invalid'],
  ['empty', new URLSearchParams('settings='), 'invalid'],
  [
    'repeated',
    new URLSearchParams('settings=profile&settings=security'),
    'invalid',
  ],
  [
    'organization id is not a setting',
    new URLSearchParams('orgId=team-42'),
    null,
  ],
])('reads %s settings state', (_name, search, expected) => {
  expect(readSettingsSection(search)).toBe(expected);
});

test('settingsHref preserves unrelated query values and hash while replacing settings', () => {
  expect(
    settingsHref(
      '/workspace?filter=recent&settings=members&filter=mine#cases',
      'security',
    ),
  ).toBe('/workspace?filter=recent&filter=mine&settings=security#cases');
});

test('settingsHref removes every settings value when closing', () => {
  expect(
    settingsHref('/workspace?settings=profile&x=1&settings=security#top', null),
  ).toBe('/workspace?x=1#top');
});

test('settings final focus skips a visible menu trigger retained in a closed mobile sidebar', () => {
  const sheet = document.createElement('div');
  sheet.setAttribute('data-sidebar', 'sidebar');
  sheet.setAttribute('data-mobile', 'true');
  const opener = document.createElement('button');
  Object.defineProperty(opener, 'getClientRects', { value: () => [{}] });
  sheet.append(opener);
  const fallback = document.createElement('button');
  fallback.setAttribute('aria-label', 'Open navigation');
  Object.defineProperty(fallback, 'getClientRects', { value: () => [{}] });
  document.body.append(sheet, fallback);

  expect(getSettingsFinalFocusTarget(opener, fallback)).toBe(fallback);
  sheet.setAttribute('data-open', '');
  expect(getSettingsFinalFocusTarget(opener, fallback)).toBe(opener);
  sheet.remove();
  fallback.remove();
});

test('settings links preserve modified clicks for the browser', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(<SettingsNavigation section="profile" />);
  const link = [
    ...view.container.querySelectorAll<HTMLAnchorElement>('a'),
  ].find((item) => item.textContent === 'Appearance')!;
  const modifiedClick = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  await act(async () => link.dispatchEvent(modifiedClick));
  expect(modifiedClick.defaultPrevented).toBe(false);
  expect(router.replace).not.toHaveBeenCalled();
  await view.unmount();
  vi.unstubAllGlobals();
});

test('renders the URL-selected account section in one settings dialog', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?filter=recent&settings=profile';
  const view = await render(
    <>
      <main aria-label="Workspace">Workspace page</main>
      <SettingsDialog />
    </>,
  );
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Settings');
  expect(document.body.textContent).toContain('Display name');
  expect(document.body.querySelectorAll('main')).toHaveLength(1);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('invalid settings URLs open a no-access state without account sections', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?settings=unknown';
  const view = await render(<SettingsDialog />);
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain(
    'You do not have access to this section.',
  );
  expect(document.body.textContent).not.toContain('Display name');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('an inner Base UI dropdown Escape closes only that layer and restores its trigger', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?settings=profile';
  const view = await render(<SettingsDialog />);
  const trigger = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === 'Profile actions',
  )!;
  await act(async () => trigger.click());
  expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(trigger);
  await view.unmount();
  vi.unstubAllGlobals();
});
