import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';

const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type TargetRect = {
  label: string | null | undefined;
  rect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
};

function targetsWithoutSpacingException(targets: TargetRect[]) {
  return targets
    .filter(({ rect }) => rect.width < 24 || rect.height < 24)
    .filter((target) => {
      const centerX = (target.rect.left + target.rect.right) / 2;
      const centerY = (target.rect.top + target.rect.bottom) / 2;
      return targets.some((other) => {
        if (target === other) return false;
        const nearestX = Math.max(
          other.rect.left,
          Math.min(centerX, other.rect.right),
        );
        const nearestY = Math.max(
          other.rect.top,
          Math.min(centerY, other.rect.bottom),
        );
        const intersectsOtherTarget =
          Math.hypot(centerX - nearestX, centerY - nearestY) < 12;
        const intersectsOtherUndersizedTargetCircle =
          (other.rect.width < 24 || other.rect.height < 24) &&
          Math.hypot(
            centerX - (other.rect.left + other.rect.right) / 2,
            centerY - (other.rect.top + other.rect.bottom) / 2,
          ) < 24;
        return intersectsOtherTarget || intersectsOtherUndersizedTargetCircle;
      });
    })
    .map(({ label, rect }) => ({
      label,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }));
}

test('F2 target spacing guard rejects crowded undersized controls and accepts spaced ones', async () => {
  const target = (
    label: string,
    left: number,
    width: number,
    top = 0,
    height = 20,
  ): TargetRect => ({
    label,
    rect: {
      left,
      right: left + width,
      top,
      bottom: top + height,
      width,
      height,
    },
  });
  expect(
    targetsWithoutSpacingException([
      target('crowded first', 0, 20),
      target('crowded second', 21, 20),
    ]),
  ).toEqual([
    { label: 'crowded first', width: 20, height: 20 },
    { label: 'crowded second', width: 20, height: 20 },
  ]);
  expect(
    targetsWithoutSpacingException([
      target('spaced first', 0, 20),
      target('spaced second', 24, 20),
    ]),
  ).toEqual([]);
  expect(
    targetsWithoutSpacingException([
      target('long thin target', 0, 100),
      target('near target', 80, 20, 21),
    ]),
  ).toEqual([{ label: 'near target', width: 20, height: 20 }]);
  expect(
    targetsWithoutSpacingException([
      target('tiny first', 0, 1, 0, 1),
      target('tiny second', 23, 1, 0, 1),
    ]),
  ).toEqual([
    { label: 'tiny first', width: 1, height: 1 },
    { label: 'tiny second', width: 1, height: 1 },
  ]);
});

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
      for (const path of [
        '/sign-in',
        '/sign-up',
        '/forgot-password',
        '/two-factor',
      ]) {
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
        } else if (path === '/forgot-password') {
          await expect(
            page.getByRole('button', { name: 'Send reset link', exact: true }),
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
    await page.goto(stack.frontendUrl + '/onboarding');
    await expect(
      page.getByRole('heading', { name: 'Welcome to Lexon' }),
    ).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate((theme) => {
        localStorage.setItem('theme', theme);
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'theme',
            newValue: theme,
            storageArea: localStorage,
          }),
        );
      }, colorScheme);
      await expect(page.locator('html')).toHaveClass(
        colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
      );
      const violations = (
        await new AxeBuilder({ page }).withTags(axeTags).analyze()
      ).violations;
      expect(violations, `${colorScheme} /onboarding`).toEqual([]);
    }
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
      '/workspace?settings=profile',
      '/workspace?settings=security',
      '/workspace?settings=appearance',
      '/workspace?settings=members',
      '/workspace?settings=invitations',
      '/workspace?settings=general',
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
          ).toBeDisabled();
          await expect(
            page.getByRole('heading', { name: /^Welcome, / }),
          ).toBeVisible();
          const messageInput = page.getByRole('textbox', {
            name: 'Message input',
          });
          await expect(messageInput).toBeVisible();
          const messageInputBox = await messageInput.boundingBox();
          expect(messageInputBox).not.toBeNull();
          expect(messageInputBox!.width).toBeGreaterThanOrEqual(24);
          expect(messageInputBox!.height).toBeGreaterThanOrEqual(24);
        } else if (path.endsWith('settings=profile')) {
          await expect(page.getByLabel('Display name')).toBeVisible();
        } else if (path.endsWith('settings=security')) {
          await expect(
            page.getByRole('heading', { name: 'Security' }),
          ).toBeVisible();
        } else if (path.endsWith('settings=appearance')) {
          await expect(
            page.getByRole('radio', { name: 'System', exact: true }),
          ).toBeVisible();
        } else if (path.endsWith('settings=members')) {
          await expect(
            page.locator('[data-testid^="member-"]').first(),
          ).toBeVisible();
        } else if (path.endsWith('settings=invitations')) {
          await expect(
            page.getByText(invitationEmail, { exact: true }),
          ).toBeVisible();
        } else if (path.endsWith('settings=general')) {
          await expect(
            page.getByRole('button', {
              name: 'Save changes',
              exact: true,
            }),
          ).toBeVisible();
        }
        if (path.includes('?settings=')) {
          const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
          const overlay = page.locator('[data-slot="dialog-overlay"]');
          await expect(settingsDialog).toBeVisible();
          await expect
            .poll(() =>
              settingsDialog.evaluate(
                (element) =>
                  !element.hasAttribute('data-starting-style') &&
                  getComputedStyle(element).opacity === '1',
              ),
            )
            .toBe(true);
          await expect
            .poll(() =>
              overlay.evaluate(
                (element) =>
                  !element.hasAttribute('data-starting-style') &&
                  getComputedStyle(element).opacity === '1',
              ),
            )
            .toBe(true);
          await page.evaluate(async () => {
            const layers = Array.from(
              document.querySelectorAll<HTMLElement>(
                '[role="dialog"], [data-slot="dialog-overlay"]',
              ),
            );
            await Promise.all(
              layers
                .flatMap((element) => element.getAnimations())
                .map((animation) => animation.finished.catch(() => undefined)),
            );
          });
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
        if (path.endsWith('settings=appearance')) {
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
        const targetsWithoutSizeOrSpacingException = await page.evaluate(() => {
          const targets = Array.from(
            document.querySelectorAll<HTMLElement>(
              'button, input:not([type="radio"]), textarea, select, [role="radio"], nav a',
            ),
          )
            .map((element) => {
              const target =
                element.getAttribute('role') === 'radio'
                  ? (element.closest<HTMLElement>('label') ?? element)
                  : element;
              const rect = target.getBoundingClientRect();
              const style = getComputedStyle(target);
              if (
                rect.width <= 0 ||
                rect.height <= 0 ||
                style.display === 'none' ||
                style.visibility !== 'visible' ||
                target.closest('[aria-hidden="true"], [inert]')
              ) {
                return null;
              }
              return {
                element,
                rect: {
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                },
              };
            })
            .filter((target): target is NonNullable<typeof target> => !!target);

          return targets.map(({ element, rect }) => ({
            label:
              element.getAttribute('aria-label') || element.textContent?.trim(),
            rect,
          }));
        });
        expect(
          targetsWithoutSpacingException(targetsWithoutSizeOrSpacingException),
          `${colorScheme} ${path} has targets below 24px without the SC 2.5.8 spacing exception`,
        ).toEqual([]);
      }
    }
  } finally {
    await context.close();
  }
});
