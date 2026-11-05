import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  isSnapshotUpdateEnabled,
  resolveVisualMode,
} from '../../../scripts/visual-mode.mjs';

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

test('Playwright worker config reaches the explicit visual update guard', async ({
  page,
}, testInfo) => {
  await page.setContent('<main>Worker update mode</main>');
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), 'lexon-visual-worker-mode-'),
  );
  const approvalPath = resolve(temporaryDirectory, 'approval.json');
  await writeFile(
    approvalPath,
    JSON.stringify({
      version: 1,
      status: 'approved',
      sourceSha: 'a'.repeat(40),
      ownerApproval: { reference: 'worker config test', date: '2026-11-05' },
      environment: {
        os: 'Linux test fixture',
        browser: 'Chromium 156.0.8078.4',
        playwright: '1.64.1',
        node: 'v24.22.1',
        locale: 'en-US',
        timezone: 'Asia/Jakarta',
      },
      images: {},
    }),
  );
  try {
    const updateSnapshots = isSnapshotUpdateEnabled(
      testInfo.config.updateSnapshots,
    );
    const mode = () =>
      resolveVisualMode({
        approvalPath,
        explicitMode: 'update',
        updateSnapshots,
        runtime: { ci: true, platform: 'linux' },
      });
    if (updateSnapshots) {
      expect(mode()).toBe('update');
    } else {
      expect(mode).toThrow(/requires owner approval and --update-snapshots/);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

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
