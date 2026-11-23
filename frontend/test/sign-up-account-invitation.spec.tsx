import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { render, settle } from './render';
const signUp = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth-client', () => ({
  authClient: { $fetch: signUp },
}));
import { SignupForm } from '../src/components/auth/signup-form';

const assign = vi.fn();
beforeEach(() => {
  vi.stubGlobal('location', {
    origin: 'http://localhost:3000',
    href: 'http://localhost:3000/sign-up',
    pathname: '/sign-up',
    assign,
  });
});
afterEach(() => {
  signUp.mockReset();
  assign.mockReset();
  vi.unstubAllGlobals();
});

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
const fillAndSubmit = async (container: HTMLElement) => {
  await setInput(
    container.querySelector<HTMLInputElement>('input[autocomplete="name"]')!,
    'Ayu Wardani',
  );
  await setInput(
    container.querySelector<HTMLInputElement>('input[type="email"]')!,
    'ayu@firm.co.id',
  );
  await setInput(
    container.querySelector<HTMLInputElement>('input[type="password"]')!,
    'Valid-password-42!',
  );
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
};

test('an account invitation token is sent with the sign-up; email and name stay empty and editable', async () => {
  signUp.mockResolvedValueOnce({ data: { token: null }, error: null });
  const view = await render(
    <SignupForm accountInvitation="invite-token-1" returnTo="/workspace" />,
  );
  const name = view.container.querySelector<HTMLInputElement>(
    'input[autocomplete="name"]',
  )!;
  const email = view.container.querySelector<HTMLInputElement>(
    'input[type="email"]',
  )!;
  for (const input of [name, email]) {
    expect(input.value).toBe('');
    expect(input.readOnly).toBe(false);
    expect(input.disabled).toBe(false);
  }
  await fillAndSubmit(view.container);
  expect(signUp).toHaveBeenCalledTimes(1);
  expect(signUp.mock.calls[0]![0]).toBe('/sign-up/email');
  expect(signUp.mock.calls[0]![1].body).toMatchObject({
    name: 'Ayu Wardani',
    email: 'ayu@firm.co.id',
    accountInvitationToken: 'invite-token-1',
  });
  await view.unmount();
});

test('a refused invitation sign-up shows the invitation unavailable state', async () => {
  signUp.mockResolvedValueOnce({
    data: null,
    error: {
      status: 401,
      statusText: 'Unauthorized',
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' },
    },
  });
  const view = await render(<SignupForm accountInvitation="invite-token-1" />);
  await fillAndSubmit(view.container);
  expect(view.container.querySelector('h1')?.textContent).toBe(
    'Invitation unavailable',
  );
  expect(view.container.textContent).toContain(
    'This invitation was cancelled, has expired, or has already been used. Ask the person who invited you to send a new one.',
  );
  expect(
    [...view.container.querySelectorAll('a')].some(
      (link) => link.textContent === 'Go to Lexon',
    ),
  ).toBe(true);
  expect(view.container.querySelector('form')).toBeNull();
  expect(assign).not.toHaveBeenCalled();
  await view.unmount();
});

test('an invalid-format invitation token shows the unavailable state without a request', async () => {
  const view = await render(<SignupForm accountInvitation="" />);
  expect(view.container.querySelector('h1')?.textContent).toBe(
    'Invitation unavailable',
  );
  expect(view.container.querySelector('form')).toBeNull();
  expect(signUp).not.toHaveBeenCalled();
  await view.unmount();
});

test('a successful invitation sign-up goes to sign in, keeping returnTo, without the verify-email screen', async () => {
  signUp.mockResolvedValueOnce({ data: { token: null }, error: null });
  const view = await render(
    <SignupForm accountInvitation="invite-token-1" returnTo="/workspace?x=1" />,
  );
  await fillAndSubmit(view.container);
  expect(assign).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith(
    '/sign-in?returnTo=' + encodeURIComponent('/workspace?x=1'),
  );
  expect(view.container.textContent).not.toContain('Verify your email');
  await view.unmount();
});

test('without an invitation the body has no token and success still shows Verify your email', async () => {
  signUp.mockResolvedValueOnce({ data: { token: null }, error: null });
  const view = await render(<SignupForm returnTo="/workspace" />);
  await fillAndSubmit(view.container);
  expect(signUp).toHaveBeenCalledTimes(1);
  expect(signUp.mock.calls[0]![1].body).not.toHaveProperty(
    'accountInvitationToken',
  );
  expect(view.container.textContent).toContain('Verify your email');
  expect(assign).not.toHaveBeenCalled();
  await view.unmount();
});
