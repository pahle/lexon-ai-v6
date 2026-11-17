import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertStableSvgRead, checkSvgSnapshot } from '../svg-snapshot.mjs';

const markup =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><path d="M0 0L1 1"></path></svg>';
const fresh = () => join(mkdtempSync(join(tmpdir(), 'lexon-svg-')), 's.json');

test('a missing snapshot file fails the check and is not created', () => {
  const file = fresh();
  assert.throws(
    () => checkSvgSnapshot({ file, id: 'a', markup, update: false }),
    /snapshot file is missing/,
  );
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('update writes the entry; a later check passes byte-identically', () => {
  const file = fresh();
  checkSvgSnapshot({ file, id: 'a', markup, update: true });
  checkSvgSnapshot({ file, id: 'b', markup: markup + ' ', update: true });
  assert.doesNotThrow(() =>
    checkSvgSnapshot({ file, id: 'a', markup, update: false }),
  );
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(stored.snapshots), ['a', 'b']);
  assert.equal(stored.snapshots.a, markup);
});

test('one changed attribute in the stored snapshot fails the check', () => {
  const file = fresh();
  checkSvgSnapshot({ file, id: 'a', markup, update: true });
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.snapshots.a = stored.snapshots.a.replace('width="20"', 'width="21"');
  writeFileSync(file, JSON.stringify(stored));
  assert.throws(
    () => checkSvgSnapshot({ file, id: 'a', markup, update: false }),
    /"a" differs from the committed snapshot/,
  );
});

test('an id missing from an existing file fails the check', () => {
  const file = fresh();
  checkSvgSnapshot({ file, id: 'a', markup, update: true });
  assert.throws(
    () => checkSvgSnapshot({ file, id: 'zzz', markup, update: false }),
    /has no entry for "zzz"/,
  );
});

test('two reads of one frame must be equal', () => {
  assert.doesNotThrow(() => assertStableSvgRead('a', markup, markup));
  assert.throws(
    () => assertStableSvgRead('a', markup, markup.replace('20', '21')),
    /"a" changed between two reads/,
  );
});
