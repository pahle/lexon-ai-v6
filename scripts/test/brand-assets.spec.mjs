import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

test('copies supplied brand assets byte-for-byte and resolves manifest icons', () => {
  const brandRoot = resolve(root, 'docs/brand/lexon-2026');
  const publicRoot = resolve(root, 'frontend/public');
  const checksums = readFileSync(
    resolve(brandRoot, '08_QA/CHECKSUMS.sha256'),
    'utf8',
  );
  const expectedAssets = [
    ...checksums.matchAll(
      /^([\da-f]{64}) {2}\.\/(07_DEVELOPER_HANDOFF\/public\/[^\n]+)$/gm,
    ),
  ];
  assert.ok(expectedAssets.length > 0, 'brand handoff assets are listed');
  const expectedNames = expectedAssets
    .map(([, , sourcePath]) => sourcePath.split('/').at(-1))
    .sort();
  assert.deepEqual(readdirSync(publicRoot).sort(), expectedNames);
  for (const [, expected, sourcePath] of expectedAssets) {
    const source = resolve(brandRoot, sourcePath);
    const destination = resolve(
      root,
      sourcePath.replace('07_DEVELOPER_HANDOFF/public/', 'frontend/public/'),
    );
    assert.equal(hash(source), expected, `${sourcePath} source checksum`);
    assert.equal(hash(destination), expected, `${sourcePath} copied checksum`);
    assert.deepEqual(
      readFileSync(destination),
      readFileSync(source),
      `${sourcePath} copied bytes`,
    );
  }

  const manifestPath = resolve(root, 'frontend/src/app/manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(
    readFileSync(manifestPath),
    readFileSync(
      resolve(brandRoot, '07_DEVELOPER_HANDOFF/manifest.webmanifest'),
    ),
    'App Router manifest bytes',
  );
  for (const icon of manifest.icons) {
    assert.ok(existsSync(resolve(publicRoot, icon.src.slice(1))), icon.src);
  }
  for (const file of ['icon.svg', 'favicon.ico', 'apple-icon.png']) {
    assert.ok(existsSync(resolve(root, 'frontend/src/app', file)), file);
  }
  for (const [target, source] of [
    ['icon.svg', 'public/favicon.svg'],
    ['favicon.ico', 'public/favicon.ico'],
    ['apple-icon.png', 'public/apple-touch-icon.png'],
  ]) {
    assert.deepEqual(
      readFileSync(resolve(root, 'frontend/src/app', target)),
      readFileSync(resolve(brandRoot, `07_DEVELOPER_HANDOFF/${source}`)),
      `${target} metadata bytes`,
    );
  }
});
