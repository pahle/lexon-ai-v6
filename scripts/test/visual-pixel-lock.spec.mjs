import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertApprovedVisualSet,
  assertBaselineLocks,
  assertIndexedArtifact,
  buildVisualBaselineManifest,
  isPixelLocked,
  hasSvgSnapshot,
  pixelLockedViews,
} from '../visual-mode.mjs';

const sourceSha = 'a'.repeat(40);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = (seed) => {
  const bytes = Buffer.alloc(32, seed);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(1440, 16);
  bytes.writeUInt32BE(900, 20);
  return bytes;
};

/** One pixel-locked view and one svg-snapshot view, which has no baseline. */
function set() {
  const directory = mkdtempSync(join(tmpdir(), 'lexon-pixel-lock-'));
  mkdirSync(join(directory, 'review'));
  mkdirSync(join(directory, 'baseline'));
  const bytes = png(1);
  writeFileSync(join(directory, 'review/locked.png'), bytes);
  writeFileSync(join(directory, 'baseline/locked.png'), bytes);
  writeFileSync(join(directory, 'review/free.png'), png(2));
  const index = {
    version: 1,
    format: 'png',
    deviceScaleFactor: 1,
    viewports: { desktop: { width: 1440, height: 900 } },
    views: {
      locked: { path: 'review/locked.png', viewport: 'desktop' },
      free: {
        path: 'review/free.png',
        viewport: 'desktop',
        lock: 'svg-snapshot',
      },
    },
  };
  const approval = {
    version: 1,
    status: 'approved',
    sourceSha,
    ownerApproval: { reference: 'Owner review', date: '2026-11-15' },
    environment: {
      os: 'Linux 6.8 (linux/x64)',
      browser: 'Chromium 140',
      playwright: '1.64.1',
      node: 'v24.22.1',
      locale: 'en-US',
      timezone: 'Asia/Jakarta',
    },
    images: {
      locked: {
        path: 'review/locked.png',
        sha256: sha256(bytes),
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    },
  };
  return { directory, index, approval };
}

test('only the svg-snapshot lock exempts a view from pixel comparison', () => {
  const { index } = set();
  assert.equal(isPixelLocked(index.views.locked), true);
  assert.equal(isPixelLocked(index.views.free), false);
  assert.deepEqual(Object.keys(pixelLockedViews(index)), ['locked']);
  assert.throws(
    () => isPixelLocked({ path: 'review/x.png', lock: 'nonsense' }),
    /Unknown visual lock "nonsense"/,
  );
});

test('approval covers pixel-locked views only and needs no baseline for the others', () => {
  const { directory, index, approval } = set();
  assert.equal(
    assertApprovedVisualSet(index, approval, directory, {
      expectedViewCount: 1,
    }),
    1,
  );
  const manifest = buildVisualBaselineManifest(index, approval, directory, {
    sourceSha,
    environment: {},
    expectedViewCount: 1,
  });
  assert.deepEqual(Object.keys(manifest.images), ['locked']);
  assert.equal(manifest.viewCount, 1);
});

test('approving an svg-snapshot view is rejected', () => {
  const { directory, index, approval } = set();
  approval.images.free = { ...approval.images.locked, path: 'review/free.png' };
  assert.throws(
    () =>
      assertApprovedVisualSet(index, approval, directory, {
        expectedViewCount: 1,
      }),
    /svg-snapshot/,
  );
});

test('compare mode has no baseline artifact for an svg-snapshot view', () => {
  const { directory, index } = set();
  assert.equal(
    assertIndexedArtifact(index, 'free', directory, { mode: 'compare' }),
    null,
  );
  assert.equal(
    assertIndexedArtifact(index, 'locked', directory, { mode: 'compare' }),
    resolve(directory, 'baseline/locked.png'),
  );
  assert.equal(
    assertIndexedArtifact(index, 'free', directory, { mode: 'capture' }),
    resolve(directory, 'review/free.png'),
  );
});

test('baseline/ must not gain a file for a non-pixel-locked or unknown view', () => {
  const { directory, index } = set();
  // Current state passes: only the pixel-locked view has a baseline.
  assert.doesNotThrow(() => assertBaselineLocks(index, directory));
  writeFileSync(join(directory, 'baseline/free.png'), png(9));
  assert.throws(
    () => assertBaselineLocks(index, directory),
    /free.*svg-snapshot.*no pixel golden/,
  );
  index.views.free.lock = 'engine-tests';
  assert.throws(
    () => assertBaselineLocks(index, directory),
    /free.*engine-tests.*no pixel golden/,
  );
  delete index.views.free;
  assert.throws(
    () => assertBaselineLocks(index, directory),
    /baseline\/free\.png has no indexed view/,
  );
});

test('the checked-in baseline set contains only pixel-locked indexed views', () => {
  const visualRoot = resolve(
    import.meta.dirname,
    '../../docs/references/F4.1-visual',
  );
  const index = JSON.parse(
    readFileSync(join(visualRoot, 'index.json'), 'utf8'),
  );
  assert.doesNotThrow(() => assertBaselineLocks(index, visualRoot));
});

test('the engine-tests lock is neither a pixel golden nor an svg snapshot', () => {
  const { directory, index, approval } = set();
  index.views.free.lock = 'engine-tests';
  assert.equal(isPixelLocked(index.views.free), false);
  assert.equal(hasSvgSnapshot(index.views.free), false);
  assert.equal(hasSvgSnapshot({ lock: 'svg-snapshot' }), true);
  assert.equal(hasSvgSnapshot({ path: 'review/x.png' }), true);
  assert.deepEqual(Object.keys(pixelLockedViews(index)), ['locked']);
  assert.equal(
    assertApprovedVisualSet(index, approval, directory, {
      expectedViewCount: 1,
    }),
    1,
  );
  assert.equal(
    assertIndexedArtifact(index, 'free', directory, { mode: 'compare' }),
    null,
  );
  approval.images.free = { ...approval.images.locked, path: 'review/free.png' };
  assert.throws(
    () =>
      assertApprovedVisualSet(index, approval, directory, {
        expectedViewCount: 1,
      }),
    /engine-tests/,
  );
});
