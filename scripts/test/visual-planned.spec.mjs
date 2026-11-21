import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertApprovedVisualSet,
  assertIndexedArtifact,
  assertVisualIndexLists,
  buildVisualBaselineManifest,
  isPlannedView,
  plannedViewIds,
} from '../visual-mode.mjs';

// `planned`: a state drawn in the prototype but not built yet. It is never
// captured, never compared, and has no approval entry. The slice that builds
// it moves each id from `planned` to `pending` when it captures it.

const root = resolve(import.meta.dirname, '../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = (seed) => {
  const bytes = Buffer.alloc(32, seed);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(1440, 16);
  bytes.writeUInt32BE(900, 20);
  return bytes;
};

function set() {
  const directory = mkdtempSync(join(tmpdir(), 'lexon-planned-'));
  mkdirSync(join(directory, 'review'));
  mkdirSync(join(directory, 'baseline'));
  const bytes = png(1);
  writeFileSync(join(directory, 'review/built.png'), bytes);
  writeFileSync(join(directory, 'baseline/built.png'), bytes);
  const index = {
    version: 1,
    format: 'png',
    deviceScaleFactor: 1,
    viewports: { desktop: { width: 1440, height: 900 } },
    views: {
      built: { path: 'review/built.png', viewport: 'desktop' },
      later: { path: 'review/later.png', viewport: 'desktop' },
    },
    planned: ['later'],
  };
  const approval = {
    version: 1,
    status: 'approved',
    sourceSha: 'a'.repeat(40),
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
      built: {
        path: 'review/built.png',
        sha256: sha256(bytes),
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    },
  };
  return { directory, index, approval };
}

test('planned views are listed and recognised', () => {
  const { index } = set();
  assert.deepEqual(plannedViewIds(index), ['later']);
  assert.equal(isPlannedView(index, 'later'), true);
  assert.equal(isPlannedView(index, 'built'), false);
  assert.deepEqual(plannedViewIds({ views: {} }), []);
});

test('a planned view is never captured or compared', () => {
  const { directory, index } = set();
  for (const mode of ['capture', 'compare', 'update'])
    assert.throws(
      () => assertIndexedArtifact(index, 'later', directory, { mode }),
      /"later" is planned.*move it from planned to pending/,
    );
});

test('a planned view needs no approval entry and is outside the approved count', () => {
  const { directory, index, approval } = set();
  assert.equal(
    assertApprovedVisualSet(index, approval, directory, {
      expectedViewCount: 1,
    }),
    1,
  );
  const manifest = buildVisualBaselineManifest(index, approval, directory, {
    sourceSha: 'a'.repeat(40),
    environment: {},
    expectedViewCount: 1,
  });
  assert.deepEqual(Object.keys(manifest.images), ['built']);
});

test('a planned view cannot have an approval entry', () => {
  const { directory, index, approval } = set();
  approval.images.later = {
    ...approval.images.built,
    path: 'review/later.png',
  };
  assert.throws(
    () =>
      assertApprovedVisualSet(index, approval, directory, {
        expectedViewCount: 1,
      }),
    /Planned visual view "later" has an approval entry/,
  );
});

test('an id cannot be both planned and pending, and planned ids must be indexed', () => {
  const { index } = set();
  assert.throws(
    () => assertVisualIndexLists({ ...index, pending: ['later'] }),
    /"later" is both planned and pending/,
  );
  assert.throws(
    () => assertVisualIndexLists({ ...index, planned: ['ghost'] }),
    /Planned visual view "ghost" is not present in the visual index/,
  );
  assert.throws(
    () => assertVisualIndexLists({ ...index, planned: ['later', 'later'] }),
    /Planned visual view "later" is listed twice/,
  );
  assert.doesNotThrow(() => assertVisualIndexLists(index));
});

test('the F4.1 index lists are valid', () => {
  const index = JSON.parse(
    readFileSync(
      resolve(root, 'docs/references/F4.1-visual/index.json'),
      'utf8',
    ),
  );
  assert.doesNotThrow(() => assertVisualIndexLists(index));
  const approval = JSON.parse(
    readFileSync(
      resolve(root, 'docs/references/F4.1-visual/approval.json'),
      'utf8',
    ),
  );
  for (const id of plannedViewIds(index))
    assert.equal(approval.images[id], undefined, `${id} has no approval`);
});
