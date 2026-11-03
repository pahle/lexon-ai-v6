import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export type VisualView = 'sign-in' | 'sign-up' | 'onboarding';
export type VisualTheme = 'light' | 'dark';
export type VisualViewport = 'desktop' | 'mobile';
export type CheckpointBView =
  | 'home'
  | 'sidebar-expanded'
  | 'organization-switcher-open'
  | 'user-menu-open'
  | 'sidebar-collapsed';

const sizes = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export async function waitForVisualAuthFormReady(page: Page) {
  if (process.env.LEXON_VISUAL_DEV !== '1') return;
  await expect(page.locator('html')).toHaveAttribute(
    'data-lexon-visual-auth-ready',
    'true',
  );
}

export async function captureVisualView(
  page: Page,
  view: VisualView,
  theme: VisualTheme,
  viewport: VisualViewport,
) {
  await page.setViewportSize(sizes[viewport]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  if (view === 'onboarding') {
    await expect(page.getByLabel('Display name')).toHaveValue(
      'Checkpoint Preview',
    );
  } else {
    await waitForVisualAuthFormReady(page);
  }
  await expect(page.locator('main')).toHaveCount(1);
  expect(
    await page.locator('main').evaluate((main) =>
      Math.round(main.getBoundingClientRect().width),
    ),
  ).toBe(sizes[viewport].width);
  expect(
    await page.locator('main input').first().evaluate((input) =>
      Math.round(input.getBoundingClientRect().width),
    ),
  ).toBe(320);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (font) => font.status === 'loaded' && /inter/i.test(font.family),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  await expect
    .poll(() =>
      page.locator('img[alt="Lexon"]').evaluateAll((images) =>
        images.every((image) => {
          const logo = image as HTMLImageElement;
          return logo.naturalWidth > 0 && logo.naturalHeight > 0;
        }),
      ),
    )
    .toBe(true);
  await expect(page.locator('img[alt="Lexon"]:visible')).toHaveCount(1);
  expect(
    await page
      .locator('img[alt="Lexon"]:visible')
      .evaluate((image) => image.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
  const overlayText = await page
    .locator('nextjs-portal')
    .evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(overlayText).not.toMatch(
    /Build Error|Runtime Error|Unhandled Runtime Error/,
  );
  const output = resolve(
    'docs/references/F2.1-visual/checkpoints',
    `a-${view}-${viewport}-${theme}.png`,
  );
  await mkdir(resolve(output, '..'), { recursive: true });
  await page.screenshot({
    path: output,
    fullPage: false,
    caret: 'hide',
    animations: 'disabled',
    scale: 'css',
  });
}

export async function captureCheckpointBView(
  page: Page,
  view: CheckpointBView,
  theme: VisualTheme,
  viewport: VisualViewport,
) {
  await page.setViewportSize(sizes[viewport]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Welcome, Checkpoint Preview' }),
  ).toBeAttached();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (font) => font.status === 'loaded' && /inter/i.test(font.family),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  if (viewport === 'mobile' && view !== 'home') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  }
  if (
    viewport === 'desktop' &&
    view !== 'sidebar-collapsed' &&
    (await page.getByRole('button', { name: 'Expand sidebar' }).isVisible())
  ) {
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
  }
  if (view === 'organization-switcher-open') {
    await page
      .getByRole('button', { name: 'Organization: Checkpoint B Team' })
      .click();
    await expect(page.getByTestId('organization-popup')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Personal' })).toBeVisible();
  } else if (view === 'user-menu-open') {
    await page.locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]').click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  } else if (view === 'sidebar-collapsed') {
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    if (await expand.isVisible()) await expand.click();
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  }
  await page.mouse.move(0, 0);
  const output = resolve(
    'docs/references/F2.1-visual/checkpoints',
    `b-${view}-${viewport}-${theme}.png`,
  );
  await mkdir(resolve(output, '..'), { recursive: true });
  await page.screenshot({
    path: output,
    fullPage: false,
    caret: 'hide',
    animations: 'disabled',
    scale: 'css',
  });
}
