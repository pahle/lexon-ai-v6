import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/ci.yml'),
  'utf8',
);
const composeJob = workflow.match(
  / {2}compose-e2e:\n([\s\S]*?)(?=\n {2}[\w-]+:\n|$)/,
)?.[1];
assert.ok(composeJob, 'Compose E2E job exists');

function stepBlock(job, name) {
  const start = job.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `workflow contains named step: ${name}`);
  const next = job.indexOf('\n      - name:', start + 1);
  return job.slice(start, next < 0 ? job.length : next);
}

test('manual capture mode preserves compare, update, and normal Compose E2E behavior', () => {
  assert.match(
    workflow,
    /visual_mode:[\s\S]*?options:\n\s+- compare\n\s+- capture\n\s+- update\n\s+default: compare/,
  );
  const compose = stepBlock(
    composeJob,
    'Full Compose browser API and topology layer',
  );
  assert.match(compose, /inputs\.visual_mode.*capture/);
  assert.match(compose, /LEXON_VISUAL_MODE=capture pnpm test:e2e\s*(?:\n|$)/);
  assert.doesNotMatch(
    compose,
    /LEXON_VISUAL_MODE=capture[^\n]*--update-snapshots/,
  );
  assert.match(
    compose,
    /LEXON_VISUAL_MODE=update pnpm test:e2e --update-snapshots/,
  );
  assert.match(compose, /LEXON_VISUAL_MODE=compare pnpm test:e2e/);
  assert.match(compose, /else\s+pnpm test:e2e/);
});

test('manual capture records a post-checkout freshness marker and always validates the manifest', () => {
  const checkout = composeJob.indexOf('- uses: actions/checkout@');
  const marker = stepBlock(composeJob, 'Record visual audit freshness marker');
  const capture = stepBlock(
    composeJob,
    'Full Compose browser API and topology layer',
  );
  const manifest = stepBlock(composeJob, 'Write fresh visual audit manifest');
  const captureBranch = capture.match(
    /(?:if|elif) \[ "\$\{\{ inputs\.visual_mode \}\}" = "capture" \]; then\n([\s\S]*?)\n\s*(?:elif|else|fi)/,
  )?.[1];
  assert.ok(checkout >= 0, 'Compose job checks out the repository');
  assert.ok(checkout < composeJob.indexOf(marker));
  assert.ok(composeJob.indexOf(marker) < composeJob.indexOf(capture));
  assert.ok(captureBranch, 'Compose step has an explicit capture branch');
  assert.match(captureBranch, /LEXON_VISUAL_MODE=capture pnpm test:e2e/);
  assert.doesNotMatch(captureBranch, /--update-snapshots/);
  assert.match(
    marker,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.visual_mode == 'capture'/,
  );
  assert.match(marker, /Date\.now\(\)/);
  assert.match(marker, /\.cache\/f4-f21-baseline-audit\/start-epoch-ms\.txt/);
  assert.match(
    manifest,
    /if: always\(\) && github\.event_name == 'workflow_dispatch' && inputs\.visual_mode == 'capture'/,
  );
  assert.match(manifest, /scripts\/test\/visual-capture-manifest\.mjs/);
  assert.match(manifest, /--not-before/);
  assert.match(manifest, /\.cache\/f4-f21-baseline-audit\/start-epoch-ms\.txt/);
  assert.match(
    manifest,
    /--output \.cache\/f4-f21-baseline-audit\/manifest\.json/,
  );
  assert.doesNotMatch(manifest, /--update-snapshots|rm\s+-rf/);
});

test('manual capture audit artifacts always upload for fourteen days without writing baselines', () => {
  const upload = stepBlock(composeJob, 'Upload F2.1 manual capture audit');
  assert.match(
    upload,
    /if: always\(\) && github\.event_name == 'workflow_dispatch' && inputs\.visual_mode == 'capture'/,
  );
  assert.match(upload, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(upload, /name: f4-f21-baseline-audit-\$\{\{ github\.sha \}\}/);
  for (const path of [
    'docs/references/F2.1-visual/review/*.png',
    '.cache/f4-f21-baseline-audit/start-epoch-ms.txt',
    '.cache/f4-f21-baseline-audit/manifest.json',
    'docs/references/F2.1-visual/index.json',
    'docs/references/F2.1-visual/approval.json',
    'docs/references/F2.1-visual/baseline-manifest.json',
  ])
    assert.ok(upload.includes(path), `audit upload includes ${path}`);
  assert.match(upload, /retention-days: 14/);
  assert.doesNotMatch(upload, /--update-snapshots|rm\s+-rf/);
});
