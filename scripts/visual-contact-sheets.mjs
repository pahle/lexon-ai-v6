// Contact sheets for the owner's visual review (F4.1 Task 35).
//
// One PNG per index state, four variants side by side (desktop light, desktop
// dark, mobile light, mobile dark), each labelled with state, theme, and
// viewport. Sheets are derived from the review images, are not goldens, and
// are regenerated whenever a review image changes.
//
//   node scripts/visual-contact-sheets.mjs [--set F4.1-visual]
//     [--review-dir <dir>] [--out-dir <dir>]
//
// Defaults: the set's `review/` directory and `review/contact-sheets/`.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { visualSetDirectory } from './visual-mode.mjs';

/** Left to right on every sheet. */
export const VARIANT_ORDER = [
  'desktop-light',
  'desktop-dark',
  'mobile-light',
  'mobile-dark',
];

const VIEW_ID = /^(.+)-(desktop|mobile)-(light|dark)$/;

/** Groups index views into one entry per state, in index order. */
export function groupStates(index) {
  const byState = new Map();
  for (const [id, view] of Object.entries(index.views)) {
    const match = VIEW_ID.exec(id);
    if (!match)
      throw new Error(`Index view id has no viewport and theme: ${id}`);
    const [, stateId, viewport, theme] = match;
    if (view.viewport !== viewport || view.theme !== theme)
      throw new Error(`Index view ${id} disagrees with its viewport or theme`);
    if (!byState.has(stateId))
      byState.set(stateId, {
        stateId,
        state: view.state ?? stateId,
        variants: new Map(),
      });
    byState.get(stateId).variants.set(`${viewport}-${theme}`, {
      id,
      viewport,
      theme,
      path: view.path,
    });
  }
  return [...byState.values()].map(({ stateId, state, variants }) => {
    const missing = VARIANT_ORDER.filter((key) => !variants.has(key));
    if (missing.length > 0)
      throw new Error(
        `State ${stateId} is missing variants: ${missing.join(', ')}`,
      );
    return {
      stateId,
      state,
      variants: VARIANT_ORDER.map((key) => variants.get(key)),
    };
  });
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The HTML page for one sheet; `imageSource(variant)` returns each image URL. */
export function buildSheetHtml(sheet, imageSource) {
  const figures = sheet.variants
    .map(
      (variant) => `<figure data-variant="${variant.viewport}-${variant.theme}">
<figcaption>${escapeHtml(sheet.state)} · ${variant.theme} · ${variant.viewport}</figcaption>
<img src="${imageSource(variant)}" alt="${escapeHtml(`${sheet.state}, ${variant.theme}, ${variant.viewport}`)}">
</figure>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(sheet.stateId)}</title>
<style>
  body { margin: 0; background: #e7e5e0; font: 14px/1.4 system-ui, sans-serif; color: #1c1b19; }
  #sheet { display: inline-block; padding: 24px; background: #e7e5e0; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 16px; color: #5b5953; }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { margin-bottom: 6px; font-weight: 600; white-space: nowrap; }
  img { display: block; height: 520px; width: auto; border: 1px solid #b9b6ae; background: #fff; }
</style></head><body>
<div id="sheet">
<h1>${escapeHtml(sheet.state)}</h1>
<p>${escapeHtml(sheet.stateId)}</p>
<div class="row">
${figures}
</div>
</div>
</body></html>`;
}

/**
 * Renders one `<state-id>.png` per index state into `outDir` and removes
 * stale sheets (PNGs for states no longer in the index). Returns the sheet
 * paths in index order.
 */
export async function renderContactSheets({ index, reviewDir, outDir }) {
  const sheets = groupStates(index);
  const imageFor = (variant) => resolve(reviewDir, basename(variant.path));
  const missing = sheets.flatMap((sheet) =>
    sheet.variants.filter((v) => !existsSync(imageFor(v))).map((v) => v.id),
  );
  if (missing.length > 0)
    throw new Error(`Missing review images: ${missing.join(', ')}`);

  mkdirSync(outDir, { recursive: true });
  const wanted = new Set(sheets.map((sheet) => `${sheet.stateId}.png`));
  for (const name of readdirSync(outDir))
    if (name.endsWith('.png') && !wanted.has(name))
      rmSync(resolve(outDir, name));

  const browser = await chromium.launch();
  const written = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 2600, height: 900 },
      deviceScaleFactor: 1,
    });
    for (const sheet of sheets) {
      const html = buildSheetHtml(
        sheet,
        (variant) =>
          `data:image/png;base64,${readFileSync(imageFor(variant)).toString('base64')}`,
      );
      await page.setContent(html, { waitUntil: 'load' });
      const target = resolve(outDir, `${sheet.stateId}.png`);
      await page.locator('#sheet').screenshot({ path: target });
      written.push(target);
    }
  } finally {
    await browser.close();
  }
  return written;
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const setDir = visualSetDirectory(option('--set'));
  const index = JSON.parse(readFileSync(resolve(setDir, 'index.json'), 'utf8'));
  const reviewDir = resolve(
    option('--review-dir') ?? resolve(setDir, 'review'),
  );
  const outDir = resolve(
    option('--out-dir') ?? resolve(setDir, 'review/contact-sheets'),
  );
  const written = await renderContactSheets({ index, reviewDir, outDir });
  console.log(`Wrote ${written.length} contact sheets to ${outDir}`);
}
