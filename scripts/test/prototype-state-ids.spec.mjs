import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const prototypeDirectory = resolve(root, 'docs/design/f4.1-prototype');
// The prototype shows the whole thinking indicator in one state; the capture
// index keeps its three timed frames as separate views.
const indicatorFrames = [
  'indicator-wander',
  'indicator-mark',
  'indicator-finished',
];

function indexStateIds() {
  const index = JSON.parse(
    readFileSync(
      resolve(root, 'docs/references/F4.1-visual/index.json'),
      'utf8',
    ),
  );
  return new Set(
    Object.entries(index.views).map(([id, view]) =>
      id.slice(0, -`-${view.viewport}-${view.theme}`.length),
    ),
  );
}

function prototypeSourceIds() {
  const html = readFileSync(
    resolve(prototypeDirectory, 'source/prototype.html'),
    'utf8',
  );
  const block = /const GROUPS=\[([\s\S]*?)\n\];/.exec(html);
  assert.ok(block, 'prototype.html defines the GROUPS state list');
  const groups = new Function(`return [${block[1]}];`)();
  return groups.flatMap(([, ids]) => ids);
}

function prototypeReadmeIds() {
  const readme = readFileSync(resolve(prototypeDirectory, 'README.md'), 'utf8');
  const section = /^## States\n([\s\S]*?)^## /m.exec(readme);
  assert.ok(section, 'the prototype README has a States section');
  return section[1]
    .split('\n')
    .filter((line) =>
      /^\| (Auth|Status|Shell|Chat|Chats|Matters|Settings|Platform|Indicator) /.test(
        line,
      ),
    )
    .flatMap((line) => [...line.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]));
}

function toCaptureIds(ids) {
  return ids.flatMap((id) => (id === 'indicator' ? indicatorFrames : [id]));
}

test('the prototype README and prototype.html list the same state ids', () => {
  const source = prototypeSourceIds();
  const readme = prototypeReadmeIds();
  assert.equal(new Set(source).size, source.length, 'source ids are unique');
  assert.equal(new Set(readme).size, readme.length, 'README ids are unique');
  assert.deepEqual(readme.toSorted(), source.toSorted());
});

test('the capture index state ids are exactly the prototype state ids', () => {
  const prototype = new Set(toCaptureIds(prototypeSourceIds()));
  const index = indexStateIds();
  assert.deepEqual(
    [...index].filter((id) => !prototype.has(id)).toSorted(),
    [],
    'index states the prototype does not have',
  );
  assert.deepEqual(
    [...prototype].filter((id) => !index.has(id)).toSorted(),
    [],
    'prototype states the index does not have',
  );
});

test('planned index views count as indexed and name prototype states', () => {
  const index = JSON.parse(
    readFileSync(
      resolve(root, 'docs/references/F4.1-visual/index.json'),
      'utf8',
    ),
  );
  const prototype = new Set(toCaptureIds(prototypeSourceIds()));
  const notInPrototype = (index.planned ?? []).filter((id) => {
    const view = index.views[id];
    return (
      !view ||
      !prototype.has(id.slice(0, -`-${view.viewport}-${view.theme}`.length))
    );
  });
  assert.deepEqual(
    notInPrototype,
    [],
    'planned views must be prototype states',
  );
});
