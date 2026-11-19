import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const RETIRED_PATTERN =
  'F2\\.1-visual|F4-visual|f2\\.1-prototype|f4-prototype|docs/brand/lexon-2026/|f4\\.1-prototype/screens/[0-9]{2}-';

// Historical records of past slices. Exact file paths only; never a folder.
// docs/specs/ is never allowlisted.
const HISTORICAL = [
  'scripts/test/retired-sets.spec.mjs',
  'docs/briefs/F2.1-visual-rework.md',
  'docs/briefs/F4-chat.md',
  'docs/briefs/F4.1-brand-refresh.md',
  'docs/briefs/F4.2-hardening.md',
  'docs/briefs/README.md',
  'docs/references/F2.1-acceptance.md',
  'docs/references/F2.1-execution-decisions.md',
  'docs/references/F4-acceptance.md',
  'docs/references/F4-f21-baseline-audit.md',
  'docs/references/F4-final-fixes.md',
  'docs/references/F4.1-acceptance.md',
  'docs/references/F4.1-visual/deviations.md',
  'docs/references/F4.1-visual/assertion-migration.md',
  'docs/superpowers/plans/2026-11-03-f2.1-visual-rework.md',
  'docs/superpowers/plans/2026-11-09-f4-chat.md',
  'docs/superpowers/plans/2026-11-15-f4.1-brand-refresh.md',
  'docs/superpowers/plans/2026-11-19-f4.2-hardening.md',
  'docs/superpowers/specs/2026-11-03-f2.1-visual-rework-design.md',
  'docs/superpowers/specs/2026-11-09-f4-chat-design.md',
  'docs/superpowers/specs/2026-11-15-f4.1-brand-refresh-design.md',
  'docs/superpowers/specs/2026-11-19-f4.2-hardening-design.md',
];

const ARCHIVE_PREFIX = 'docs/references/archive/';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function retiredHits() {
  let out = '';
  try {
    out = git(['grep', '-nE', RETIRED_PATTERN, '--', '.']);
  } catch (error) {
    if (error.status !== 1) throw error; // 1 = no match
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(0, line.indexOf(':'));
      return !file.startsWith(ARCHIVE_PREFIX) && !HISTORICAL.includes(file);
    });
}

const PNG_PATHSPECS = ['*/compare/*.png', '*/contact-sheets/*.png'];

test('no tracked file references a retired path', () => {
  const regex = new RegExp(RETIRED_PATTERN);
  assert.equal(regex.test('docs/brand/lexon-2026-v4.1/tokens.css'), false);
  assert.equal(regex.test('docs/brand/lexon-2026/tokens.css'), true);
  assert.equal(
    HISTORICAL.some((p) => p.startsWith('docs/specs/')),
    false,
  );
  assert.deepEqual(retiredHits(), []);
});

test('no PNG is tracked under compare/ or contact-sheets/', () => {
  const matcher = /(^|\/)(compare|contact-sheets)\/.*\.png$/;
  assert.equal(matcher.test('x/compare/a.png'), true);
  assert.equal(matcher.test('x/other/a.png'), false);
  const tracked = git(['ls-files', '--', ...PNG_PATHSPECS])
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(tracked, []);
});
