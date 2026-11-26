// Shard selection for pending visual captures.
//
// Every shard's visual-pending artifact ships review/*.png wholesale — the
// ids a shard did not capture arrive as copies of the checked-in review
// bytes (equal to baseline only for promoted views). The shard's pending.txt
// (written by the capture helper when it captures the id) is the only
// authoritative assignment; picking "first file found" silently diffs
// baseline against baseline.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { selectPendingCapture } from '../visual-pending-selection.mjs';

const BASELINE = Buffer.from('baseline-bytes');
const REAL_A = Buffer.from('real-capture-a');
const REAL_B = Buffer.from('real-capture-b');
const STALE_REVIEW = Buffer.from('checked-in-review-drift');

function shardDir(root, name, ids, files) {
  const dir = join(root, name);
  const review = join(dir, 'review');
  mkdirSync(review, { recursive: true });
  writeFileSync(join(dir, 'pending.txt'), `${ids.join('\n')}\n`);
  for (const [id, bytes] of Object.entries(files))
    writeFileSync(join(review, `${id}.png`), bytes);
}

function baselineFile(root) {
  const baselinePath = join(root, 'baseline.png');
  writeFileSync(baselinePath, BASELINE);
  return baselinePath;
}

describe('selectPendingCapture', () => {
  it('returns the file from the shard whose pending.txt lists the id', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', ['a-desktop-light'], {
      'a-desktop-light': REAL_A,
      'b-desktop-light': BASELINE,
    });
    shardDir(root, 'shard-2', ['b-desktop-light'], {
      'a-desktop-light': BASELINE,
      'b-desktop-light': REAL_B,
    });
    shardDir(root, 'shard-3', [], {
      'a-desktop-light': BASELINE,
      'b-desktop-light': BASELINE,
    });
    assert.equal(
      selectPendingCapture({ captureRoot: root, id: 'a-desktop-light' }).path,
      join(root, 'shard-1', 'review', 'a-desktop-light.png'),
    );
    assert.equal(
      selectPendingCapture({ captureRoot: root, id: 'b-desktop-light' }).path,
      join(root, 'shard-2', 'review', 'b-desktop-light.png'),
    );
  });

  it('fails when the claiming shard holds baseline bytes while another shard differs', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', ['a-desktop-light'], {
      'a-desktop-light': BASELINE,
    });
    shardDir(root, 'shard-2', [], { 'a-desktop-light': REAL_A });
    const baselinePath = baselineFile(root);
    assert.throws(
      () =>
        selectPendingCapture({
          captureRoot: root,
          id: 'a-desktop-light',
          baselinePath,
        }),
      /baseline bytes.*shard-1.*shard-2/i,
    );
  });

  it('fails when non-claiming shards hold different files', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', ['a-desktop-light'], {
      'a-desktop-light': REAL_A,
    });
    shardDir(root, 'shard-2', [], { 'a-desktop-light': REAL_B });
    shardDir(root, 'shard-3', [], { 'a-desktop-light': BASELINE });
    const baselinePath = baselineFile(root);
    assert.throws(
      () =>
        selectPendingCapture({
          captureRoot: root,
          id: 'a-desktop-light',
          baselinePath,
        }),
      /conflicting|disagree/i,
    );
  });

  it('accepts a byte-identical recapture when every shard agrees', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', ['a-desktop-light'], {
      'a-desktop-light': BASELINE,
    });
    shardDir(root, 'shard-2', [], { 'a-desktop-light': BASELINE });
    const baselinePath = baselineFile(root);
    const picked = selectPendingCapture({
      captureRoot: root,
      id: 'a-desktop-light',
      baselinePath,
    });
    assert.equal(
      picked.path,
      join(root, 'shard-1', 'review', 'a-desktop-light.png'),
    );
    assert.equal(picked.identicalToBaseline, true);
  });

  it('fails when no shard claims the id', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', [], { 'a-desktop-light': REAL_A });
    assert.throws(
      () => selectPendingCapture({ captureRoot: root, id: 'a-desktop-light' }),
      /not claimed|no shard/i,
    );
  });

  it('fails when the claiming shard is missing the file', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', ['a-desktop-light'], {});
    assert.throws(
      () => selectPendingCapture({ captureRoot: root, id: 'a-desktop-light' }),
      /missing|no file/i,
    );
  });

  it('flags a recapture matching drifted checked-in bytes (ambiguous stale)', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    // STALE_REVIEW differs from the approved baseline (review/ drifted ahead)
    // and every shard carries it — legit identical recapture and stale claim
    // are indistinguishable post-hoc, so the pick is flagged for eye review.
    shardDir(root, 'shard-1', ['a-desktop-light'], {
      'a-desktop-light': STALE_REVIEW,
    });
    shardDir(root, 'shard-2', [], { 'a-desktop-light': STALE_REVIEW });
    const baselinePath = baselineFile(root);
    const picked = selectPendingCapture({
      captureRoot: root,
      id: 'a-desktop-light',
      baselinePath,
    });
    assert.equal(picked.identicalToCheckedIn, true);
    assert.equal(picked.identicalToBaseline, false);
    assert.equal(picked.staleReviewDrift, true);
  });

  it('accepts a real capture when review drifted past baseline', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-1', [], { 'a-desktop-light': STALE_REVIEW });
    shardDir(root, 'shard-2', [], { 'a-desktop-light': STALE_REVIEW });
    shardDir(root, 'shard-3', ['a-desktop-light'], {
      'a-desktop-light': REAL_A,
    });
    const baselinePath = baselineFile(root);
    const picked = selectPendingCapture({
      captureRoot: root,
      id: 'a-desktop-light',
      baselinePath,
    });
    assert.equal(
      picked.path,
      join(root, 'shard-3', 'review', 'a-desktop-light.png'),
    );
    assert.equal(picked.staleReviewDrift, true);
  });

  it('accepts a first-time capture with no baseline and no checked-in file', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'pend-sel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    shardDir(root, 'shard-2', ['a-desktop-light'], {
      'a-desktop-light': REAL_A,
    });
    shardDir(root, 'shard-3', [], {});
    const picked = selectPendingCapture({
      captureRoot: root,
      id: 'a-desktop-light',
      baselinePath: null,
    });
    assert.equal(
      picked.path,
      join(root, 'shard-2', 'review', 'a-desktop-light.png'),
    );
    assert.equal(picked.identicalToBaseline, false);
  });
});
