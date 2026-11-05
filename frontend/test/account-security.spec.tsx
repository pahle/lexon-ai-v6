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
test('session list distinguishes Browser and Bearer and revokes only by safe id', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  let revoked = '';
  const rows = [
    {
      version: 1 as const,
      id,
      channel: 'bearer' as const,
      createdAt: '2026-11-01T00:00:00Z',
      expiresAt: '2026-11-01T00:15:00Z',
      current: false,
      token: 'token-secret-sentinel',
    },
    {
      version: 1 as const,
      id: '00000000-0000-4000-8000-000000000002',
      channel: 'cookie' as const,
      createdAt: '2026-11-01T00:00:00Z',
      expiresAt: '2026-11-08T00:00:00Z',
      current: true,
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
  expect(view.container.textContent).toContain('Browser');
  expect(view.container.textContent).toContain('Bearer');
  expect(view.container.querySelector('table')).not.toBeNull();
  expect(view.container.textContent).toContain('Where you are signed in');
  expect(view.container.textContent).toContain('Expires');
  expect(view.container.textContent).toContain('Signed in');
  expect(view.container.textContent).not.toContain('Device');
  expect(view.container.textContent).not.toContain('Last active');
  expect(view.container.textContent?.includes('token-secret-sentinel')).toBe(
    false,
  );
  expect(view.container.querySelector('tbody tr')?.textContent).toContain(
    'Current',
  );
  expect(view.container.querySelector('tbody tr')?.textContent).toContain(
    'Browser',
  );
  const revokeRowAction =
    view.container.querySelector<HTMLButtonElement>('tbody tr button');
  expect(revokeRowAction?.className).toContain('text-destructive');
  await act(async () => view.container.querySelector('button')!.click());
  expect(revoked).toBe('');
  const cancel = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-cancel"]',
  );
  expect(cancel).not.toBeNull();
  await act(async () => cancel?.click());
  expect(revoked).toBe('');
  await act(async () => view.container.querySelector('button')!.click());
  const confirm = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-action"]',
  );
  expect(confirm).not.toBeNull();
  await act(async () => confirm?.click());
  expect(revoked).toBe(id);
  await view.unmount();
});

test('sessions render current first with shared local date and time formatting', async () => {
  const localTime = new Date(2026, 10, 4, 18, 2).toISOString();
  const view = await render(
    <SessionList
      sessions={[
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000031',
          channel: 'bearer',
          createdAt: localTime,
          expiresAt: localTime,
          current: false,
        },
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000032',
          channel: 'cookie',
          createdAt: localTime,
          expiresAt: localTime,
          current: true,
        },
      ]}
      onRevoke={async () => {}}
    />,
  );
  const rows = [...view.container.querySelectorAll('tbody tr')];
  expect(rows[0]?.textContent).toContain('Browser');
  expect(rows[0]?.textContent).toContain('Current');
  expect(rows[0]?.textContent).toContain('Nov 4, 2026, 18:02');
  expect(rows[0]?.textContent).not.toMatch(/:\d{2}:\d{2}/);
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
  expect(action.textContent).toContain('Revoking session…');
  expect(action.querySelector('[data-slot="spinner"]')).not.toBeNull();
  await act(async () => action.click());
  expect(onRevoke).toHaveBeenCalledTimes(1);

  await act(async () => rejectRevoke(new Error('synthetic revoke failure')));
  await settle();
  const revokeDialog = document.body.querySelector('[role="alertdialog"]');
  expect(revokeDialog).not.toBeNull();
  expect(revokeDialog?.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to revoke the session',
  );
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  expect(action.disabled).toBe(false);
  expect(action.textContent).toContain('Revoke session');
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
  expect(
    document.body.querySelector('[role="alert"]')?.textContent,
  ).toContain('Unable to revoke the session');

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
        },
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000004',
          channel: 'bearer',
          createdAt: '2026-10-31T00:00:00Z',
          expiresAt: '2026-11-01T00:15:00Z',
          current: false,
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
    expect(normal.container.textContent).toContain('Browser'),
  );
  expect(normal.container.textContent).toContain('person@example.test');
  expect(normal.container.textContent).toContain('Browser');
  expect(normal.container.textContent).toContain('Signed in');
  expect(normal.container.textContent).toContain('Where you are signed in');
  expect(normal.container.textContent).toContain('Expires');
  expect(normal.container.textContent).not.toContain('Device');
  expect(normal.container.textContent).not.toContain('Last active');
  toastSuccess.mockClear();
  let signalStarted!: () => void;
  const revokeStarted = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  signalRevokeStarted = signalStarted;
  await act(async () => {
    [...normal.container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Revoke Bearer session'))
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
  expect(toastSuccess).toHaveBeenCalledWith('Session revoked.');
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
