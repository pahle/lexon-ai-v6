import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);

const eslint = (file) =>
  spawnSync('pnpm', ['exec', 'eslint', file], {
    cwd: root.pathname,
    encoding: 'utf8',
  });

// GHSA-g3hv (minimatch) guard: the eslint dependency chain — flat config
// loading, ignores and rule resolution — must keep behaving identically after
// the override upgrades. A known violation in a linted path fails lint while
// the same file in an ignored path reports no findings.
test('eslint flags a violation in a linted path and skips an ignored path', () => {
  const violation = 'debugger;\n';
  const linted = new URL('backend/src/f44-lint-probe.ts', root).pathname;
  const ignoredDirectory = new URL('backend/dist/', root).pathname;
  const ignored = `${ignoredDirectory}f44-lint-probe.ts`;
  const distExisted = existsSync(ignoredDirectory);
  mkdirSync(ignoredDirectory, { recursive: true });
  try {
    writeFileSync(linted, violation);
    writeFileSync(ignored, violation);
    const flagged = eslint(linted);
    assert.notEqual(
      flagged.status,
      0,
      `eslint accepted a violation in a linted path:\n${flagged.stdout}${flagged.stderr}`,
    );
    assert.match(`${flagged.stdout}${flagged.stderr}`, /no-debugger/u);
    const skipped = eslint(ignored);
    assert.equal(
      skipped.status,
      0,
      `eslint reported an ignored path:\n${skipped.stdout}${skipped.stderr}`,
    );
    assert.doesNotMatch(`${skipped.stdout}${skipped.stderr}`, /no-debugger/u);
  } finally {
    rmSync(linted, { force: true });
    rmSync(ignored, { force: true });
    if (!distExisted)
      rmSync(ignoredDirectory, { recursive: true, force: true });
  }
});
