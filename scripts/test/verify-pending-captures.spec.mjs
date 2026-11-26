// merge-e2e's pending-capture verification.
//
// pending.txt is appended before the screenshot lands, so shard coverage
// alone does not prove a capture exists; each claimed id must also have its
// review file inside the claiming shard's artifact.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { verifyPendingCaptures } from './verify-pending-captures.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pend-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const indexPath = join(root, 'index.json');
  writeFileSync(
    indexPath,
    JSON.stringify({
      pending: ['a-desktop-light', 'b-desktop-light', 'c-mobile-dark'],
    }),
  );
  const shards = join(root, 'pending-shards');
  return { indexPath, shards };
}

function shard(root, name, claimedIds, files = []) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'review'), { recursive: true });
  writeFileSync(join(dir, 'pending.txt'), `${claimedIds.join('\n')}\n`);
  for (const id of files)
    writeFileSync(join(dir, 'review', `${id}.png`), `png-${id}`);
}

describe('verifyPendingCaptures', () => {
  it('passes when every pending id is claimed and its file exists', (t) => {
    const { indexPath, shards } = fixture(t);
    shard(shards, 'shard-1', ['a-desktop-light'], ['a-desktop-light']);
    shard(
      shards,
      'shard-2',
      ['b-desktop-light', 'c-mobile-dark'],
      ['b-desktop-light', 'c-mobile-dark'],
    );
    assert.deepEqual(verifyPendingCaptures({ indexPath, shardsDir: shards }), {
      pending: 3,
      claimed: 3,
    });
  });

  it('fails when a pending id is claimed by no shard', (t) => {
    const { indexPath, shards } = fixture(t);
    shard(shards, 'shard-1', ['a-desktop-light'], ['a-desktop-light']);
    shard(shards, 'shard-2', ['b-desktop-light'], ['b-desktop-light']);
    assert.throws(
      () => verifyPendingCaptures({ indexPath, shardsDir: shards }),
      /No shard captured pending views: c-mobile-dark/,
    );
  });

  it('fails when a claimed id has no review file in the claiming shard', (t) => {
    const { indexPath, shards } = fixture(t);
    shard(shards, 'shard-1', ['a-desktop-light'], ['a-desktop-light']);
    // shard-2 claims both but only wrote one file.
    shard(
      shards,
      'shard-2',
      ['b-desktop-light', 'c-mobile-dark'],
      ['b-desktop-light'],
    );
    assert.throws(
      () => verifyPendingCaptures({ indexPath, shardsDir: shards }),
      /capture file is missing.*shard-2\/review\/c-mobile-dark\.png/is,
    );
  });
});
