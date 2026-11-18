import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertApprovedVisualSet,
  assertIndexedArtifact,
  isPixelLocked,
  hasSvgSnapshot,
  resolveVisualMode,
  visualSetDirectory,
  type VisualIndex,
} from '../../../scripts/visual-mode.mjs';
import {
  assertStableSvgRead,
  checkSvgSnapshot,
  isSvgSnapshotUpdate,
} from '../../../scripts/svg-snapshot.mjs';
import { applyTheme, type VisualTheme } from './visual-support.js';
import { prototypeNow } from './prototype-fixtures.js';

export type BrandViewport = 'desktop' | 'mobile';
export const brandThemes: readonly VisualTheme[] = ['light', 'dark'];
export const brandViewports: readonly BrandViewport[] = ['desktop', 'mobile'];

/** Every F4.1 capture runs on this instant so dates and greetings are stable. */
export const brandFixedTime = prototypeNow;
export const brandAxeTags = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

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

/** False for an index view whose lock is an SVG snapshot, not a pixel golden. */
export async function isBrandViewPixelLocked(id: string) {
  const view = (await readIndex()).views[id];
  if (!view) throw new Error(`F4.1 visual index has no entry for "${id}".`);
  return isPixelLocked(view);
}

const svgSnapshotResults: { id: string; error?: string }[] = [];

/**
 * Locks the indicator SVG markup of one frame. The markup is read twice and
 * the reads must be equal; then it is compared byte for byte with the
 * committed snapshot, or written there when LEXON_SVG_SNAPSHOT_UPDATE=1.
 * Nothing is normalized: the indicator markup has no generated ids. A
 * mismatch is recorded, not thrown, so one run reports every frame;
 * assertSvgSnapshotsMatched fails once at the end with the full list.
 */
export async function snapshotIndicatorSvg(
  id: string,
  read: () => Promise<string>,
) {
  try {
    const first = await read();
    assertStableSvgRead(id, first, await read());
    checkSvgSnapshot({
      file: resolve(setDirectory, 'indicator-svg-snapshots.json'),
      id,
      markup: first,
      update: isSvgSnapshotUpdate(),
    });
    svgSnapshotResults.push({ id });
    console.log(`SVGSNAP ${id} match`);
  } catch (error) {
    svgSnapshotResults.push({ id, error: (error as Error).message });
    console.log(`SVGSNAP ${id} MISMATCH`);
  }
}

/** Fails once, listing every frame whose SVG snapshot check failed. */
export function assertSvgSnapshotsMatched() {
  const failed = svgSnapshotResults.filter((result) => result.error);
  const summary = svgSnapshotResults
    .map((result) => `${result.id}: ${result.error ? 'MISMATCH' : 'match'}`)
    .join('\n');
  svgSnapshotResults.length = 0;
  if (failed.length > 0)
    throw new Error(
      `${failed.length} indicator SVG snapshot mismatches.\n${summary}\n\n` +
        failed.map((result) => `${result.id}\n${result.error}`).join('\n\n'),
    );
}

/** False only for a view locked by the engine tests alone. */
export async function isBrandViewSvgSnapshotted(id: string) {
  const view = (await readIndex()).views[id];
  if (!view) throw new Error(`F4.1 visual index has no entry for "${id}".`);
  return hasSvgSnapshot(view);
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
 * page in the state to capture; this applies the viewport and theme, fixes
 * the date, waits for fonts and images, runs axe with the WCAG 2.0, 2.1, and
 * 2.2 A and AA tags, and then writes a review capture (capture mode) or
 * compares against the approved Linux golden (compare and update modes).
 * The installTask9* row normalizations apply to Settings tables and are
 * installed by the specs that open those pages, not by the auth set.
 */
export async function runBrandAxe(page: Page, id: string) {
  const axe = await new AxeBuilder({ page }).withTags(brandAxeTags).analyze();
  expect(
    axe.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
    `axe violations in ${id}`,
  ).toEqual([]);
}

/**
 * Describes the focused element when it is interactive and shows a
 * focus-visible ring; null when focus is parked on the body or on a
 * non-interactive element.
 */
export async function focusRingLeak(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (
      !active ||
      active === document.body ||
      active === document.documentElement
    )
      return null;
    if (!active.matches(':focus-visible')) return null;
    const interactive = active.matches(
      'a[href], button, input, textarea, select, summary, [tabindex], [contenteditable], [role="button"], [role="menuitem"], [role="tab"], [role="link"]',
    );
    if (!interactive) return null;
    const label =
      active.getAttribute('aria-label') ?? active.textContent?.trim() ?? '';
    return `${active.tagName.toLowerCase()} "${label.slice(0, 40)}"`;
  });
}

/**
 * The Next dev server (the visual dev loop) mounts a dev-tools badge in a
 * shadow host that covers the sidebar footer; a production build has none.
 * Every group spec calls this in beforeEach so the badge is hidden on every
 * page load, before any click, and stays out of axe and the capture.
 */
export async function hideDevOverlayOnLoad(page: Page) {
  // An adopted style sheet survives React reconciling <html> and <head>.
  await page.addInitScript(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('nextjs-portal { display: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

/** Animated parts of the app; the comparison script masks their boxes. */
const animatedSelector = [
  '[data-slot="spinner"]',
  '.animate-spin',
  'span.size-5.shrink-0 > svg[aria-hidden="true"][width="20"]',
].join(', ');

/**
 * Writes `<image>.masks.json`: the page-pixel rectangles of the thinking
 * indicator, every spinner, and the focused text field (its caret blinks).
 * scripts/visual-compare-prototype.mjs masks them in both images.
 */
async function writeMaskSidecar(page: Page, image: string) {
  const rects = await page.evaluate((selector) => {
    const found: Element[] = [...document.querySelectorAll(selector)];
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement &&
        !['checkbox', 'radio', 'button', 'submit'].includes(active.type))
    )
      found.push(active);
    return found.flatMap((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0
        ? [{ x: box.x, y: box.y, width: box.width, height: box.height }]
        : [];
    });
  }, animatedSelector);
  await writeFile(`${image}.masks.json`, `${JSON.stringify(rects)}\n`);
}

export async function captureBrandView(
  page: Page,
  state: string,
  { theme, viewport }: { theme: VisualTheme; viewport: BrandViewport },
  // A held fake clock cannot run axe (its timers never fire), so the
  // indicator frames run axe separately and pass `axe: false`.
  options: { axe?: boolean; keepFocus?: boolean } = {},
) {
  const id = brandViewId(state, viewport, theme);
  const index = await readIndex();
  const view = index.views[id];
  if (!view) throw new Error(`F4.1 visual index has no entry for "${id}".`);
  const size = index.viewports[viewport];
  if (!size || view.viewport !== viewport || view.theme !== theme)
    throw new Error(`F4.1 visual index entry "${id}" does not match its id.`);

  await page.clock.setFixedTime(brandFixedTime);
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

  if (!options.keepFocus) {
    // Park focus so no ring is captured. Only states about focus opt out
    // with keepFocus (an open menu or dialog, an edited or searched field).
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    const leak = await focusRingLeak(page);
    expect(
      leak,
      `${id} captures a focus ring on ${leak}; the state is not about focus`,
    ).toBeNull();
  }

  if (options.axe !== false) await runBrandAxe(page, id);

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
    await writeMaskSidecar(page, output);
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
  // An svg-snapshot view has no pixel golden; its caller locks the markup.
  if (!isPixelLocked(view)) return resolve(captureDirectory, view.path);
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

/**
 * Captures one state in light and dark at both viewports. Without hooks the
 * caller has already put the page in the state. With hooks, the theme and
 * viewport are applied first, `open` puts the page in the state with
 * user-like actions for that viewport, and `close` restores the resting page.
 */
export async function captureBrandViews(
  page: Page,
  state: string,
  hooks: {
    open?: (viewport: BrandViewport) => Promise<void>;
    close?: (viewport: BrandViewport) => Promise<void>;
    /** Passed to captureBrandView; see its `axe` option. */
    axe?: boolean;
    /** Keep focus as the state left it, for a state that is about focus. */
    keepFocus?: boolean;
  } = {},
) {
  for (const viewport of brandViewports)
    for (const theme of brandThemes) {
      if (hooks.open) {
        const size = (await readIndex()).viewports[viewport];
        if (!size) throw new Error(`F4.1 visual index has no ${viewport}.`);
        await page.setViewportSize(size);
        await applyTheme(page, theme);
        await hooks.open(viewport);
      }
      await captureBrandView(
        page,
        state,
        { theme, viewport },
        {
          ...(hooks.axe === undefined ? {} : { axe: hooks.axe }),
          ...(hooks.keepFocus ? { keepFocus: true } : {}),
        },
      );
      await hooks.close?.(viewport);
    }
}
