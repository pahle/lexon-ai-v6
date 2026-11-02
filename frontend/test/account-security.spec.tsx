import { test, expect, vi } from 'vitest';
import { useState, act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';
import { RecoveryCodes } from '../src/components/auth/recovery-codes';
import { SessionList } from '../src/components/auth/session-list';
import { AccountSecurity } from '../src/components/auth/account-security';
import { PageHeader } from '../src/components/shell/page-header';
import { TwoFactorEnrollment } from '../src/components/auth/two-factor-enrollment';

vi.mock('../src/lib/auth-client', () => ({
  authClient: {
    twoFactor: {
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
  expect(view.container.textContent?.includes('token-secret-sentinel')).toBe(
    false,
  );
  await act(async () => view.container.querySelector('button')!.click());
  expect(revoked).toBe(id);
  await view.unmount();
});

test('security page embeds session errors without a nested main', async () => {
  let sessionsFail = true;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/identity/security')
      return Response.json({
        version: 1,
        twoFactorEnabled: false,
        mfaVerified: false,
        reauthenticationExpiresAt: null,
        recoveryCodesRemaining: 0,
      });
    if (path === '/api/identity/sessions' && sessionsFail)
      return Response.json(
        {
          error: { code: 'AUTH_UNAVAILABLE', message: 'Unavailable' },
        },
        { status: 503 },
      );
    if (path === '/api/identity/sessions') return Response.json([]);
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
  await normal.unmount();
  vi.unstubAllGlobals();
});
