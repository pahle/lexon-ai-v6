import { expect, test, vi } from 'vitest';
import { act } from 'react';
import { render, settle } from './render';
const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
const sendVerificationEmail = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth-client', () => ({
  authClient: {
    signIn: { email: signIn },
    sendVerificationEmail,
    $fetch: signUp,
  },
}));
import { LoginForm } from '../src/components/auth/login-form';
import { SignupForm } from '../src/components/auth/signup-form';
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
    error: { status: 403, error: { code: 'AUTH_REQUIRED' } },
  });
  await act(async () => {
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(view.container.textContent).toContain(
    'Unable to complete the request. Check your details or try again.',
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
  expect(view.container.querySelector('button')?.textContent).toBe(
    'Accept invitation',
  );
  expect(
    [...view.container.querySelectorAll('button')].some(
      (button) => button.textContent === 'Decline invitation',
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
    [...view.container.querySelectorAll('button')].some(
      (button) => button.textContent === 'Use another account',
    ),
  ).toBe(true);
  await view.unmount();
  vi.unstubAllGlobals();
});
