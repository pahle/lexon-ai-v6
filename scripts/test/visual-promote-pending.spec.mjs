import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promotePendingApprovals } from '../visual-promote-pending.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = (seed, width = 1440, height = 900) => {
  const bytes = Buffer.alloc(64, seed);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

/** One pending pixel view (delta + identical) and one non-pixel pending view. */
function set() {
  const directory = mkdtempSync(join(tmpdir(), 'lexon-promote-'));
  mkdirSync(join(directory, 'review'), { recursive: true });
  mkdirSync(join(directory, 'baseline'), { recursive: true });
  const oldBytes = png(1);
  const newBytes = png(2);
  const lockBytes = png(3);
  writeFileSync(join(directory, 'review/delta.png'), oldBytes);
  writeFileSync(join(directory, 'baseline/delta.png'), oldBytes);
  writeFileSync(join(directory, 'review/identical.png'), oldBytes);
  writeFileSync(join(directory, 'baseline/identical.png'), oldBytes);
  writeFileSync(join(directory, 'review/locked.png'), oldBytes);
  const index = {
    version: 1,
    format: 'png',
    deviceScaleFactor: 1,
    viewports: { desktop: { width: 1440, height: 900 } },
    views: {
      delta: { path: 'review/delta.png', viewport: 'desktop' },
      identical: { path: 'review/identical.png', viewport: 'desktop' },
      locked: {
        path: 'review/locked.png',
        viewport: 'desktop',
        lock: 'svg-snapshot',
      },
      keep: { path: 'review/keep.png', viewport: 'desktop' },
    },
    pending: ['delta', 'identical', 'locked'],
    planned: ['keep'],
  };
  const approval = {
    version: 1,
    status: 'approved',
    sourceSha: 'a'.repeat(40),
    ownerApproval: { reference: 'r', date: '2026-01-01' },
    environment: {},
    images: {
      delta: {
        path: 'review/delta.png',
        sha256: sha256(oldBytes),
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
      identical: {
        path: 'review/identical.png',
        sha256: sha256(oldBytes),
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    },
    reapproved: [
      {
        id: 'identical',
        sha256: sha256(oldBytes),
        previousSha256: sha256(png(7)),
        evidence: { pixels: 0 },
        decision: 'prior noise-only re-approval',
      },
    ],
    amendments: [],
  };
  writeFileSync(
    join(directory, 'index.json'),
    JSON.stringify(index, null, 2) + '\n',
  );
  writeFileSync(
    join(directory, 'approval.json'),
    JSON.stringify(approval, null, 2) + '\n',
  );
  const shards = mkdtempSync(join(tmpdir(), 'lexon-promote-shards-'));
  for (const name of ['shard-1', 'shard-2']) {
    mkdirSync(join(shards, name, 'review'), { recursive: true });
    writeFileSync(join(shards, name, 'pending.txt'), '');
  }
  // shard-1 captured delta + locked; shard-2 captured identical.
  writeFileSync(join(shards, 'shard-1/pending.txt'), 'delta\nlocked\n');
  writeFileSync(join(shards, 'shard-2/pending.txt'), 'identical\n');
  writeFileSync(join(shards, 'shard-1/review/delta.png'), newBytes);
  writeFileSync(join(shards, 'shard-2/review/delta.png'), oldBytes);
  writeFileSync(join(shards, 'shard-1/review/locked.png'), lockBytes);
  writeFileSync(join(shards, 'shard-2/review/locked.png'), oldBytes);
  writeFileSync(join(shards, 'shard-1/review/identical.png'), oldBytes);
  writeFileSync(join(shards, 'shard-2/review/identical.png'), oldBytes);
  return { directory, shards, oldBytes, newBytes, lockBytes };
}

const amendment = {
  reference: 'test amendment',
  date: '2026-11-26',
  sourceSha: 'b'.repeat(40),
};

test('approved ids get shard-selected review + baseline bytes and image hashes', () => {
  const { directory, shards, newBytes, oldBytes } = set();
  const out = promotePendingApprovals({
    setDir: directory,
    captureRoot: shards,
    approveIds: ['delta', 'identical'],
    clearOnlyIds: ['locked'],
    amendment,
  });
  assert.equal(
    readFileSync(join(directory, 'review/delta.png')).compare(newBytes),
    0,
  );
  assert.equal(
    readFileSync(join(directory, 'baseline/delta.png')).compare(newBytes),
    0,
  );
  assert.equal(
    readFileSync(join(directory, 'baseline/identical.png')).compare(oldBytes),
    0,
  );
  const approval = JSON.parse(
    readFileSync(join(directory, 'approval.json'), 'utf8'),
  );
  assert.equal(approval.images.delta.sha256, sha256(newBytes));
  assert.equal(approval.images.delta.width, 1440);
  assert.equal(approval.images.identical.sha256, sha256(oldBytes));
  assert.equal(approval.images.locked, undefined);
  // A superseded noise-only re-approval is dropped: review/ and baseline/
  // now both carry the newly approved capture.
  assert.equal(approval.reapproved, undefined);
  assert.deepEqual(out.approved.sort(), ['delta', 'identical']);
  assert.deepEqual(out.cleared, ['locked']);
});

test('clear-only removes from pending without a baseline write', () => {
  const { directory, shards } = set();
  promotePendingApprovals({
    setDir: directory,
    captureRoot: shards,
    approveIds: ['delta', 'identical'],
    clearOnlyIds: ['locked'],
    amendment,
  });
  const index = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
  assert.equal(index.pending, undefined);
  assert.equal(existsSync(join(directory, 'baseline/locked.png')), false);
  const approval = JSON.parse(
    readFileSync(join(directory, 'approval.json'), 'utf8'),
  );
  assert.equal(approval.amendments.length, 1);
  assert.equal(approval.amendments[0].sourceSha, amendment.sourceSha);
  assert.deepEqual(approval.amendments[0].viewIds.sort(), [
    'delta',
    'identical',
  ]);
});

test('a pixel-locked id in clear-only is refused', () => {
  const { directory, shards } = set();
  assert.throws(
    () =>
      promotePendingApprovals({
        setDir: directory,
        captureRoot: shards,
        approveIds: ['delta'],
        clearOnlyIds: ['identical'],
        amendment,
      }),
    /pixel/,
  );
});

test('ids outside pending are refused', () => {
  const { directory, shards } = set();
  assert.throws(
    () =>
      promotePendingApprovals({
        setDir: directory,
        captureRoot: shards,
        approveIds: ['delta', 'keep'],
        clearOnlyIds: [],
        amendment,
      }),
    /pending/,
  );
});

test('a non-pixel-locked id cannot be approved for a baseline', () => {
  const { directory, shards } = set();
  assert.throws(
    () =>
      promotePendingApprovals({
        setDir: directory,
        captureRoot: shards,
        approveIds: ['locked'],
        clearOnlyIds: [],
        amendment,
      }),
    /baseline|pixel/,
  );
});
