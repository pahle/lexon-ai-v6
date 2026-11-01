import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { AuthCard } from '../src/components/auth/auth-card';
import { Field, FieldLabel, FieldError } from '../src/components/ui/field';
import { Input } from '../src/components/ui/input';
test('auth card fields have linked labels and errors with no social or decorative content', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        AuthCard,
        { title: 'Sign in', description: 'Use your account' },
        createElement(
          Field,
          null,
          createElement(FieldLabel, { htmlFor: 'email' }, 'Email'),
          createElement(Input, {
            id: 'email',
            'aria-invalid': true,
            'aria-describedby': 'email-error',
          }),
          createElement(
            FieldError,
            { id: 'email-error' },
            'Unable to sign in.',
          ),
        ),
      ),
    ),
  );
  expect(host.querySelector('label')?.htmlFor).toBe('email');
  expect(host.querySelector('input')?.getAttribute('aria-describedby')).toBe(
    'email-error',
  );
  expect(host.textContent).toContain('Sign in');
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).not.toMatch(/Google|GitHub|Facebook/);
  await act(async () => root.unmount());
  host.remove();
});
