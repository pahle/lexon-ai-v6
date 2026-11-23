import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// GHSA-g3hv-75wg-m249 guard for the '@ts-morph/common>minimatch' override:
// `shadcn` 4.23.0 (root devDependency) is the only dependent that loads
// ts-morph, so resolving `ts-morph` from a require anchored at shadcn's entry
// proves the override lands on the copy the real dependent loads. The disk
// glob via `addSourceFilesAtPaths` is only a smoke check — internally it
// matches through `ts.matchFiles`/`fast-glob`, never minimatch. The
// discriminating assertion is the in-memory glob: `Project#getSourceFiles`
// calls @ts-morph/common's `matchGlobs`, which reaches
// `RuntimePath#getPathMatchesPattern` → `minimatch(path, pattern)`.
// (`require.resolve('shadcn/package.json')` is not exported by shadcn, so the
// anchor is its `.` entry, which sits in the same package directory.)
test('ts-morph loaded via shadcn matches in-memory globs through minimatch', () => {
  const requireHere = createRequire(import.meta.url);
  const fromShadcn = createRequire(requireHere.resolve('shadcn'));
  const { Project } = fromShadcn('ts-morph');
  const directory = mkdtempSync(join(tmpdir(), 'lexon-tsm-glob-'));
  try {
    writeFileSync(join(directory, 'a-match.ts'), 'export const a = 1;\n');
    writeFileSync(join(directory, 'b-other.ts'), 'export const b = 2;\n');
    writeFileSync(join(directory, 'c-notes.txt'), 'not typescript\n');
    const project = new Project();
    const added = project.addSourceFilesAtPaths(join(directory, '*.ts'));
    assert.deepEqual(
      added.map((sourceFile) => sourceFile.getBaseName()).sort(),
      ['a-match.ts', 'b-other.ts'],
    );
    const matched = project.getSourceFiles(join(directory, 'a-*'));
    assert.deepEqual(
      matched.map((sourceFile) => sourceFile.getBaseName()),
      ['a-match.ts'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
