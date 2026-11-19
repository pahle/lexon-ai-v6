import { createElement } from 'react';
import { expect, test } from 'vitest';
import AuthLayout from '../src/app/(auth)/layout';
import { render } from './render';
import { AUTH_COVER_STATEMENT } from '../src/components/auth/auth-frame';
import { LoginForm } from '../src/components/auth/login-form';
import { SignupForm } from '../src/components/auth/signup-form';

test('account layout uses the v3.1 frame: two columns from 768px, one wordmark, Night cover', async () => {
  const view = await render(
    createElement(AuthLayout, null, createElement('h1', null, 'Sign in')),
  );
  const main = view.container.querySelector('main');
  expect(main?.className).toContain('md:grid-cols-2');
  expect(main?.className).not.toContain('lg:');
  const formColumn = view.container.querySelector(
    '[data-slot="auth-form-column"]',
  );
  expect(formColumn?.className).toContain('md:bg-sidebar');
  expect(formColumn?.className).toContain('md:p-10');
  expect(formColumn?.className).toContain('px-5');
  expect(formColumn?.className).toContain('py-7');
  expect(formColumn?.className).toContain('justify-between');
  expect(main?.className).toContain('bg-background');
  expect(view.container.querySelector('.max-w-\\[400px\\]')).not.toBeNull();
  const cover = view.container.querySelector('[aria-hidden="true"].md\\:flex');
  expect(cover?.className).toContain('hidden');
  expect(cover?.className).toContain('p-12');
  expect(cover?.className).toContain('bg-(--lexon-night)');
  expect(cover?.className.split(' ')).toContain('dark');
  const rule = cover?.querySelector('div[aria-hidden="true"]');
  expect(rule?.className).toContain('h-0.5');
  expect(rule?.className).toContain('w-10');
  expect(rule?.className).toContain('bg-(--lexon-red-text)');
  const tagline = [...(cover?.querySelectorAll('p') ?? [])].find((el) =>
    el.textContent?.startsWith('The AI workspace'),
  );
  expect(tagline?.className).toContain('text-[13px]');
  expect(tagline?.className).toContain('text-(--lexon-red-text)');
  const url = [...(cover?.querySelectorAll('span') ?? [])].find(
    (el) => el.textContent === 'lexon-ai.com',
  );
  expect(url?.className).toContain('text-[13px]');
  expect(url?.parentElement?.className).toContain('justify-end');
  for (const el of [rule, tagline, url, cover])
    expect(el?.className).not.toContain('[#');
  expect(AUTH_COVER_STATEMENT).toBe(
    'Read, draft, and check Indonesian law in one quiet workspace.',
  );
  const statement = [...(cover?.querySelectorAll('p') ?? [])].find(
    (el) => el.textContent === AUTH_COVER_STATEMENT,
  );
  expect(statement?.className).toContain('font-serif');
  expect(statement?.className).toContain('text-[44px]');
  expect(statement?.className).toContain('leading-[1.15]');
  expect(statement?.className).toContain('max-w-[520px]');
  // No wordmark on the cover: the only images are the form column's two
  // theme variants.
  expect(cover?.querySelector('img')).toBeNull();
  expect(view.container.querySelectorAll('img')).toHaveLength(2);
  expect(view.container.querySelectorAll('img[alt="Lexon"]')).toHaveLength(2);
  expect(
    formColumn?.querySelector('img[src*="wordmark-compact-ink"]'),
  ).not.toBeNull();
  for (const tone of ['ink', 'white'])
    expect(
      view.container
        .querySelector(`img[src*="wordmark-compact-${tone}"]`)
        ?.getAttribute('width'),
    ).toBe('96');
  expect(
    cover?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
  ).toHaveLength(0);
  expect(view.container.querySelectorAll('h1')).toHaveLength(1);
  expect(view.container.querySelector('img[src*="placeholder"]')).toBeNull();
  await view.unmount();
});

test('real sign-in and sign-up use the v3.1 title block and form rhythm', async () => {
  for (const Form of [LoginForm, SignupForm]) {
    const view = await render(
      createElement(AuthLayout, null, createElement(Form)),
    );
    const heading = view.container.querySelector('h1');
    expect(heading?.parentElement?.className).toContain('items-start');
    expect(heading?.parentElement?.className).toContain('gap-2.5');
    expect(heading?.parentElement?.className).toContain('text-left');
    expect(heading?.className).toContain('font-serif');
    expect(heading?.className).toContain('text-[30px]');
    expect(heading?.className).toContain('md:text-4xl');
    expect(heading?.className).toContain('leading-[1.1]');
    expect(heading?.className).toContain('font-normal');
    expect(heading?.className).not.toContain('font-bold');
    const description = heading?.parentElement?.querySelector('p');
    expect(description?.className).toContain('text-[15px]');
    expect(description?.className).toContain('leading-[1.55]');
    expect(description?.className).toContain('text-muted-foreground');
    // No icon above the title.
    expect(heading?.parentElement?.querySelector('svg')).toBeNull();
    expect(
      heading?.parentElement?.parentElement?.getAttribute('data-slot'),
    ).toBe('field-group');
    expect(heading?.parentElement?.parentElement?.className).toContain('gap-5');
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('[data-slot="card"]')).toBeNull();
    const submit = view.container.querySelector('button[type="submit"]');
    expect(submit?.parentElement?.getAttribute('data-slot')).toBe('field');
    expect(submit?.className).toContain('w-full');
    expect(submit?.className).toContain('h-10');
    for (const input of view.container.querySelectorAll('input')) {
      expect(
        (input.closest('[data-slot="input-group"]') ?? input).className,
      ).toContain('h-11');
      expect(input.className).toContain('text-[15px]');
    }
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
      expect(description?.textContent).toBe(
        'Your legal workspace starts here.',
      );
      expect(view.container.textContent).toContain(
        'Use at least 12 characters.',
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

test('form alert is the v3.1 flag alert with a 16px icon', async () => {
  const { AuthAlert } = await import('../src/components/auth/auth-parts');
  const view = await render(createElement(AuthAlert, null, 'Message'));
  const alert = view.container.querySelector('[data-slot="alert"]');
  expect(alert?.getAttribute('role')).toBe('alert');
  expect(alert?.className).toContain('bg-(--lexon-flag)');
  expect(alert?.className).toContain('border-(--lexon-red-text)');
  expect(alert?.className).toContain('rounded-[10px]');
  expect(alert?.className).toContain('px-3.5');
  expect(alert?.className).toContain('py-3');
  expect(alert?.querySelector('svg')).not.toBeNull();
  await view.unmount();
});

// Guard: every account route and the onboarding page reach the screen through
// the one shared AuthFrame. A page that renders its own <main>, imports the
// frame itself, or sits under another layout would bypass it.
const sources = import.meta.glob<string>(
  [
    '../src/app/[(]auth[)]/**/*.tsx',
    '../src/app/[(]workspace[)]/onboarding/**/*.tsx',
    '../src/components/shell/workspace-shell.tsx',
    '../src/components/organizations/onboarding.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
);
const source = (path: string) => {
  const text = sources['../src/' + path];
  if (text === undefined) throw new Error('Missing source ' + path);
  return text;
};
const authFiles = Object.keys(sources)
  .map((key) => key.replace('../src/app/(auth)/', ''))
  .filter((key) => !key.startsWith('../'));

test('every route under app/(auth) renders through the shared AuthFrame', async () => {
  const layout = source('app/(auth)/layout.tsx');
  expect(layout).toMatch(/import \{ AuthFrame \}.*auth-frame/);
  expect(layout).toMatch(/<AuthFrame>\{children\}<\/AuthFrame>/);
  const routes = authFiles
    .filter((file) => file.endsWith('/page.tsx'))
    .map((file) => file.split('/')[0]!)
    .sort();
  expect(routes).toEqual([
    'accept-invitation',
    'admin-setup',
    'forgot-password',
    'reset-password',
    'sign-in',
    'sign-up',
    'two-factor',
    'verify-email',
  ]);
  // No nested layout or template that could replace the frame.
  expect(
    authFiles.filter((file) => /(^|\/)(layout|template)\.tsx$/.test(file)),
  ).toEqual(['layout.tsx']);
  for (const route of routes) {
    const page = source('app/(auth)/' + route + '/page.tsx');
    expect(page, route).not.toMatch(/<main\b|AuthFrame/);
  }
  const view = await render(
    createElement(AuthLayout, null, createElement('h1', null, 'Any route')),
  );
  expect(view.container.querySelectorAll('main')).toHaveLength(1);
  expect(
    view.container.querySelector('[data-slot="auth-form-column"] h1')
      ?.textContent,
  ).toBe('Any route');
  await view.unmount();
});

test('the onboarding page renders through the shared AuthFrame', () => {
  const page = source('app/(workspace)/onboarding/page.tsx');
  expect(page).not.toMatch(/<main\b|AuthFrame/);
  expect(
    Object.keys(sources).filter((key) =>
      /onboarding\/(layout|template)\.tsx$/.test(key),
    ),
  ).toEqual([]);
  const shell = source('components/shell/workspace-shell.tsx');
  expect(shell).toMatch(/import \{ AuthFrame \}.*auth-frame/);
  expect(shell).toMatch(
    /!identity\.user\.onboardingCompleted\)[\s\S]{0,200}<AuthFrame>\{children\}<\/AuthFrame>/,
  );
  const onboarding = source('components/organizations/onboarding.tsx');
  expect(onboarding).not.toMatch(/<main\b/);
  expect(onboarding).toContain('presentation="page"');
});

test('onboarding shows three steps with 28x4px bars and "Step N of 3"', async () => {
  const { AuthSteps } = await import('../src/components/auth/auth-parts');
  const view = await render(createElement(AuthSteps, { step: 2 }));
  const bars = [...view.container.querySelectorAll('span[aria-hidden="true"]')];
  expect(bars).toHaveLength(3);
  expect(bars.map((bar) => bar.className.includes('bg-foreground'))).toEqual([
    true,
    true,
    false,
  ]);
  for (const bar of bars) {
    expect(bar.className).toContain('h-1');
    expect(bar.className).toContain('w-7');
  }
  expect(view.container.textContent).toBe('Step 2 of 3');
  await view.unmount();
});
