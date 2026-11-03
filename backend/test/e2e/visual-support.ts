import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export type VisualView = 'sign-in' | 'sign-up' | 'onboarding';
export type VisualTheme = 'light' | 'dark';
export type VisualViewport = 'desktop' | 'mobile';

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
