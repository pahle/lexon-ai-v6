import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  brandThemes,
  brandViewports,
  captureBrandView,
} from './brand-visual-support.js';

// The F4.1 visual set. Every state is captured in light and dark at
// 1440×900 and 390×844; docs/references/F4.1-visual/index.json lists them.

test('sign-in page', async ({ page }) => {
  await page.goto(descriptor().frontendUrl + '/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  for (const viewport of brandViewports)
    for (const theme of brandThemes)
      await captureBrandView(page, 'sign-in', { theme, viewport });
});
