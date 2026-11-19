import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

// Brand v4.1 (docs/brand/lexon-2026-v4.1/): the app serves the four logo
// SVGs unchanged, and icons generated from the monogram by
// scripts/generate-brand-icons.mjs.
const root = resolve(import.meta.dirname, '../..');
const brandLogos = resolve(root, 'docs/brand/lexon-2026-v4.1/logo');
const publicRoot = resolve(root, 'frontend/public');
const appRoot = resolve(root, 'frontend/src/app');

const logos = [
  'LEXON-monogram-micro-seal.svg',
  'LEXON-wordmark-compact-ink.svg',
  'LEXON-wordmark-compact-white.svg',
  'LEXON-wordmark-ink.svg',
];
const icons = [
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'apple-touch-icon.png',
  'favicon.ico',
  'favicon.svg',
];

function pngSize(path) {
  const bytes = readFileSync(path);
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `${path} is a PNG`,
  );
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function icoSizes(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.readUInt16LE(0), 0, 'ICO reserved field');
  assert.equal(bytes.readUInt16LE(2), 1, 'ICO type');
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    // Each entry is an embedded PNG whose own header states its size.
    const image = bytes.subarray(offset, offset + size);
    assert.ok(
      image
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'ICO entry is a PNG',
    );
    assert.equal(image.readUInt32BE(16), bytes[entry] || 256);
    // Next.js decodes favicon.ico at build time and accepts only RGBA PNGs.
    assert.equal(image[25], 6, 'ICO entry PNG is RGBA (color type 6)');
    return image.readUInt32BE(16);
  });
}

test('the public folder holds exactly the v4.1 marks and the generated icons', () => {
  assert.deepEqual(readdirSync(publicRoot).sort(), [...icons, ...logos].sort());
  assert.deepEqual(readdirSync(brandLogos).sort(), logos);
  for (const logo of logos)
    assert.ok(
      readFileSync(resolve(publicRoot, logo)).equals(
        readFileSync(resolve(brandLogos, logo)),
      ),
      `${logo} differs from the brand package`,
    );
});

test('icons are generated from the monogram at the expected sizes', () => {
  const monogram = readFileSync(
    resolve(brandLogos, 'LEXON-monogram-micro-seal.svg'),
  );
  assert.ok(readFileSync(resolve(publicRoot, 'favicon.svg')).equals(monogram));
  assert.ok(readFileSync(resolve(appRoot, 'icon.svg')).equals(monogram));
  assert.deepEqual(
    pngSize(resolve(publicRoot, 'apple-touch-icon.png')),
    [180, 180],
  );
  assert.deepEqual(pngSize(resolve(appRoot, 'apple-icon.png')), [180, 180]);
  assert.deepEqual(
    pngSize(resolve(publicRoot, 'android-chrome-192x192.png')),
    [192, 192],
  );
  assert.deepEqual(
    pngSize(resolve(publicRoot, 'android-chrome-512x512.png')),
    [512, 512],
  );
  for (const path of [
    resolve(publicRoot, 'favicon.ico'),
    resolve(appRoot, 'favicon.ico'),
  ])
    assert.deepEqual(icoSizes(path), [16, 32, 48]);
  assert.ok(
    readFileSync(resolve(appRoot, 'favicon.ico')).equals(
      readFileSync(resolve(publicRoot, 'favicon.ico')),
    ),
  );
  assert.ok(
    readFileSync(resolve(appRoot, 'apple-icon.png')).equals(
      readFileSync(resolve(publicRoot, 'apple-touch-icon.png')),
    ),
  );
});

test('the manifest uses the v4.1 colors and existing icons', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(appRoot, 'manifest.webmanifest'), 'utf8'),
  );
  assert.equal(manifest.name, 'Lexon');
  assert.equal(manifest.short_name, 'Lexon');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#FFFFFF');
  assert.equal(manifest.theme_color, '#1A1718');
  assert.deepEqual(
    manifest.icons.map((icon) => [icon.src, icon.sizes, icon.type]),
    [
      ['/android-chrome-192x192.png', '192x192', 'image/png'],
      ['/android-chrome-512x512.png', '512x512', 'image/png'],
    ],
  );
});

test('no Royal Seal color remains in the public assets', () => {
  const royalSeal =
    /#(f6efe2|eee4d2|e5d9c3|d8c9ad|1f1717|5e5248|7a1f2e|6a1a28|5f6b48|2a1519|3a1e24|4a2830|5a3a40|c9b9a6|a9b58f)/i;
  for (const file of readdirSync(publicRoot).filter((name) =>
    name.endsWith('.svg'),
  ))
    assert.doesNotMatch(
      readFileSync(resolve(publicRoot, file), 'utf8'),
      royalSeal,
      file,
    );
  assert.doesNotMatch(
    readFileSync(resolve(appRoot, 'manifest.webmanifest'), 'utf8'),
    royalSeal,
  );
});
