// Prototype comparison sheets for the F4.1 fidelity gate (LEX-DS-001 §5.6).
//
// For every capture id x {desktop, mobile} x {light, dark}, renders the
// prototype state in the pinned Playwright Chromium, diffs it with the app
// capture (pixelmatch-style YIQ threshold 0.1, computed in the same Chromium),
// and writes one sheet per variant: prototype | capture | diff overlay.
//
//   node scripts/visual-compare-prototype.mjs [--capture-dir <dir>]
//     [--out-dir <dir>] [--ids a,b,c] [--pending] [--prototype <html>] [--gate]
//     [--deviations <md>]
// --pending compares only the ids of index.json `pending` views.
//
// Only animated parts are masked: the prototype side by selector, the app side
// by the `<image>.masks.json` sidecar the capture helper writes; the union of
// both rect sets is masked in both images. Exit code is 0 unless --gate is
// passed and a sheet is over the threshold without a listed deviation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const setDir = resolve(root, 'docs/references/F4.1-visual');
export const THRESHOLD_PERCENT = 1.5;
/** The prototype the comparison renders, and its revision (docs/design/f4.1-prototype/README.md). */
const PROTOTYPE_PATH = resolve(
  root,
  'docs/design/f4.1-prototype/source/prototype.html',
);
export const PROTOTYPE_REVISION = 18;
export const DEVIATIONS_HEADING = '## Comparison deviations (round 4)';

const VIEWPORTS = {
  desktop: { size: [1440, 900], short: 'd' },
  mobile: { size: [390, 844], short: 'm' },
};

/** Elements that animate in the prototype; their boxes are masked. */
export const PROTOTYPE_MASK_SELECTOR =
  '.lq, .lx, .ld, .spin, .caret, .mark.live';

/** Unique capture ids of the index `pending` view keys. */
export function pendingCompareIds(index) {
  return [
    ...new Set(
      (index.pending ?? []).map((v) =>
        v.replace(/-(desktop|mobile)-(light|dark)$/, ''),
      ),
    ),
  ];
}

export function prototypeState(id) {
  return id.startsWith('indicator-')
    ? { state: 'indicator', layoutOnly: true }
    : { state: id, layoutOnly: false };
}

export function variantsFor(id) {
  const out = [];
  for (const viewport of ['desktop', 'mobile'])
    for (const theme of ['light', 'dark']) {
      const { size, short } = VIEWPORTS[viewport];
      out.push({
        key: `${viewport}-${theme}`,
        viewport,
        theme,
        size,
        short: `${short}${theme === 'dark' ? '-dark' : ''}`,
        image: `${id}-${viewport}-${theme}.png`,
        sheet: `${id}-${short}${theme === 'dark' ? '-dark' : ''}.png`,
      });
    }
  return out;
}

/** Parses the round 4 deviation table; `has(id, variant)` tests a listing. */
export function parseDeviations(markdown) {
  const entries = [];
  const lines = markdown.split('\n');
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith('## ')) inSection = line.trim() === DEVIATIONS_HEADING;
    else if (inSection && line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll('`', ''));
      if (cells.length < 2 || cells[0] === 'id' || /^-+$/.test(cells[0]))
        continue;
      entries.push([cells[0], cells[1]]);
    }
  }
  return {
    has: (id, variant) =>
      entries.some(
        ([i, v]) => i === id && (v === variant || v === 'all' || v === '*'),
      ),
  };
}

function readMasks(imagePath) {
  const file = `${imagePath}.masks.json`;
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : (parsed.rects ?? []);
}

/** Runs inside Chromium: diffs two PNGs and draws the three-panel sheet. */
async function diffInPage(args) {
  const { protoB64, capB64, masks, width, height, labels } = args;
  const load = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  };
  const draw = (bitmap) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);
    return { canvas, data: ctx.getImageData(0, 0, width, height) };
  };
  const a = draw(await load(protoB64));
  const b = draw(await load(capB64));
  const masked = new Uint8Array(width * height);
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x));
    const y0 = Math.max(0, Math.floor(m.y));
    const x1 = Math.min(width, Math.ceil(m.x + m.width));
    const y1 = Math.min(height, Math.ceil(m.y + m.height));
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) masked[y * width + x] = 1;
  }
  const maxDelta = 35215 * 0.1 * 0.1;
  const blend = (c, alpha) => 255 + (c - 255) * alpha;
  const pa = a.data.data;
  const pb = b.data.data;
  const overlay = new ImageData(width, height);
  let differing = 0;
  let counted = 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    // Faded capture under the diff overlay.
    const fade = (c) => 255 - (255 - c) * 0.3;
    overlay.data[o] = fade(pb[o]);
    overlay.data[o + 1] = fade(pb[o + 1]);
    overlay.data[o + 2] = fade(pb[o + 2]);
    overlay.data[o + 3] = 255;
    if (masked[i]) {
      overlay.data[o] = 200;
      overlay.data[o + 1] = 200;
      overlay.data[o + 2] = 255;
      continue;
    }
    counted += 1;
    const aa = pa[o + 3] / 255;
    const ba = pb[o + 3] / 255;
    const r1 = blend(pa[o], aa);
    const g1 = blend(pa[o + 1], aa);
    const b1 = blend(pa[o + 2], aa);
    const r2 = blend(pb[o], ba);
    const g2 = blend(pb[o + 1], ba);
    const b2 = blend(pb[o + 2], ba);
    const y =
      0.29889531 * (r1 - r2) + 0.58662247 * (g1 - g2) + 0.11448223 * (b1 - b2);
    const iq =
      0.59597799 * (r1 - r2) - 0.2741761 * (g1 - g2) - 0.32180189 * (b1 - b2);
    const q =
      0.21147017 * (r1 - r2) - 0.52261711 * (g1 - g2) + 0.31114694 * (b1 - b2);
    const delta = 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q;
    if (delta > maxDelta) {
      differing += 1;
      overlay.data[o] = 255;
      overlay.data[o + 1] = 0;
      overlay.data[o + 2] = 0;
    }
  }
  const percent = counted === 0 ? 0 : (differing / counted) * 100;

  const overlayCanvas = new OffscreenCanvas(width, height);
  overlayCanvas.getContext('2d').putImageData(overlay, 0, 0);
  const panelH = 600;
  const scale = panelH / height;
  const panelW = Math.round(width * scale);
  const pad = 16;
  const head = 54;
  const sheet = new OffscreenCanvas(
    pad + 3 * (panelW + pad),
    head + panelH + pad + 22,
  );
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e7e5e0';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = '#1c1b19';
  ctx.font = '600 16px sans-serif';
  ctx.fillText(labels.title, pad, 24);
  ctx.font = '13px sans-serif';
  ctx.fillText(labels.note, pad, 44);
  const panels = [
    ['prototype', a.canvas],
    ['capture', b.canvas],
    [`diff ${percent.toFixed(2)}%`, overlayCanvas],
  ];
  panels.forEach(([label, canvas], n) => {
    const x = pad + n * (panelW + pad);
    ctx.fillStyle = '#1c1b19';
    ctx.font = '600 13px sans-serif';
    ctx.fillText(label, x, head + panelH + 16);
    ctx.drawImage(canvas, x, head, panelW, panelH);
    ctx.strokeStyle = '#b9b6ae';
    ctx.strokeRect(x - 0.5, head - 0.5, panelW + 1, panelH + 1);
  });
  const blob = await sheet.convertToBlob({ type: 'image/png' });
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 0x8000)
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return { percent, differing, sheetB64: btoa(binary) };
}

async function renderPrototype(browser, prototype, state, variant) {
  const context = await browser.newContext({
    viewport: { width: variant.size[0], height: variant.size[1] },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
  });
  try {
    const page = await context.newPage();
    const query = `?shot=1${variant.viewport === 'mobile' ? '&m=1' : ''}${variant.theme === 'dark' ? '&theme=dark' : ''}`;
    await page.goto(`${pathToFileURL(prototype).href}${query}#${state}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const masks = await page.evaluate((selector) => {
      const rects = [];
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          rects.push({
            x: r.left + scrollX - 2,
            y: r.top + scrollY - 2,
            width: r.width + 4,
            height: r.height + 4,
          });
      }
      return rects;
    }, PROTOTYPE_MASK_SELECTOR);
    const png = await page.screenshot({
      caret: 'hide',
      animations: 'disabled',
      scale: 'css',
    });
    return { png, masks };
  } finally {
    await context.close();
  }
}

/** Compares every id x variant. Returns result rows, worst first. */
export async function runCompare({
  captureDir,
  outDir,
  ids,
  prototype = PROTOTYPE_PATH,
}) {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  const browser = await chromium.launch();
  try {
    const diffPage = await browser.newPage();
    for (const id of ids) {
      const { state, layoutOnly } = prototypeState(id);
      for (const variant of variantsFor(id)) {
        const row = {
          id,
          variant: variant.short,
          key: variant.key,
          prototypeState: state,
          ...(layoutOnly ? { note: 'layout only (state: indicator)' } : {}),
        };
        const image = resolve(captureDir, variant.image);
        if (!existsSync(image)) {
          results.push({ ...row, status: 'MISSING', percent: null });
          continue;
        }
        const proto = await renderPrototype(browser, prototype, state, variant);
        const masks = [...proto.masks, ...readMasks(image)];
        const out = await diffPage.evaluate(diffInPage, {
          protoB64: proto.png.toString('base64'),
          capB64: readFileSync(image).toString('base64'),
          masks,
          width: variant.size[0],
          height: variant.size[1],
          labels: {
            title: `${id} · ${variant.viewport} · ${variant.theme}`,
            note: `prototype state: ${state}${layoutOnly ? ' (layout only)' : ''} · masks: ${masks.length}`,
          },
        });
        writeFileSync(
          resolve(outDir, variant.sheet),
          Buffer.from(out.sheetB64, 'base64'),
        );
        const percent = Math.round(out.percent * 100) / 100;
        results.push({
          ...row,
          percent,
          status: percent > THRESHOLD_PERCENT ? 'FAIL' : 'PASS',
          sheet: variant.sheet,
        });
      }
    }
  } finally {
    await browser.close();
  }
  results.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
  const over = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(
    resolve(outDir, 'results.json'),
    `${JSON.stringify({ threshold: THRESHOLD_PERCENT, over, results }, null, 2)}\n`,
  );
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.variant} | ${r.percent === null ? '-' : r.percent.toFixed(2)} | ${r.status}${r.note ? ` (${r.note})` : ''} |`,
  );
  writeFileSync(
    resolve(outDir, 'README.md'),
    `# Prototype comparison\n\nCaptures compared with prototype revision ${PROTOTYPE_REVISION} (pixel diff, YIQ threshold 0.1, animated parts masked). Gate: ${THRESHOLD_PERCENT}%. Variants: d desktop, m mobile, -dark dark. Sheets: prototype | capture | diff.\n\n${over} over ${THRESHOLD_PERCENT}% of ${results.length} variants.\n\n| id | variant | % differing | result |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`,
  );
  return results;
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const captureDir = resolve(
    option('--capture-dir') ?? resolve(setDir, 'review'),
  );
  const outDir = resolve(option('--out-dir') ?? resolve(setDir, 'compare'));
  const prototype = resolve(option('--prototype') ?? PROTOTYPE_PATH);
  let ids = option('--ids')?.split(',').filter(Boolean);
  const index = JSON.parse(readFileSync(resolve(setDir, 'index.json'), 'utf8'));
  if (!ids && process.argv.includes('--pending'))
    ids = pendingCompareIds(index);
  if (!ids) {
    ids = [
      ...new Set(
        Object.keys(index.views).map((v) =>
          v.replace(/-(desktop|mobile)-(light|dark)$/, ''),
        ),
      ),
    ];
  }
  const results = await runCompare({ captureDir, outDir, ids, prototype });
  const over = results.filter((r) => r.status === 'FAIL');
  console.log(
    `${over.length} of ${results.length} variants over ${THRESHOLD_PERCENT}% (${results.filter((r) => r.status === 'MISSING').length} missing). Sheets in ${outDir}`,
  );
  if (process.argv.includes('--gate')) {
    const deviationsFile = resolve(
      option('--deviations') ?? resolve(setDir, 'deviations.md'),
    );
    const deviations = parseDeviations(
      existsSync(deviationsFile) ? readFileSync(deviationsFile, 'utf8') : '',
    );
    const blocking = over.filter((r) => !deviations.has(r.id, r.variant));
    for (const r of blocking)
      console.error(`FAIL ${r.id} ${r.variant} ${r.percent}%`);
    if (blocking.length > 0) process.exitCode = 1;
  }
}
