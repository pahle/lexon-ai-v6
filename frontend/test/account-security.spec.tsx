import { test, expect, vi } from 'vitest';
import { useState, act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';
import { RecoveryCodes } from '../src/components/auth/recovery-codes';
import { SessionList } from '../src/components/auth/session-list';
import { AccountSecurity } from '../src/components/auth/account-security';
import { PageHeader } from '../src/components/shell/page-header';
import { TwoFactorEnrollment } from '../src/components/auth/two-factor-enrollment';

const revokeOtherSessions = vi.hoisted(() =>
  vi.fn(async (): Promise<{ error: null | { message: string } }> => ({
    error: null,
  })),
);
const disableTwoFactor = vi.hoisted(() =>
  vi.fn(async (): Promise<{ error: null | { message: string } }> => ({
    error: null,
  })),
);
const toastSuccess = vi.hoisted(() => vi.fn());
const generateBackupCodes = vi.hoisted(() =>
  vi.fn(async () => ({
    error: null,
    data: { backupCodes: ['rotated-code'] },
  })),
);
vi.mock('../src/lib/auth-client', () => ({
  authClient: {
    revokeOtherSessions,
    twoFactor: {
      disable: disableTwoFactor,
      generateBackupCodes,
      enable: async () => ({
        error: null,
        data: {
          totpURI:
            'otpauth://totp/Lexon:person%40example.test?issuer=Lexon&secret=ABC123',
          backupCodes: ['standalone-code'],
        },
      }),
      verifyTotp: async () => ({ error: null, data: {} }),
    },
  },
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: { user: { email: 'person@example.test' } },
    refreshIdentity: vi.fn(async () => {}),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
vi.mock('../src/components/auth/authentication-code-form', () => ({
  AuthenticationCodeForm: ({
    onSubmit,
  }: {
    onSubmit: (input: { code: string }) => Promise<void>;
  }) => (
    <button onClick={() => void onSubmit({ code: '123456' })}>
      Complete enrollment
    </button>
  ),
}));
test('dismissed recovery codes leave no rendered copy or stored value', async () => {
  function Host() {
    const [show, setShow] = useState(true);
    return show ? (
      <RecoveryCodes
        codes={['recovery-secret-sentinel']}
        onDismiss={() => setShow(false)}
      />
    ) : (
      <p>Saved</p>
    );
  }
  const view = await render(<Host />);
  expect(view.container.textContent).toContain('recovery-secret-sentinel');
  await act(async () => view.container.querySelector('button')!.click());
  expect(view.container.textContent?.includes('recovery-secret-sentinel')).toBe(
    false,
  );
  expect(sessionStorage.length + localStorage.length).toBe(0);
  await view.unmount();
});

test('recovery codes use h1 in standalone enrollment and h2 within account security', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
  const standalone = await render(
    <TwoFactorEnrollment onComplete={async () => {}} />,
  );
  const password = standalone.container.querySelector(
    'input[autocomplete="current-password"]',
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(password, 'Strong-password-4!');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(password.getAttribute('name')).toBe('password');
  expect(password.autocomplete).toBe('current-password');
  await act(async () =>
    standalone.container
      .querySelector<HTMLButtonElement>('button[aria-label="Show password"]')!
      .click(),
  );
  expect(password.type).toBe('text');
  expect(password.value).toBe('Strong-password-4!');
  await act(async () =>
    standalone.container
      .querySelector<HTMLButtonElement>('button[aria-label="Hide password"]')!
      .click(),
  );
  expect(password.type).toBe('password');
  await act(async () => {
    standalone.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  await act(async () =>
    (standalone.container.querySelector('button') as HTMLButtonElement).click(),
  );
  expect(standalone.container.querySelectorAll('h1')).toHaveLength(1);
  expect(standalone.container.querySelectorAll('h2')).toHaveLength(0);
  expect(standalone.container.textContent).toContain('standalone-code');
  await standalone.unmount();

  const embedded = await render(
    <>
      <PageHeader title="Security settings" />
      <RecoveryCodes
        codes={['embedded-code']}
        headingLevel={2}
        onDismiss={() => {}}
      />
    </>,
  );
  expect(embedded.container.querySelectorAll('h1')).toHaveLength(1);
  expect(embedded.container.querySelectorAll('h2')).toHaveLength(1);
  await embedded.unmount();
  vi.unstubAllGlobals();
});
test('session list shows each device as the prototype draws it and signs out only by safe id', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
  const id = '00000000-0000-4000-8000-000000000001';
  let revoked = '';
  const rows = [
    {
      version: 1 as const,
      id,
      channel: 'cookie' as const,
      createdAt: '2026-11-15T12:00:00.000Z',
      expiresAt: '2026-11-22T12:00:00.000Z',
      current: false,
      deviceName: 'Safari on iPhone',
      deviceKind: 'mobile' as const,
      token: 'token-secret-sentinel',
    },
    {
      version: 1 as const,
      id: '00000000-0000-4000-8000-000000000002',
      channel: 'cookie' as const,
      createdAt: '2026-11-18T08:00:00.000Z',
      expiresAt: '2026-11-25T08:00:00.000Z',
      current: true,
      deviceName: 'Chrome on macOS',
      deviceKind: 'desktop' as const,
    },
  ];
  const view = await render(
    <SessionList
      sessions={rows}
      onRevoke={async (value) => {
        revoked = value;
      }}
    />,
  );
  const items = [...view.container.querySelectorAll('li')];
  expect(items).toHaveLength(2);
  // Current device first: name, badge, "Active now", and no action.
  expect(items[0]?.textContent).toBe('Chrome on macOSThis deviceActive now');
  expect(items[0]?.querySelector('button')).toBeNull();
  expect(items[1]?.textContent).toBe(
    'Safari on iPhoneSigned in 3 days agoSign out',
  );
  const tile = items[1]!.querySelector('[data-slot="device-tile"]')!;
  expect(tile.className).toContain('size-9');
  expect(tile.className).toContain('rounded-[10px]');
  expect(tile.className).toContain('bg-muted');
  expect(tile.querySelector('svg')).not.toBeNull();
  expect(view.container.querySelector('table')).toBeNull();
  expect(view.container.textContent).toContain('Where you are signed in');
  for (const hidden of ['Browser', 'Bearer', 'Expires', 'Current'])
    expect(view.container.textContent).not.toContain(hidden);
  expect(view.container.textContent?.includes('token-secret-sentinel')).toBe(
    false,
  );
  const signOut = view.container.querySelector<HTMLButtonElement>('li button')!;
  expect(signOut.getAttribute('aria-label')).toBe('Sign out Safari on iPhone');
  // An outline trigger with explicit text (LEX-DS-001 §2), not a red one.
  expect(signOut.classList.contains('border-border')).toBe(true);
  expect(signOut.classList.contains('bg-background')).toBe(true);
  expect(signOut.className).not.toContain('text-destructive');
  await act(async () => signOut.click());
  expect(revoked).toBe('');
  const cancel = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-cancel"]',
  );
  expect(cancel).not.toBeNull();
  await act(async () => cancel?.click());
  expect(revoked).toBe('');
  await act(async () => signOut.click());
  const confirm = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  );
  expect(confirm).not.toBeNull();
  await act(async () => confirm?.click());
  expect(revoked).toBe(id);
  await view.unmount();
  vi.useRealTimers();
});

test('each device kind has its own icon and the add-in is named', async () => {
  const base = {
    version: 1 as const,
    channel: 'cookie' as const,
    createdAt: '2026-11-01T00:00:00Z',
    expiresAt: '2026-11-08T00:00:00Z',
    current: false,
  };
  const view = await render(
    <SessionList
      sessions={[
        {
          ...base,
          id: '00000000-0000-4000-8000-000000000011',
          deviceName: 'A',
          deviceKind: 'desktop',
        },
        {
          ...base,
          id: '00000000-0000-4000-8000-000000000012',
          deviceName: 'B',
          deviceKind: 'mobile',
        },
        {
          ...base,
          id: '00000000-0000-4000-8000-000000000013',
          deviceName: 'C',
          deviceKind: 'tablet',
        },
        {
          ...base,
          id: '00000000-0000-4000-8000-000000000014',
          deviceName: 'Unknown device',
          deviceKind: 'unknown',
        },
      ]}
      onRevoke={async () => {}}
    />,
  );
  const icons = [...view.container.querySelectorAll('li svg')].map(
    (icon) => icon.getAttribute('class')?.match(/lucide-([a-z-]+)/)?.[1],
  );
  expect(icons.slice(0, 4)).toEqual([
    'monitor',
    'smartphone',
    'tablet',
    'monitor',
  ]);
  expect(view.container.textContent).toContain('Unknown device');
  await view.unmount();
});

test('the sessions list is a named list that wraps without sideways scrolling', async () => {
  const view = await render(
    <SessionList
      sessions={[
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000041',
          channel: 'cookie',
          createdAt: '2026-11-01T00:00:00Z',
          expiresAt: '2026-11-08T00:00:00Z',
          current: true,
          deviceName: 'Chrome on macOS',
          deviceKind: 'desktop',
        },
      ]}
      onRevoke={async () => {}}
    />,
  );
  const list = view.container.querySelector('ul');
  expect(list?.getAttribute('aria-label')).toBe('Signed-in sessions');
  expect(list?.parentElement?.className).not.toContain('overflow-x-auto');
  // Prototype 14.5: session rows keep the button at the right on mobile.
  expect(view.container.querySelector('li')?.className).not.toContain(
    'max-md:flex-col',
  );
  await view.unmount();
});

test('session revoke shows pending, blocks repeats, and keeps confirmation open on failure', async () => {
  let rejectRevoke!: (reason: Error) => void;
  const onRevoke = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectRevoke = reject;
      }),
  );
  const view = await render(
    <SessionList
      sessions={[
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000005',
          channel: 'bearer',
          createdAt: '2026-11-01T00:00:00Z',
          expiresAt: '2026-11-01T00:15:00Z',
          current: false,
          deviceName: 'Chrome on macOS',
          deviceKind: 'desktop',
        },
      ]}
      onRevoke={onRevoke}
    />,
  );

  await act(async () => view.container.querySelector('button')!.click());
  const action = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  )!;
  await act(async () => action.click());
  await vi.waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(1));
  expect(action.disabled).toBe(true);
  expect(action.textContent).toContain('Signing out…');
  expect(action.querySelector('[data-slot="spinner"]')).not.toBeNull();
  await act(async () => action.click());
  expect(onRevoke).toHaveBeenCalledTimes(1);

  await act(async () => rejectRevoke(new Error('synthetic revoke failure')));
  await settle();
  const revokeDialog = document.body.querySelector('[role="alertdialog"]');
  expect(revokeDialog).not.toBeNull();
  expect(revokeDialog?.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to sign out the session',
  );
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  expect(action.disabled).toBe(false);
  expect(action.textContent).toContain('Sign out');
  await view.unmount();
});

test('session revoke clears its previous error after cancel and reopen', async () => {
  const onRevoke = vi.fn(async () => {
    throw new Error('synthetic revoke failure');
  });
  const view = await render(
    <SessionList
      sessions={[
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000005',
          channel: 'bearer',
          createdAt: '2026-11-01T00:00:00Z',
          expiresAt: '2026-11-01T00:15:00Z',
          current: false,
          deviceName: 'Chrome on macOS',
          deviceKind: 'desktop',
        },
      ]}
      onRevoke={onRevoke}
    />,
  );

  await act(async () => view.container.querySelector('button')!.click());
  const action = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  )!;
  await act(async () => action.click());
  await settle();
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to sign out the session',
  );

  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')!
      .click(),
  );
  expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();

  await act(async () => view.container.querySelector('button')!.click());
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  expect(onRevoke).toHaveBeenCalledTimes(1);
  await view.unmount();
});

test('session list uses a loading skeleton and an empty state', async () => {
  const loading = await render(
    <SessionList sessions={[]} loading onRevoke={async () => {}} />,
  );
  expect(
    loading.container.querySelector(
      '[role="status"][aria-label="Loading sessions"]',
    ),
  ).not.toBeNull();
  expect(
    loading.container.querySelectorAll('[data-slot="skeleton"]'),
  ).toHaveLength(3);
  expect(loading.container.querySelector('table')).toBeNull();
  await loading.unmount();

  const empty = await render(
    <SessionList sessions={[]} onRevoke={async () => {}} />,
  );
  expect(empty.container.textContent).toContain('No active sessions');
  expect(empty.container.querySelector('table')).toBeNull();
  await empty.unmount();
});

test('security page embeds session errors without a nested main', async () => {
  let sessionsFail = true;
  let twoFactorEnabled = false;
  let resolveRevokeResponse: ((response: Response) => void) | undefined;
  let signalRevokeStarted: (() => void) | undefined;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/identity/security')
      return Response.json({
        version: 1,
        twoFactorEnabled,
        mfaVerified: twoFactorEnabled,
        reauthenticationExpiresAt: null,
        recoveryCodesRemaining: twoFactorEnabled ? 4 : 0,
        passwordChangedAt: '2026-09-18T12:00:00.000Z',
      });
    if (path === '/api/identity/sessions' && sessionsFail)
      return Response.json(
        {
          error: { code: 'AUTH_UNAVAILABLE', message: 'Unavailable' },
        },
        { status: 503 },
      );
    if (path === '/api/identity/sessions')
      return Response.json([
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000003',
          channel: 'cookie',
          createdAt: '2026-11-01T00:00:00Z',
          expiresAt: '2026-11-08T00:00:00Z',
          current: true,
          deviceName: 'Chrome on macOS',
          deviceKind: 'desktop',
        },
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000004',
          channel: 'bearer',
          createdAt: '2026-10-31T00:00:00Z',
          expiresAt: '2026-11-01T00:15:00Z',
          current: false,
          deviceName: 'Word add-in',
          deviceKind: 'desktop',
        },
      ]);
    if (path.startsWith('/api/identity/sessions/'))
      return new Promise<Response>((resolve) => {
        resolveRevokeResponse = resolve;
        signalRevokeStarted?.();
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <PageHeader title="Security settings" />
      <AccountSecurity />
    </QueryClientProvider>,
  );
  await settle();
  expect(view.container.querySelectorAll('h1')).toHaveLength(1);
  expect(view.container.querySelectorAll('main')).toHaveLength(0);
  await view.unmount();

  sessionsFail = false;
  const normal = await render(
    <QueryClientProvider client={new QueryClient()}>
      <PageHeader title="Security settings" />
      <AccountSecurity />
    </QueryClientProvider>,
  );
  await settle();
  expect(normal.container.querySelectorAll('h1')).toHaveLength(1);
  expect(normal.container.querySelectorAll('h2').length).toBeGreaterThan(0);
  await vi.waitFor(() =>
    expect(normal.container.textContent).toContain('This device'),
  );
  expect(normal.container.textContent).toContain('person@example.test');
  expect(normal.container.textContent).toContain('Last changed');
  expect(normal.container.textContent).toContain('Where you are signed in');
  expect(normal.container.textContent).toContain(
    'Manage how you sign in and where you are signed in.',
  );
  toastSuccess.mockClear();
  let signalStarted!: () => void;
  const revokeStarted = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  signalRevokeStarted = signalStarted;
  await act(async () => {
    [...normal.container.querySelectorAll('button')]
      .find(
        (button) =>
          button.getAttribute('aria-label') === 'Sign out Word add-in',
      )
      ?.click();
  });
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]')
      ?.click(),
  );
  await revokeStarted;
  expect(toastSuccess).not.toHaveBeenCalled();
  await act(async () => {
    resolveRevokeResponse?.(new Response(null, { status: 204 }));
    await settle();
  });
  expect(toastSuccess).toHaveBeenCalledOnce();
  expect(toastSuccess).toHaveBeenCalledWith('Session signed out.');
  signalRevokeStarted = undefined;
  resolveRevokeResponse = undefined;
  const revokeOthers = [...normal.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Sign out other sessions',
  );
  expect(revokeOthers).not.toBeUndefined();
  await act(async () => revokeOthers?.click());
  const signOutDialog = document.body.querySelector('[role="alertdialog"]');
  expect(signOutDialog?.textContent).toContain('Sign out other sessions?');
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')
      ?.click(),
  );
  expect(revokeOtherSessions).not.toHaveBeenCalled();
  revokeOtherSessions.mockClear();
  revokeOtherSessions.mockImplementationOnce(async () => ({
    error: { message: 'synthetic sign-out failure' },
  }));
  toastSuccess.mockClear();
  await act(async () => revokeOthers?.click());
  let signOutAction = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  )!;
  await act(async () => signOutAction.click());
  await settle();
  expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
  const signOutErrorDialog = document.body.querySelector(
    '[role="alertdialog"]',
  );
  expect(signOutErrorDialog).not.toBeNull();
  expect(
    signOutErrorDialog?.querySelector('[role="alert"]')?.textContent,
  ).toContain('Unable to sign out other sessions');
  expect(signOutAction.disabled).toBe(false);

  let resolveSignOut!: (result: { error: null }) => void;
  let signalSignOutStarted!: () => void;
  const signOutStarted = new Promise<void>((resolve) => {
    signalSignOutStarted = resolve;
  });
  revokeOtherSessions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSignOut = resolve;
        signalSignOutStarted();
      }),
  );
  await act(async () => signOutAction.click());
  await signOutStarted;
  signOutAction = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  )!;
  expect(signOutAction.disabled).toBe(true);
  expect(signOutAction.textContent).toContain('Signing out other sessions…');
  expect(signOutAction.querySelector('[data-slot="spinner"]')).not.toBeNull();
  await act(async () => signOutAction.click());
  expect(revokeOtherSessions).toHaveBeenCalledTimes(2);
  expect(toastSuccess).not.toHaveBeenCalled();
  await act(async () => resolveSignOut({ error: null }));
  await settle();
  expect(toastSuccess).toHaveBeenCalledOnce();
  expect(toastSuccess).toHaveBeenCalledWith('Other sessions signed out.');
  expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  expect(
    normal.container.querySelector('input[autocomplete="current-password"]'),
  ).toBeNull();
  const changePassword = [...normal.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Change password',
  );
  expect(changePassword).not.toBeUndefined();
  await act(async () => changePassword?.click());
  expect(
    normal.container.querySelector('input[autocomplete="current-password"]'),
  ).not.toBeNull();
  await normal.unmount();

  twoFactorEnabled = true;
  const factor = await render(
    <QueryClientProvider client={new QueryClient()}>
      <PageHeader title="Security settings" />
      <AccountSecurity />
    </QueryClientProvider>,
  );
  await settle();
  expect(factor.container.textContent).toContain('4 recovery codes left');
  expect(
    [...factor.container.querySelectorAll('button')].filter((button) =>
      ['Recovery codes', 'Manage'].includes(button.textContent?.trim() ?? ''),
    ),
  ).toHaveLength(2);
  await act(async () =>
    [...factor.container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Recovery codes')
      ?.click(),
  );
  const recoveryPassword = factor.container.querySelector<HTMLInputElement>(
    'input[autocomplete="current-password"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(recoveryPassword, 'Synthetic-review-password');
    recoveryPassword.dispatchEvent(new Event('input', { bubbles: true }));
    recoveryPassword.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    factor.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(generateBackupCodes).toHaveBeenCalledWith({
    password: 'Synthetic-review-password',
  });
  expect(factor.container.textContent).toContain('rotated-code');
  expect(factor.container.textContent).not.toContain('Lexon');
  const dismissCodes = [...factor.container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'I saved my recovery codes',
  );
  expect(dismissCodes).toBeDefined();
  await act(async () => dismissCodes?.click());
  await act(async () =>
    [...factor.container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Back to security')
      ?.click(),
  );
  await act(async () =>
    [...factor.container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Manage')
      ?.click(),
  );
  expect(factor.container.textContent).toContain(
    'Disable two-factor authentication',
  );
  const password = factor.container.querySelector<HTMLInputElement>(
    'input[autocomplete="current-password"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(password, 'Synthetic-review-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const disable = [...factor.container.querySelectorAll('button')].find(
    (button) =>
      button.textContent?.includes('Disable two-factor authentication'),
  );
  expect(disable).toBeDefined();
  expect(password.value).toBe('Synthetic-review-password');
  await act(async () => disable?.click());
  expect(
    document.body.querySelector('[role="alertdialog"]')?.textContent,
  ).toContain('Disable two-factor authentication?');
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')
      ?.click(),
  );
  expect(disableTwoFactor).not.toHaveBeenCalled();

  disableTwoFactor.mockImplementationOnce(async () => ({
    error: { message: 'synthetic disable failure' },
  }));
  await act(async () => disable?.click());
  const disableAction = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  )!;
  await act(async () => disableAction.click());
  await settle();
  expect(disableTwoFactor).toHaveBeenCalledTimes(1);
  const disableErrorDialog = document.body.querySelector(
    '[role="alertdialog"]',
  );
  expect(disableErrorDialog).not.toBeNull();
  expect(
    disableErrorDialog?.querySelector('[role="alert"]')?.textContent,
  ).toContain('Unable to disable authentication.');
  expect(factor.container.querySelector('[role="alert"]')).toBeNull();
  expect(disableAction.disabled).toBe(false);

  let resolveDisable!: (result: { error: null }) => void;
  let signalDisableStarted!: () => void;
  const disableStarted = new Promise<void>((resolve) => {
    signalDisableStarted = resolve;
  });
  disableTwoFactor.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDisable = resolve;
        signalDisableStarted();
      }),
  );
  toastSuccess.mockClear();
  await act(async () => disableAction.click());
  await disableStarted;
  await vi.waitFor(() => expect(disableTwoFactor).toHaveBeenCalledTimes(2));
  expect(disableAction.disabled).toBe(true);
  expect(disableAction.textContent).toContain(
    'Disabling two-factor authentication…',
  );
  expect(disableAction.querySelector('[data-slot="spinner"]')).not.toBeNull();
  await act(async () => disableAction.click());
  expect(disableTwoFactor).toHaveBeenCalledTimes(2);
  expect(toastSuccess).not.toHaveBeenCalled();
  await act(async () => resolveDisable({ error: null }));
  await settle();
  expect(toastSuccess).toHaveBeenCalledOnce();
  expect(toastSuccess).toHaveBeenCalledWith(
    'Two-factor authentication disabled.',
  );
  await factor.unmount();
  disableTwoFactor.mockClear();
  generateBackupCodes.mockClear();
  vi.unstubAllGlobals();
});

test('security title is a serif h2 and its rows separate label from action', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/identity/security')
      return Response.json({
        version: 1,
        twoFactorEnabled: false,
        mfaVerified: false,
        reauthenticationExpiresAt: null,
        recoveryCodesRemaining: 0,
        passwordChangedAt: null,
      });
    return Response.json([]);
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountSecurity />
    </QueryClientProvider>,
  );
  await settle();
  await vi.waitFor(() =>
    expect(view.container.querySelector('#security-heading')).not.toBeNull(),
  );
  const heading = view.container.querySelector('#security-heading')!;
  expect(heading.tagName).toBe('H2');
  expect(heading.className).toContain('font-serif');
  const rows = [
    ...view.container.querySelectorAll('[data-slot="security-row"]'),
  ];
  expect(rows.length).toBe(3);
  rows
    .slice(0, -1)
    .forEach((row) => expect(row.className).toContain('border-b'));
  await view.unmount();
  vi.unstubAllGlobals();
});

test('the password and two-step rows read as the prototype does', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/identity/security')
      return Response.json({
        version: 1,
        twoFactorEnabled: true,
        mfaVerified: true,
        reauthenticationExpiresAt: null,
        recoveryCodesRemaining: 8,
        passwordChangedAt: '2026-09-18T12:00:00.000Z',
      });
    if (path === '/api/identity/sessions') return Response.json([]);
    throw new Error(`Unexpected request: ${path}`);
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountSecurity />
    </QueryClientProvider>,
  );
  await settle();
  const rows = [
    ...view.container.querySelectorAll('[data-slot="security-row"]'),
  ].map((row) => row.textContent);
  expect(rows[0]).toBe('PasswordLast changed 2 months ago.Change password');
  expect(rows.at(-1)).toContain('Two-step verificationOn');
  expect(rows.at(-1)).toContain('Authenticator app. 8 recovery codes left.');
  await view.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
