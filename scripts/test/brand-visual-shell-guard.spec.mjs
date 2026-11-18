import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

// The sidebar must not move when it collapses (LEX-DS-001 §5.5). The browser
// check lives in the brand-visual shell spec; this guard fails CI if that
// check is weakened or stops being part of the brand-visual project.
test('the shell spec measures tile, Assistant icon and avatar expanded and collapsed', () => {
  const spec = read('backend/test/e2e/brand-visual-shell.spec.ts');
  const start = spec.indexOf('const spots = async');
  assert.ok(start > 0, 'the position measurement exists');
  const block = spec.slice(start);
  assert.match(block, /organizationTrigger\(page\)[\s\S]*?const icon/);
  assert.match(block, /name: 'Primary navigation'[\s\S]*?Assistant navigation/);
  assert.match(
    block,
    /userTrigger\(page\)\.locator\('\[data-slot="avatar"\]'\)/,
  );
  assert.match(block, /tile: \[/);
  assert.match(block, /icon: \[/);
  assert.match(block, /avatar: \[/);
  const collapse = block.indexOf("name: 'Collapse sidebar' }).click()");
  assert.ok(collapse > 0, 'the test collapses the sidebar');
  assert.match(
    block.slice(collapse),
    /JSON\.stringify\(await spots\(\), null, 1\)\)\.toBe\(\s*JSON\.stringify\(expanded, null, 1\)/,
    'the collapsed positions equal the expanded ones',
  );
  assert.doesNotMatch(spec, /test\.(skip|fixme)\(/);
});

test('the shell spec runs in the brand-visual project and CI runs every project', () => {
  assert.match(
    read('playwright.config.ts'),
    /name: 'brand-visual'[\s\S]*?brand-visual-shell\.spec\.ts/,
  );
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pnpm test:e2e\b/);
  assert.doesNotMatch(ci, /test:e2e[^\n]*--project/);
});
