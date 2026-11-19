import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const e2eDirectory = resolve(root, 'backend/test/e2e');
const support = readFileSync(
  resolve(e2eDirectory, 'brand-visual-support.ts'),
  'utf8',
);
const specs = readdirSync(e2eDirectory)
  .filter((name) => /^brand-visual-.+\.spec\.ts$/.test(name))
  .toSorted()
  .map((name) => ({
    name,
    source: readFileSync(resolve(e2eDirectory, name), 'utf8'),
  }));

test('the capture helper runs axe in both themes and fails on any violation', () => {
  assert.match(support, /brandThemes[^=]*=\s*\['light', 'dark'\]/);
  assert.match(support, /for \(const theme of brandThemes\)/);
  assert.match(support, /for \(const viewport of brandViewports\)/);
  for (const tag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    assert.ok(support.includes(`'${tag}'`), `axe uses the ${tag} tag`);
  // captureBrandView runs axe unless a caller opts out with axe: false.
  assert.match(
    support,
    /if \(options\.axe !== false\) await runBrandAxe\(page, id\);/,
  );
  // A violation fails the test: the list must equal [] under expect().
  const run = /export async function runBrandAxe[\s\S]*?\n\}\n/.exec(support);
  assert.ok(run, 'runBrandAxe exists');
  assert.match(run[0], /\.withTags\(brandAxeTags\)\.analyze\(\)/);
  assert.match(run[0], /\.toEqual\(\[\]\)/);
});

test('no brand-visual spec captures a view without the shared helper', () => {
  for (const { name, source } of specs)
    assert.doesNotMatch(
      source,
      /\bcaptureBrandView\(/,
      `${name} calls captureBrandView directly`,
    );
});

test('every capture that skips axe runs axe itself on the same ids', () => {
  const skipped = [];
  for (const { name, source } of specs) {
    const calls = source.split(/(?=captureBrandViews\()/).slice(1);
    for (const call of calls) {
      const state = /^captureBrandViews\(\s*page,\s*'([a-z0-9-]+)'/.exec(
        call,
      )?.[1];
      assert.ok(state, `${name} names the state of every capture`);
      // Only the options object of this call, up to its first hook.
      const options = call.split(/\bopen:|\bclose:/)[0];
      if (/\baxe:\s*false/.test(options)) skipped.push({ name, state, source });
    }
  }
  assert.ok(skipped.length > 0, 'the held indicator frames opt out of axe');
  for (const { name, state, source } of skipped) {
    const own = new RegExp(
      `(runBrandAxe|runBrandAxeOnHeldClock)\\(\\s*page,\\s*brandViewId\\(\\s*'${state}'`,
    );
    assert.match(
      source,
      own,
      `${name}: ${state} opts out of axe (axe: false) but never runs it itself; use runBrandAxeOnHeldClock in its close hook`,
    );
  }
});
