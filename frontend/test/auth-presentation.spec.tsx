import { createElement } from 'react';
import { expect, test } from 'vitest';
import AuthLayout from '../src/app/(auth)/layout';
import { render } from './render';
import { AUTH_COVER_STATEMENT } from '../src/components/auth/auth-frame';
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
  const formColumn = view.container.querySelector('main')?.firstElementChild;
  expect(formColumn?.className).toContain('bg-muted');
  const cover = view.container.querySelector('[aria-hidden="true"].lg\\:block');
  expect(cover?.className).toContain('hidden');
  expect(cover?.className).toContain('bg-(--lexon-night)');
  expect(cover?.firstElementChild?.className).toContain('flex-col');
  expect(cover?.className.split(' ')).toContain('dark');
  expect(cover?.className).toContain('text-white');
  const rule = cover?.querySelector('div[aria-hidden="true"]');
  expect(rule?.className).toContain('bg-(--lexon-red-text)');
  const tagline = [...(cover?.querySelectorAll('p') ?? [])].find((el) =>
    el.textContent?.startsWith('The AI workspace'),
  );
  expect(tagline?.className).toContain('text-(--lexon-red-text)');
  const url = [...(cover?.querySelectorAll('span') ?? [])].find(
    (el) => el.textContent === 'lexon-ai.com',
  );
  expect(url?.className).toContain('text-muted-foreground');
  for (const el of [rule, tagline, url, cover]) {
    expect(el?.className).not.toContain('[#');
  }
  expect(cover?.querySelector('[aria-hidden="true"]:not(img)')).not.toBeNull();
  expect(cover?.textContent).toContain(
    'The AI workspace for Indonesian legal practitioners',
  );
  expect(cover?.textContent).toContain('lexon-ai.com');
  expect(cover?.textContent).not.toContain('Every answer names the article');
  const statement = [...(cover?.querySelectorAll('*') ?? [])].find(
    (el) => el.children.length === 0 && el.textContent === AUTH_COVER_STATEMENT,
  );
  expect(AUTH_COVER_STATEMENT).toBe(
    'Read, draft, and check Indonesian law in one quiet workspace.',
  );
  expect(statement?.className).toContain('font-serif');
  // The statement sits in its own flexible row, vertically centered.
  const statementRow = statement?.parentElement;
  expect(statementRow?.className).toContain('flex-1');
  expect(statementRow?.className).toContain('items-center');
  expect(
    cover?.querySelector('img[src*="wordmark-compact-white"]'),
  ).not.toBeNull();
  expect(
    cover
      ?.querySelector('img[src*="wordmark-compact-white"]')
      ?.getAttribute('alt'),
  ).toBe('');
  expect(view.container.querySelectorAll('img[alt="Lexon"]')).toHaveLength(2);
  expect(
    cover?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
  ).toHaveLength(0);
  expect(
    view.container
      .querySelector('main > div:first-child')
      ?.querySelector('img[src*="wordmark-compact-ink"]'),
  ).not.toBeNull();
  expect(view.container.querySelectorAll('h1')).toHaveLength(1);
  expect(
    view.container
      .querySelector('img[src*="wordmark-compact-ink"]')
      ?.getAttribute('width'),
  ).toBe('128');
  expect(
    view.container
      .querySelector('img[src*="wordmark-compact-white"]')
      ?.getAttribute('width'),
  ).toBe('128');
  expect(view.container.querySelector('img[src*="placeholder"]')).toBeNull();
  await view.unmount();
});

test('real sign-in and sign-up use the left-aligned serif form heading hierarchy', async () => {
  for (const Form of [LoginForm, SignupForm]) {
    const view = await render(
      createElement(AuthLayout, null, createElement(Form)),
    );
    const heading = view.container.querySelector('h1');
    expect(heading?.parentElement?.className).toContain('items-start');
    expect(heading?.parentElement?.className).toContain('text-left');
    expect(heading?.parentElement?.className).not.toContain('text-center');
    expect(heading?.className).toContain('font-serif');
    expect(heading?.className).toContain('text-3xl');
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
    expect(
      view.container.querySelector('button[aria-label="Show password"]'),
    ).not.toBeNull();
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
      expect(heading?.textContent).toBe('Create your account');
      expect(heading?.parentElement?.querySelector('p')?.textContent).toBe(
        'Your legal workspace starts here.',
      );
      expect(
        view.container
          .querySelector('a[href^="/sign-in"]')
          ?.parentElement?.getAttribute('data-slot'),
      ).toBe('field-description');
    }
    await view.unmount();
  }
});
