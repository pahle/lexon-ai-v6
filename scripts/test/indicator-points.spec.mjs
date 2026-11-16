import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { MARKS } from '../../frontend/src/components/chat/indicator/indicator-geometry.ts';
import {
  DOT_COUNT_EXPECTED,
  computeSourceHash,
} from '../generate-indicator-points.mjs';
import {
  MARK_PATH_LENGTHS,
  MARK_POINTS,
  SOURCE_HASH,
} from '../../frontend/src/components/chat/indicator/indicator-points.ts';

// indicator-points.ts is generated from the mark paths in
// indicator-geometry.ts by scripts/generate-indicator-points.mjs. These tests
// need no browser: they only check that the committed table is current.
test('the point table was generated from the current mark paths', () => {
  assert.equal(
    SOURCE_HASH,
    computeSourceHash(MARKS),
    'mark paths changed: run node scripts/generate-indicator-points.mjs',
  );
});

test('every mark has 26 finite points inside the 20x20 box', () => {
  assert.equal(DOT_COUNT_EXPECTED, 26);
  assert.deepEqual(Object.keys(MARK_POINTS).sort(), Object.keys(MARKS).sort());
  for (const [id, points] of Object.entries(MARK_POINTS)) {
    assert.equal(points.length, 26, `${id} point count`);
    for (const [x, y] of points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${id} finite`);
      assert.ok(x >= 0 && x <= 20 && y >= 0 && y <= 20, `${id} in box`);
    }
  }
});

test('every path of every mark has a positive finite length', () => {
  for (const [id, mark] of Object.entries(MARKS)) {
    const lengths = MARK_PATH_LENGTHS[id];
    assert.equal(lengths.length, mark.paths.length, `${id} length count`);
    for (const length of lengths) {
      assert.ok(Number.isFinite(length) && length > 0, `${id} length`);
    }
  }
});

// The brand's micro-tier monogram
// (docs/brand/lexon-2026-v4.1/logo/LEXON-monogram-micro-seal.svg; README.md
// line 14 names the thinking indicator as a use) is a 911 x 911 SVG: a group
// translated by (194.5, 64) holding three paths. Its middle is one bar by
// design. The indicator's lexon mark is exactly those three shapes scaled to a
// 20 x 20 box.
test('the lexon mark matches the brand micro monogram scaled to 20x20', () => {
  const svg = readFileSync(
    resolve(
      import.meta.dirname,
      '../../docs/brand/lexon-2026-v4.1/logo/LEXON-monogram-micro-seal.svg',
    ),
    'utf8',
  );
  const group =
    /<g transform="translate\(([\d.]+) ([\d.]+)\)"[^>]*>(.*)<\/g>/s.exec(svg);
  assert.ok(group, 'brand group found');
  const [, tx, ty, body] = group;
  assert.equal(Number(tx), 194.5);
  assert.equal(Number(ty), 64);
  const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
  const k = 20 / size;
  const brand = [...body.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(brand.length, 3);

  const tokens = (d) => d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g);
  // Translate and scale each coordinate (H is an x, V is a y, others pair up).
  const scale = (d) => {
    let cmd = '';
    let index = 0;
    return tokens(d)
      .map((token) => {
        if (/[A-Za-z]/.test(token)) {
          cmd = token;
          index = 0;
          return token;
        }
        const isX = cmd === 'H' || (cmd !== 'V' && index % 2 === 0);
        index += 1;
        return ((Number(token) + Number(isX ? tx : ty)) * k).toFixed(3);
      })
      .join(' ');
  };
  const normalize = (d) =>
    tokens(d)
      .map((t) => (/[A-Za-z]/.test(t) ? t : Number(t).toFixed(3)))
      .join(' ');

  assert.equal(MARKS.lexon.paths.length, 3);
  brand.forEach((d, i) => {
    assert.equal(normalize(MARKS.lexon.paths[i]), scale(d), `shape ${i}`);
  });
});
