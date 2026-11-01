import { expect, test, vi } from 'vitest';
import { act } from 'react';
import { render, settle } from './render';
const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth-client', () => ({
  authClient: { signIn: { email: signIn }, $fetch: signUp },
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
