import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const visualDirectory = resolve('docs/references/F2.1-visual');
const fixturePath = resolve(
  visualDirectory,
  'test-fixtures/eight-pixel-layout.png',
);
const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const,
  maxDiffPixelRatio: 0.001,
};

test('an eight-pixel layout displacement fails comparison without changing the baseline', async ({
  page,
}) => {
  test.skip(
    process.env.LEXON_VISUAL_MODE === 'update',
    'The synthetic regression exercises compare behavior only.',
  );
  await page.setViewportSize({ width: 320, height: 180 });
  await page.setContent(
    '<div style="position:absolute;left:0;top:0;width:80px;height:80px;background:#111"></div>',
  );
  await mkdir(resolve(fixturePath, '..'), { recursive: true });
  const baseline = await page.screenshot(screenshotOptions);
  await writeFile(fixturePath, baseline);
  try {
    await expect(page).toHaveScreenshot(
      ['test-fixtures', 'eight-pixel-layout.png'],
      screenshotOptions,
    );
    const originalHash = sha256(await readFile(fixturePath));
    await page.locator('div').evaluate((element) => {
      (element as HTMLElement).style.left = '8px';
    });
    await expect(page)
      .toHaveScreenshot(
        ['test-fixtures', 'eight-pixel-layout.png'],
        screenshotOptions,
      )
      .then(
        () => {
          throw new Error(
            'Expected an eight-pixel layout displacement to fail.',
          );
        },
        (error: unknown) => {
          expect(String(error)).toMatch(
            /\d+ pixels \(ratio [\d.]+ of all image pixels\) are different/i,
          );
        },
      );
    expect(sha256(await readFile(fixturePath))).toBe(originalHash);
  } finally {
    await rm(fixturePath, { force: true });
  }
});

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
