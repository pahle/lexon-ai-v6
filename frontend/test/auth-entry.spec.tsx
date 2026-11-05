import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { render, settle } from './render';
const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
const sendVerificationEmail = vi.hoisted(() => vi.fn());
const requestPasswordReset = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth-client', () => ({
  authClient: {
    signIn: { email: signIn },
    sendVerificationEmail,
    requestPasswordReset,
    $fetch: signUp,
  },
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
afterEach(() => {
  signIn.mockReset();
  signUp.mockReset();
  sendVerificationEmail.mockReset();
  requestPasswordReset.mockReset();
  toastSuccess.mockReset();
});
import { LoginForm } from '../src/components/auth/login-form';
import { SignupForm } from '../src/components/auth/signup-form';
test('login credentials and submit start disabled in server-rendered HTML', () => {
  const markup = renderToString(<LoginForm />);
  const credentialInputs = [...markup.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((input) => /type="email"|type="password"/.test(input));
  expect(credentialInputs).toHaveLength(2);
  for (const input of credentialInputs) expect(input).toContain('disabled=""');
  const showPassword = markup.match(
    /<button\b[^>]*aria-label="Show password"[^>]*>/,
  )?.[0];
  const submit = markup.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
  expect(showPassword).toContain('disabled=""');
  expect(submit).toContain('disabled=""');
});

test('login credentials and submit enable after the client mounts', async () => {
  const view = await render(<LoginForm />);
  expect(
    view.container.querySelector<HTMLInputElement>('input[type="email"]')!
      .disabled,
  ).toBe(false);
  expect(
    view.container.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )!.disabled,
  ).toBe(false);
  expect(
    view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show password"]',
    )!.disabled,
  ).toBe(false);
  expect(
    view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!
      .disabled,
  ).toBe(false);
  await view.unmount();
});
test('chosen login and signup forms have no social controls or decorative image and validate before network', async () => {
  for (const component of [
    <LoginForm key="login" />,
    <SignupForm key="signup" />,
  ]) {
    const view = await render(component);
    expect(view.container.querySelector('h1')).not.toBeNull();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.textContent).not.toMatch(
      /Google|GitHub|Microsoft|Apple/,
    );
    await act(async () => {
      view.container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    await settle();
    expect(signIn).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
    await view.unmount();
  }
});
test('invalid sign-in is field-linked and corrects live after its first submit', async () => {
  const view = await render(<LoginForm />);
  const form = view.container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await settle();
  const email = view.container.querySelector<HTMLInputElement>(
    'input[type="email"]',
  )!;
  const password = view.container.querySelector<HTMLInputElement>(
    'input[type="password"]',
  )!;
  expect(signIn).not.toHaveBeenCalled();
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(
    email.closest('[data-slot="field"]')?.getAttribute('data-invalid'),
  ).toBe('true');
  expect(email.getAttribute('aria-describedby')).toContain('error');
  expect(
    [...view.container.querySelectorAll('[data-slot="field-error"]')].map(
      (error) => error.textContent,
    ),
  ).toContain('Enter a valid email address.');
  expect(password.getAttribute('aria-invalid')).toBe('true');
  expect(
    [...view.container.querySelectorAll('[data-slot="field-error"]')].map(
      (error) => error.textContent,
    ),
  ).toContain('Enter your password.');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(email, 'person@example.test');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    email.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  expect(email.getAttribute('aria-invalid')).not.toBe('true');
  expect(email.getAttribute('aria-describedby')).toBeNull();
  expect(password.getAttribute('aria-invalid')).toBe('true');
  await view.unmount();
});

test('password visibility preserves registered value and autocomplete without submitting', async () => {
  const view = await render(<LoginForm />);
  const password = view.container.querySelector<HTMLInputElement>(
    'input[autocomplete="current-password"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(password, 'Keep-this-value-42!');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const show = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Show password"]',
  );
  expect(show).not.toBeNull();
  const addon = show?.closest(
    '[data-slot="input-group-addon"][data-align="inline-end"]',
  );
  expect(addon).not.toBeNull();
  expect(addon?.contains(show)).toBe(true);
  expect(show?.type).toBe('button');
  expect(show?.getAttribute('aria-pressed')).toBe('false');
  await act(async () => show?.click());
  expect(password.type).toBe('text');
  expect(password.value).toBe('Keep-this-value-42!');
  expect(password.autocomplete).toBe('current-password');
  expect(
    view.container
      .querySelector<HTMLButtonElement>('button[aria-label="Hide password"]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(signIn).not.toHaveBeenCalled();
  await view.unmount();
});

test('pending sign-in keeps fields readable and blocks repeat activation', async () => {
  let release!: (value: unknown) => void;
  signIn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = await render(<LoginForm />);
  const setValue = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  await setValue(
    view.container.querySelector<HTMLInputElement>('input[type="email"]')!,
    'person@example.test',
  );
  await setValue(
    view.container.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )!,
    'Valid-password-42!',
  );
  const button = view.container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  await act(async () => button.click());
  await settle();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('Signing in…');
  expect(
    view.container.querySelector<HTMLInputElement>('input[type="email"]')!
      .value,
  ).toBe('person@example.test');
  await act(async () => {
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    button.click();
  });
  expect(signIn).toHaveBeenCalledTimes(1);
  await act(async () => release({ data: null, error: { status: 401 } }));
  await settle();
  expect(button.disabled).toBe(false);
  await view.unmount();
});

test('a successful password-reset request sends one non-blocking confirmation toast', async () => {
  requestPasswordReset.mockResolvedValueOnce({ data: { status: true } });
  const view = await render(<PasswordRecoveryForm mode="request" />);
  const email = view.container.querySelector<HTMLInputElement>(
    'input[type="email"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(email, 'person@example.test');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    email.dispatchEvent(new Event('change', { bubbles: true }));
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(requestPasswordReset).toHaveBeenCalledTimes(1);
  expect(toastSuccess).toHaveBeenCalledTimes(1);
  expect(toastSuccess).toHaveBeenCalledWith(
    'If eligible, you will receive a password reset link.',
  );
  expect(view.container.querySelector('[role="status"]')?.textContent).toBe(
    'If eligible, you will receive a password reset link.',
  );
  await view.unmount();
});
test('signin preserves invitation proof when moving to signup', async () => {
  const invitationId = '00000000-0000-4000-8000-000000000001';
  const view = await render(
    <LoginForm returnTo={'/accept-invitation?invitationId=' + invitationId} />,
  );
  const link = [...view.container.querySelectorAll('a')].find(
    (a) => a.textContent === 'Create account',
  )!;
  expect(new URL(link.href).searchParams.get('invitationId')).toBe(
    invitationId,
  );
  await view.unmount();
});
test('verification resend appears only after credential-checked unverified sign-in', async () => {
  const email = 'person@example.test';
  const returnTo = '/workspace?tab=recent';
  const view = await render(<LoginForm returnTo={returnTo} />);
  expect(view.container.textContent).not.toContain('Resend verification email');
  const inputs = view.container.querySelectorAll<HTMLInputElement>('input');
  const setInput = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  await setInput(inputs[0]!, email);
  await setInput(inputs[1]!, 'Valid-password-42!');
  signIn.mockResolvedValueOnce({
    error: {
      status: 403,
      error: {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address before signing in.',
      },
    },
  });
  await act(async () => {
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(view.container.textContent).toContain('Check your email');
  expect(view.container.textContent).toContain('Resend verification email');
  expect(
    view.container.querySelector<HTMLInputElement>('input[type="email"]')
      ?.value,
  ).toBe(email);
  expect(
    [...view.container.querySelectorAll<HTMLAnchorElement>('a')].some((a) =>
      a.href.includes(email),
    ),
  ).toBe(false);
  expect(
    view.container.querySelector<HTMLAnchorElement>('a[href*="returnTo"]')
      ?.href,
  ).toContain(encodeURIComponent(returnTo));
  sendVerificationEmail.mockResolvedValueOnce({ data: { status: true } });
  await act(async () => {
    view.container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click();
  });
  await settle();
  expect(sendVerificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      email,
      callbackURL: expect.stringContaining(
        '/verify-email?state=confirmed&returnTo=',
      ),
    }),
  );
  expect(sendVerificationEmail.mock.calls[0]![0].callbackURL).not.toContain(
    email,
  );
  await view.unmount();
});
test('unrelated forbidden sign-in errors stay generic and do not show verification resend', async () => {
  const view = await render(<LoginForm />);
  const inputs = view.container.querySelectorAll<HTMLInputElement>('input');
  for (const [input, value] of [
    [inputs[0]!, 'person@example.test'],
    [inputs[1]!, 'Valid-password-42!'],
  ] as const) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  signIn.mockResolvedValueOnce({
    error: {
      status: 403,
      error: { code: 'AUTH_REQUIRED', message: 'private-server-sentinel' },
    },
  });
  await act(async () => {
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(view.container.textContent).toContain(
    'Email or password is incorrect. Check them and try again.',
  );
  const alert = view.container.querySelector('[role="alert"]')!;
  expect(alert.querySelector('svg')).not.toBeNull();
  expect(alert.querySelector('[data-slot="alert-title"]')).toBeNull();
  expect(
    alert.querySelector('[data-slot="alert-description"]')?.textContent,
  ).toBe('Email or password is incorrect. Check them and try again.');
  expect(view.container.textContent).not.toContain('private-server-sentinel');
  const fieldGroup = view.container.querySelector('[data-slot="field-group"]')!;
  const orderedChildren = [...fieldGroup.children];
  expect(
    orderedChildren.indexOf(
      view.container.querySelector('[data-slot="alert"]')!,
    ),
  ).toBeLessThan(
    orderedChildren.indexOf(
      view.container
        .querySelector('input[type="email"]')!
        .closest('[data-slot="field"]')!,
    ),
  );
  expect(view.container.textContent).not.toContain('Resend verification email');
  await view.unmount();
});
import { authFailure } from '../src/components/auth/form-input';
import { PasswordRecoveryForm } from '../src/components/auth/password-recovery-form';
import { VerificationState } from '../src/components/auth/verification-state';
test('account errors are indistinguishable and malformed links offer safe recovery', async () => {
  expect(authFailure({ status: 401, code: 'UNKNOWN_EMAIL' })).toBe(
    authFailure({ status: 401, code: 'WRONG_PASSWORD' }),
  );
  expect(authFailure({ status: 503 })).toMatch(/temporarily unavailable/);
  for (const node of [
    <PasswordRecoveryForm key="reset" mode="reset" />,
    <VerificationState key="verify" state="expired" />,
  ]) {
    const view = await render(node);
    expect(view.container.textContent).not.toMatch(/token|stack|host/i);
    expect(view.container.querySelector('a')).not.toBeNull();
    await view.unmount();
  }
});
import InvitationPage from '../src/app/(auth)/accept-invitation/page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
test('invitation email id query reaches the acceptance action', async () => {
  const searchParams = Promise.resolve({
    id: '00000000-0000-4000-8000-000000000001',
    invitationId: '',
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      {await InvitationPage({ searchParams })}
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('button')?.textContent).toContain(
    'Accept invitation',
  );
  expect(
    [...view.container.querySelectorAll('button')].some((button) =>
      button.textContent?.includes('Decline invitation'),
    ),
  ).toBe(true);
  await view.unmount();
});
test('a rejected recipient can change accounts without losing invitation intent', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { error: { code: 'INVITATION_UNAVAILABLE', message: 'Unavailable' } },
      { status: 403 },
    ),
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      {await InvitationPage({
        searchParams: Promise.resolve({
          invitationId: '00000000-0000-4000-8000-000000000001',
        }),
      })}
    </QueryClientProvider>,
  );
  await act(async () => view.container.querySelector('button')!.click());
  await settle();
  expect(
    [...view.container.querySelectorAll('button')].some((button) =>
      button.textContent?.includes('Use another account'),
    ),
  ).toBe(true);
  await view.unmount();
  vi.unstubAllGlobals();
});
