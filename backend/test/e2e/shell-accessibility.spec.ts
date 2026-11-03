import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';

const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('F2 required auth, shell, settings, organization, and platform pages pass both-theme accessibility checks', async ({
  browser,
}) => {
  const stack = descriptor();
  test.setTimeout(180_000);
  const context = await browser.newContext({ colorScheme: 'light' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (localStorage.getItem('theme') === null)
        localStorage.setItem('theme', 'light');
    });
    await page.goto(stack.frontendUrl + '/sign-in');
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const path of ['/sign-in', '/sign-up', '/two-factor']) {
        await page.evaluate(
          (theme) => localStorage.setItem('theme', theme),
          colorScheme,
        );
        await page.goto(stack.frontendUrl + path);
        await expect(page).toHaveURL(stack.frontendUrl + path);
        if (path === '/sign-in') {
          await expect(
            page.getByRole('button', { name: 'Sign in', exact: true }),
          ).toBeVisible();
        } else if (path === '/sign-up') {
          await expect(
            page.getByRole('button', { name: 'Create account', exact: true }),
          ).toBeVisible();
        } else {
          await expect(
            page.getByRole('heading', {
              name: 'Verify your sign-in',
              exact: true,
            }),
          ).toBeVisible();
        }
        const violations = (
          await new AxeBuilder({ page }).withTags(axeTags).analyze()
        ).violations;
        expect(violations, `${colorScheme} ${path}`).toEqual([]);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('main')).toHaveCount(1);
        await expect(page.locator('a[href="#main"]')).toHaveCount(1);
        await expect(page).toHaveTitle(/\S/);
      }
    }
    const headers = await authenticateApi(page.request);
    await page.request.post(
      stack.apiUrl + '/api/identity/onboarding/complete',
      {
        headers,
        data: {},
      },
    );
    const created = await page.request.post(
      stack.apiUrl + '/api/organizations',
      {
        headers,
        data: {
          name: 'F2 accessibility team',
          slug: 'f2-a11y-' + randomUUID().slice(0, 8),
        },
      },
    );
    expect(created.status()).toBe(201);
    const team = (await created.json()) as { id: string };
    const invitationEmail = `f2-a11y-${randomUUID()}@example.test`;
    const invitation = await page.request.post(
      `${stack.apiUrl}/api/organizations/${team.id}/invitations`,
      {
        headers,
        data: { email: invitationEmail, role: 'member' },
      },
    );
    expect(invitation.status()).toBe(201);
    const switched = await page.request.post(
      stack.apiUrl + '/api/organizations/active',
      {
        headers,
        data: { organizationId: team.id },
      },
    );
    expect(switched.status()).toBe(200);

    const themeRequests: string[] = [];
    page.on('request', (request) => {
      if (/theme/i.test(new URL(request.url()).pathname)) {
        themeRequests.push(request.url());
      }
    });

    const pages = [
      '/workspace',
      '/settings/profile',
      '/settings/security',
      '/settings/appearance',
      `/organizations/${team.id}/settings/members`,
      `/organizations/${team.id}/settings/invitations`,
      `/organizations/${team.id}/settings/general`,
    ];
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const path of pages) {
        await page.evaluate(
          (theme) => localStorage.setItem('theme', theme),
          colorScheme,
        );
        await page.goto(stack.frontendUrl + path);
        await expect(page).toHaveURL(stack.frontendUrl + path);
        if (path === '/workspace') {
          await expect(
            page.getByRole('heading', { name: /^Welcome, / }),
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Send message' }),
          ).toHaveAttribute('aria-disabled', 'true');
          await expect(page.getByText('No conversations yet.')).toBeVisible();
        } else if (path === '/settings/profile') {
          await expect(
            page.getByRole('button', { name: 'Save profile', exact: true }),
          ).toBeVisible();
        } else if (path === '/settings/security') {
          await expect(
            page.getByRole('button', {
              name: 'Revoke browser session',
              exact: true,
            }),
          ).toBeVisible();
        } else if (path === '/settings/appearance') {
          await expect(
            page.getByRole('radio', { name: 'System', exact: true }),
          ).toBeVisible();
        } else if (path.endsWith('/members')) {
          await expect(
            page.locator('[data-testid^="member-"]').first(),
          ).toBeVisible();
        } else if (path.endsWith('/invitations')) {
          await expect(
            page.getByText(invitationEmail, { exact: true }),
          ).toBeVisible();
        } else if (path.endsWith('/general')) {
          await expect(
            page.getByRole('button', {
              name: 'Save organization settings',
              exact: true,
            }),
          ).toBeVisible();
        }
        const violations = (
          await new AxeBuilder({ page }).withTags(axeTags).analyze()
        ).violations;
        expect(violations, `${colorScheme} ${path}`).toEqual([]);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('main')).toHaveCount(1);
        await expect(page.locator('a[href="#main"]')).toHaveCount(1);
        await expect(page).toHaveTitle(/\S/);
        await page.keyboard.press('Tab');
        expect(
          await page.evaluate(() =>
            document.activeElement?.matches(':focus-visible'),
          ),
          `${colorScheme} ${path} keyboard focus visibility`,
        ).toBe(true);
        if (path === '/settings/appearance') {
          await page.emulateMedia({ colorScheme });
          const systemTheme = page.getByRole('radio', { name: 'System' });
          await systemTheme.press('Space');
          await expect(systemTheme).toBeFocused();
          expect(
            await systemTheme.evaluate((element) =>
              element.matches(':focus-visible'),
            ),
          ).toBe(true);
          await expect(page.locator('html')).toHaveClass(
            colorScheme === 'dark' ? /\bdark\b/ : /\blight\b/,
          );
          const nextScheme = colorScheme === 'light' ? 'dark' : 'light';
          await page.emulateMedia({ colorScheme: nextScheme });
          await expect(page.locator('html')).toHaveClass(
            nextScheme === 'dark' ? /\bdark\b/ : /\blight\b/,
          );
          await page.emulateMedia({ colorScheme });
          expect(themeRequests).toEqual([]);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${colorScheme} ${path} horizontal overflow`,
        ).toBe(true);
        const undersizedTargets = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll(
              'button, input:not([type="radio"]), textarea, select, [role="radio"], nav a',
            ),
          )
            .filter((element) => {
              const target =
                element.getAttribute('role') === 'radio'
                  ? (element.closest('label') ?? element)
                  : element;
              const rect = target.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                (rect.width < 44 || rect.height < 44)
              );
            })
            .map((element) => {
              const target =
                element.getAttribute('role') === 'radio'
                  ? (element.closest('label') ?? element)
                  : element;
              const rect = target.getBoundingClientRect();
              return {
                label:
                  (element as HTMLElement).getAttribute('aria-label') ||
                  (element as HTMLElement).textContent?.trim(),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            }),
        );
        expect(
          undersizedTargets,
          `${colorScheme} ${path} targets under 44px`,
        ).toEqual([]);
      }
    }
  } finally {
    await context.close();
  }
});
