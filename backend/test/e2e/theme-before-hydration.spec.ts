import { test, expect } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';

test('F2 applies stored theme before hydration while external scripts are blocked', async ({
  browser,
}) => {
  const baseUrl = descriptor().frontendUrl;
  const cases = [
    {
      theme: 'light',
      colorScheme: 'dark',
      expected: 'light',
      color: 'rgb(255, 255, 255)',
    },
    {
      theme: 'dark',
      colorScheme: 'light',
      expected: 'dark',
      color: 'rgb(18, 18, 20)',
    },
    {
      theme: 'system',
      colorScheme: 'light',
      expected: 'light',
      color: 'rgb(255, 255, 255)',
    },
    {
      theme: 'system',
      colorScheme: 'dark',
      expected: 'dark',
      color: 'rgb(18, 18, 20)',
    },
  ] as const;

  for (const scenario of cases) {
    const context = await browser.newContext({
      colorScheme: scenario.colorScheme,
    });
    try {
      const page = await context.newPage();
      const abortedScripts: string[] = [];
      await page.addInitScript(
        ({ theme }) => localStorage.setItem('theme', theme),
        {
          theme: scenario.theme,
        },
      );
      await page.route('**/_next/static/**', (route) => {
        if (route.request().resourceType() === 'script') {
          abortedScripts.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(baseUrl + '/sign-in', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${scenario.expected}\\b`),
      );
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        scenario.color,
      );
      expect(abortedScripts.length).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => document.querySelectorAll('nextjs-portal').length,
        ),
      ).toBe(0);
    } finally {
      await context.close();
    }
  }
});

test('appearance previews keep scoped light, dark, and system token surfaces', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  await page.goto(stack.frontendUrl + '/settings/appearance');
  const previews = page.locator('[data-slot="appearance-preview"]');
  await expect(previews).toHaveCount(3);
  const light = await previews
    .nth(0)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const dark = await previews
    .nth(1)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const system = await previews.nth(2).evaluate((element) => ({
    light: getComputedStyle(
      element.querySelector('[data-preview-theme="light"]')!,
    ).backgroundColor,
    dark: getComputedStyle(
      element.querySelector('[data-preview-theme="dark"]')!,
    ).backgroundColor,
  }));
  expect(light).toBe('rgb(247, 247, 248)');
  expect(dark).toBe('rgb(28, 28, 32)');
  expect(system).toEqual({
    light: 'rgb(255, 255, 255)',
    dark: 'rgb(18, 18, 20)',
  });
});
