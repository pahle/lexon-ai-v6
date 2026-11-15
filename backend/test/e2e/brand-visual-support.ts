import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertApprovedVisualSet,
  assertIndexedArtifact,
  resolveVisualMode,
  visualSetDirectory,
  type VisualIndex,
} from '../../../scripts/visual-mode.mjs';
import { applyTheme, type VisualTheme } from './visual-support.js';

export type BrandViewport = 'desktop' | 'mobile';
export const brandThemes: readonly VisualTheme[] = ['light', 'dark'];
export const brandViewports: readonly BrandViewport[] = ['desktop', 'mobile'];

const setDirectory = visualSetDirectory('F4.1-visual');
// Local capture runs never rewrite the committed Linux review set.
const captureDirectory =
  process.env.CI === 'true' ? setDirectory : resolve('.cache/f4.1-visual');

let indexPromise: Promise<VisualIndex> | undefined;
const validatedSets = new Set<string>();

function readIndex() {
  indexPromise ??= readFile(resolve(setDirectory, 'index.json'), 'utf8').then(
    (contents) => JSON.parse(contents) as VisualIndex,
  );
  return indexPromise;
}

export function brandViewId(
  state: string,
  viewport: BrandViewport,
  theme: VisualTheme,
) {
  return `${state}-${viewport}-${theme}`;
}

/**
 * Captures or compares one indexed F4.1 view. The caller has already put the
 * page in the state to capture; this applies the viewport and theme, waits
 * for fonts and images, and then writes a review capture (capture mode) or
 * compares against the approved Linux golden (compare and update modes).
 */
export async function captureBrandView(
  page: Page,
  state: string,
  { theme, viewport }: { theme: VisualTheme; viewport: BrandViewport },
) {
  const id = brandViewId(state, viewport, theme);
  const index = await readIndex();
  const view = index.views[id];
  if (!view) throw new Error(`F4.1 visual index has no entry for "${id}".`);
  const size = index.viewports[viewport];
  if (!size || view.viewport !== viewport || view.theme !== theme)
    throw new Error(`F4.1 visual index entry "${id}" does not match its id.`);

  await page.setViewportSize(size);
  await applyTheme(page, theme);
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page
        .locator('img:visible')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await page.mouse.move(0, 0);

  const mode = resolveVisualMode({
    approvalPath: resolve(setDirectory, 'approval.json'),
  });
  if (mode === 'capture') {
    const output = resolve(captureDirectory, view.path);
    await mkdir(resolve(output, '..'), { recursive: true });
    await page.screenshot({
      path: output,
      fullPage: false,
      caret: 'hide',
      animations: 'disabled',
      scale: 'css',
    });
    return output;
  }

  const approval = JSON.parse(
    await readFile(resolve(setDirectory, 'approval.json'), 'utf8'),
  );
  const validationKey = `${mode}:${JSON.stringify(approval)}`;
  if (!validatedSets.has(validationKey)) {
    assertApprovedVisualSet(index, approval, setDirectory, {
      requireBaselines: mode === 'compare',
      expectedViewCount: Object.keys(index.views).length,
    });
    validatedSets.add(validationKey);
  }
  if (mode === 'compare')
    assertIndexedArtifact(index, id, setDirectory, { mode });
  await expect(page).toHaveScreenshot(['baseline', `${id}.png`], {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    maxDiffPixelRatio: 0.001,
  });
  return resolve(setDirectory, `baseline/${id}.png`);
}
