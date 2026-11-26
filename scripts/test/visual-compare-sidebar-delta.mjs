// Sidebar delta review sheets for the F6 matters-nav re-baseline.
//
// For every id in index.json `pending`, diffs the approved golden
// (`baseline/<id>.png`) against the pending CI capture
// (`<capture-root>/shard-*/review/<id>.png`) with the same pixelmatch-style
// YIQ threshold (0.1) used by visual-compare-prototype.mjs, honours the
// capture `.masks.json` sidecars, and writes one sheet per id:
// approved golden | pending capture | diff overlay with the changed-pixel
// bounding box outlined.
//
// Machine check: the bounding box of unmasked differing pixels must sit
// inside the sidebar region — the 256 px sidebar column on desktop, the
// 300 px sheet on mobile. Ids failing the check (and ids with no approved
// baseline) are reported separately in results.json; nothing is approved or
// written back to the index here.
//
//   node scripts/visual-compare-sidebar-delta.mjs \
//     [--set F4.1-visual] [--capture-root <dir>] [--out-dir <dir>] [--ids a,b]
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { selectPendingCapture } from './visual-pending-selection.mjs';

const root = resolve(import.meta.dirname, '..');
const setDir = resolve(root, 'docs/references/F4.1-visual');
const PANEL_HEIGHT = 520;
/** Sidebar column = 16rem; sheet width = 300px (src/components/ui/sidebar.tsx). */
const SIDEBAR_REGION_X = { desktop: 260, mobile: 304 };

function parseArgs(argv) {
  const args = { captureRoot: null, outDir: null, ids: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === '--set') args.set = next();
    else if (flag === '--capture-root') args.captureRoot = next();
    else if (flag === '--out-dir') args.outDir = next();
    else if (flag === '--ids') args.ids = next().split(',');
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return args;
}

function readMasks(imagePath) {
  const file = `${imagePath}.masks.json`;
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : (parsed.rects ?? []);
}

/** Runs inside Chromium: golden-vs-capture diff plus bounding-box sheet. */
async function diffInPage(args) {
  const { goldB64, capB64, masks, width, height, labels } = args;
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
  const a = draw(await load(goldB64));
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
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
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
      const px = i % width;
      const py = (i / width) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      overlay.data[o] = 255;
      overlay.data[o + 1] = 0;
      overlay.data[o + 2] = 0;
    }
  }
  const percent = counted === 0 ? 0 : (differing / counted) * 100;
  const bbox = differing === 0 ? null : { x0: minX, y0: minY, x1: maxX, y1: maxY };

  const overlayCanvas = new OffscreenCanvas(width, height);
  const overlayCtx = overlayCanvas.getContext('2d');
  overlayCtx.putImageData(overlay, 0, 0);
  if (bbox) {
    overlayCtx.strokeStyle = '#0080ff';
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0 + 1, bbox.y1 - bbox.y0 + 1);
  }
  const panelH = labels.panelH;
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
    ['approved golden', a.canvas],
    ['pending capture', b.canvas],
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
  return { percent, differing, bbox, sheetB64: btoa(binary) };
}

/** Tiles labelled captures with the diff bounding box into one sheet page. */
async function contactInPage(args) {
  const { tiles, tileW, tileH, cols } = args;
  const load = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  };
  const pad = 12;
  const labelH = 18;
  const rows = Math.ceil(tiles.length / cols);
  const sheet = new OffscreenCanvas(
    pad + cols * (tileW + pad),
    pad + rows * (tileH + labelH + pad),
  );
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e7e5e0';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (const [n, tile] of tiles.entries()) {
    const bitmap = await load(tile.pngB64);
    const col = n % cols;
    const row = Math.floor(n / cols);
    const x = pad + col * (tileW + pad);
    const y = pad + row * (tileH + labelH + pad);
    ctx.fillStyle = tile.regionOk ? '#1c1b19' : '#b00020';
    ctx.font = '600 11px sans-serif';
    ctx.fillText(
      `${tile.id} ${tile.differing === 0 ? '(identical)' : `${tile.percent}%`}${tile.regionOk ? '' : ' OUT-OF-REGION'}`,
      x,
      y + 12,
    );
    const scale = tileW / bitmap.width;
    const h = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, x, y + labelH, tileW, h);
    if (tile.bbox) {
      ctx.strokeStyle = '#0080ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        x + tile.bbox.x0 * scale,
        y + labelH + tile.bbox.y0 * scale,
        (tile.bbox.x1 - tile.bbox.x0 + 1) * scale,
        (tile.bbox.y1 - tile.bbox.y0 + 1) * scale,
      );
    }
    ctx.strokeStyle = tile.regionOk ? '#b9b6ae' : '#b00020';
    ctx.strokeRect(x - 0.5, y + labelH - 0.5, tileW + 1, h + 1);
  }
  const blob = await sheet.convertToBlob({ type: 'image/png' });
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 0x8000)
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.set ? resolve(root, 'docs/references', args.set) : setDir;
  const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8'));
  const baselineDir = resolve(dir, 'baseline');
  const captureRoot = args.captureRoot ? resolve(args.captureRoot) : null;
  const outDir = resolve(args.outDir ?? resolve(dir, 'sidebar-delta'));
  if (!captureRoot) throw new Error('--capture-root is required');
  mkdirSync(resolve(outDir, 'sheets'), { recursive: true });
  mkdirSync(resolve(outDir, 'contact'), { recursive: true });

  const pending = args.ids ?? index.pending ?? [];
  // Only the shard whose pending.txt lists an id holds its real capture; the
  // other shards' review folders ship the checked-in bytes. Selection throws
  // on vacuous/conflicting picks — a baseline-vs-baseline compare must never
  // reach a review sheet.
  const captureFor = new Map();
  const selectionMeta = new Map();
  for (const id of pending) {
    const baselinePath = resolve(baselineDir, `${id}.png`);
    const picked = selectPendingCapture({
      captureRoot,
      id,
      baselinePath: existsSync(baselinePath) ? baselinePath : null,
    });
    captureFor.set(id, picked.path);
    selectionMeta.set(id, picked);
  }

  const browser = await chromium.launch();
  const results = [];
  const verdict = { insideRegion: [], outsideRegion: [], noBaseline: [], missingCapture: [] };
  try {
    const page = await browser.newPage();
    for (const id of pending) {
      const view = index.views[id];
      if (!view) {
        results.push({ id, status: 'missing-from-index' });
        continue;
      }
      const capturePath = captureFor.get(id);
      if (!capturePath) {
        verdict.missingCapture.push(id);
        results.push({ id, status: 'missing-capture', viewport: view.viewport, theme: view.theme });
        continue;
      }
      const baselinePath = resolve(baselineDir, `${id}.png`);
      if (!existsSync(baselinePath)) {
        verdict.noBaseline.push(id);
        results.push({
          id, status: 'no-baseline', viewport: view.viewport, theme: view.theme,
          capture: basename(capturePath),
        });
        continue;
      }
      const masks = readMasks(capturePath);
      const size = index.viewports[view.viewport];
      const out = await page.evaluate(diffInPage, {
        goldB64: readFileSync(baselinePath).toString('base64'),
        capB64: readFileSync(capturePath).toString('base64'),
        masks,
        width: size.width,
        height: size.height,
        labels: {
          title: `${id} — ${view.state ?? ''}`,
          note: `approved golden vs pending capture (run 45807656646) — ${masks.length} masked rect(s)`,
          panelH: PANEL_HEIGHT,
        },
      });
      writeFileSync(
        resolve(outDir, 'sheets', `${id}.png`),
        Buffer.from(out.sheetB64, 'base64'),
      );
      const regionX = SIDEBAR_REGION_X[view.viewport];
      const inside = out.bbox === null || out.bbox.x1 < regionX;
      (inside ? verdict.insideRegion : verdict.outsideRegion).push(id);
      const meta = selectionMeta.get(id) ?? {};
      results.push({
        id,
        status: 'diffed',
        viewport: view.viewport,
        theme: view.theme,
        captureShard: meta.shard,
        identicalToBaseline: meta.identicalToBaseline ?? false,
        identicalToCheckedIn: meta.identicalToCheckedIn ?? false,
        staleReviewDrift: meta.staleReviewDrift ?? false,
        percent: Number(out.percent.toFixed(2)),
        differing: out.differing,
        bbox: out.bbox,
        regionLimitX: regionX,
        insideSidebarRegion: inside,
      });
    }

    // Contact sheets: one page-set per variant, tiling pending captures with
    // the diff bounding box outlined (blue) — nothing approved here, this is
    // the review surface only.
    const cols = 3;
    const perPage = 18;
    const byVariant = new Map();
    for (const r of results) {
      if (r.status !== 'diffed') continue;
      const key = `${r.viewport}-${r.theme}`;
      if (!byVariant.has(key)) byVariant.set(key, []);
      byVariant.get(key).push(r);
    }
    for (const [variant, rows] of byVariant) {
      const totalPages = Math.ceil(rows.length / perPage);
      const viewport = index.viewports[variant.split('-')[0]];
      const tileW = viewport.width > 1000 ? 430 : 210;
      const tileH = Math.round((viewport.height / viewport.width) * tileW);
      const vCols = viewport.width > 1000 ? cols : 5;
      for (let pageNo = 0; pageNo < totalPages; pageNo += 1) {
        const slice = rows.slice(pageNo * perPage, (pageNo + 1) * perPage);
        const b64 = await page.evaluate(contactInPage, {
          tiles: slice.map((r) => ({
            id: r.id,
            regionOk: r.insideSidebarRegion,
            differing: r.differing,
            percent: r.percent,
            bbox: r.bbox,
            pngB64: readFileSync(captureFor.get(r.id)).toString('base64'),
          })),
          tileW,
          tileH,
          cols: vCols,
        });
        const suffix = totalPages === 1 ? '' : `-${pageNo + 1}`;
        writeFileSync(
          resolve(outDir, 'contact', `contact-${variant}${suffix}.png`),
          Buffer.from(b64, 'base64'),
        );
      }
    }
    if (verdict.noBaseline.length) {
      const b64 = await page.evaluate(contactInPage, {
        tiles: verdict.noBaseline.map((id) => ({
          id: `${id} (no baseline)`,
          regionOk: true,
          differing: 0,
          percent: 0,
          bbox: null,
          pngB64: readFileSync(captureFor.get(id)).toString('base64'),
        })),
        tileW: 430,
        tileH: 270,
        cols: 2,
      });
      writeFileSync(
        resolve(outDir, 'contact', 'contact-no-baseline.png'),
        Buffer.from(b64, 'base64'),
      );
    }
  } finally {
    await browser.close();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceRun: 45807656646,
    sourceSha: '0accec6c',
    pendingIds: pending.length,
    region: { desktopXLimit: SIDEBAR_REGION_X.desktop, mobileXLimit: SIDEBAR_REGION_X.mobile },
    verdict: {
      insideRegion: verdict.insideRegion.length,
      outsideRegion: verdict.outsideRegion,
      noBaseline: verdict.noBaseline,
      missingCapture: verdict.missingCapture,
    },
    results,
  };
  writeFileSync(resolve(outDir, 'results.json'), `${JSON.stringify(summary, null, 1)}\n`);
  console.log(
    `pending=${pending.length} inside=${verdict.insideRegion.length} ` +
      `outside=${verdict.outsideRegion.length} noBaseline=${verdict.noBaseline.length} ` +
      `missingCapture=${verdict.missingCapture.length}`,
  );
  if (verdict.outsideRegion.length) console.log(`OUTSIDE: ${verdict.outsideRegion.join(', ')}`);
  if (verdict.noBaseline.length) console.log(`NO BASELINE: ${verdict.noBaseline.join(', ')}`);
}

await main();
