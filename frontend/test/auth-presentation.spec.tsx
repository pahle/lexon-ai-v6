import { createElement } from 'react';
import { expect, test } from 'vitest';
import AuthLayout from '../src/app/(auth)/layout';
import { render } from './render';
import { LoginForm } from '../src/components/auth/login-form';
import { SignupForm } from '../src/components/auth/signup-form';

test('account layout uses the published frame and one labeled heading', async () => {
  const view = await render(
    createElement(AuthLayout, null, createElement('h1', null, 'Sign in')),
  );
  expect(view.container.querySelector('main')?.className).toContain(
    'lg:grid-cols-2',
  );
  expect(view.container.querySelector('.w-full.max-w-xs')).not.toBeNull();
  expect(
    view.container.querySelector('[aria-hidden="true"].lg\\:block')
      ?.textContent,
  ).toBe('');
  expect(view.container.querySelectorAll('h1')).toHaveLength(1);
  expect(
    view.container
      .querySelector('img[src*="wordmark-compact-ink"]')
      ?.getAttribute('width'),
  ).toBe('160');
  expect(view.container.querySelector('img[src*="placeholder"]')).toBeNull();
  await view.unmount();
});

test('real sign-in and sign-up use the centered published form heading hierarchy', async () => {
  for (const Form of [LoginForm, SignupForm]) {
    const view = await render(
      createElement(AuthLayout, null, createElement(Form)),
    );
    const heading = view.container.querySelector('h1');
    expect(heading?.parentElement?.className).toContain('items-center');
    expect(heading?.parentElement?.className).toContain('text-center');
    expect(heading?.className).toContain('font-serif');
    expect(heading?.className).toContain('text-2xl');
    expect(heading?.className).toContain('font-bold');
    expect(
      heading?.parentElement?.parentElement?.getAttribute('data-slot'),
    ).toBe('field-group');
    expect(view.container.querySelector('form')?.className).toContain('gap-6');
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('[data-slot="card"]')).toBeNull();
    const submit = view.container.querySelector('button[type="submit"]');
    expect(submit?.parentElement?.getAttribute('data-slot')).toBe('field');
    expect(view.container.querySelector('img[src*="placeholder"]')).toBeNull();
    expect(view.container.querySelector('button[type="button"]')).toBeNull();
    if (Form === LoginForm) {
      const forgotPassword = view.container.querySelector(
        'a[href="/forgot-password"]',
      );
      expect(forgotPassword?.parentElement?.className).toContain(
        'items-center',
      );
      expect(
        forgotPassword?.parentElement?.querySelector('label')?.textContent,
      ).toBe('Password');
      expect(
        view.container
          .querySelector('a[href^="/sign-up"]')
          ?.parentElement?.getAttribute('data-slot'),
      ).toBe('field-description');
    } else {
      expect(
        view.container
          .querySelector('a[href^="/sign-in"]')
          ?.parentElement?.getAttribute('data-slot'),
      ).toBe('field-description');
    }
    await view.unmount();
  }
});
