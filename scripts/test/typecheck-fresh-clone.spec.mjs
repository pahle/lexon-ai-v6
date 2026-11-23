import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// `pnpm typecheck` must pass on a fresh clone without a prior build (audit
// A-18). Workspaces whose exports resolve to `dist` must emit their types
// before any dependant is type-checked.

const root = resolve(import.meta.dirname, '../..');
const manifest = (dir) =>
  JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
const distExports = (exports = {}) =>
  JSON.stringify(exports).includes('./dist/');

test('workspaces exported from dist declare a build:types script', () => {
  const missing = ['backend', 'frontend', 'shared', 'evals']
    .map((dir) => ({ dir, pkg: manifest(dir) }))
    .filter(({ pkg }) => distExports(pkg.exports))
    .filter(
      ({ pkg }) =>
        pkg.scripts?.['build:types'] !== 'tsc -p tsconfig.build.json',
    )
    .map(({ dir }) => dir);
  assert.deepEqual(missing, []);
});

test('root typecheck emits workspace types before type-checking', () => {
  const steps = manifest('.')
    .scripts.typecheck.split('&&')
    .map((step) => step.trim());
  assert.deepEqual(steps, [
    'pnpm -r --sort --if-present run build:types',
    'pnpm -r --sort typecheck',
  ]);
});
