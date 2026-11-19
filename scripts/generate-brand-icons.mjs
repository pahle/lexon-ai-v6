// Generates the favicon, Apple touch icon, and manifest icons from the brand
// v4.1 monogram (docs/brand/lexon-2026-v4.1/logo/LEXON-monogram-micro-seal.svg).
// Run with `node scripts/generate-brand-icons.mjs` after the monogram changes;
// the outputs are committed. Uses the pinned Playwright Chromium, so no image
// library is needed.
import { chromium } from '@playwright/test';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const monogramPath = resolve(
  root,
  'docs/brand/lexon-2026-v4.1/logo/LEXON-monogram-micro-seal.svg',
);
const publicRoot = resolve(root, 'frontend/public');
const appRoot = resolve(root, 'frontend/src/app');
const monogram = readFileSync(monogramPath, 'utf8');
// The mark sits on a white square with clear space around it (LEX-DS-001 §4).
const PADDING = 0.12;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
/**
 * Draws the monogram on an opaque white square in a canvas. Canvas PNG export
 * is always RGBA, which the ICO decoder in Next.js requires.
 */
async function render(size) {
  const base64 = await page.evaluate(
    async ({ svg, size, padding }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size, size);
      const inner = Math.round(size * (1 - 2 * padding));
      const offset = Math.round((size - inner) / 2);
      context.drawImage(image, offset, offset, inner, inner);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { svg: monogram, size, padding: PADDING },
  );
  return Buffer.from(base64, 'base64');
}

/** An ICO container whose entries are PNG images (supported since Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header[entry + 2] = 0; // palette
    header[entry + 3] = 0; // reserved
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

try {
  writeFileSync(
    resolve(publicRoot, 'android-chrome-192x192.png'),
    await render(192),
  );
  writeFileSync(
    resolve(publicRoot, 'android-chrome-512x512.png'),
    await render(512),
  );
  writeFileSync(resolve(publicRoot, 'apple-touch-icon.png'), await render(180));
  const favicon = ico([
    { size: 16, png: await render(16) },
    { size: 32, png: await render(32) },
    { size: 48, png: await render(48) },
  ]);
  writeFileSync(resolve(publicRoot, 'favicon.ico'), favicon);
  copyFileSync(monogramPath, resolve(publicRoot, 'favicon.svg'));
  copyFileSync(monogramPath, resolve(appRoot, 'icon.svg'));
  copyFileSync(
    resolve(publicRoot, 'favicon.ico'),
    resolve(appRoot, 'favicon.ico'),
  );
  copyFileSync(
    resolve(publicRoot, 'apple-touch-icon.png'),
    resolve(appRoot, 'apple-icon.png'),
  );
  console.log('Generated brand icons from', monogramPath);
} finally {
  await browser.close();
}
