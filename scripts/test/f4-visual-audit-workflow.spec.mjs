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
  const marker = stepBlock(
    composeJob,
    'Record visual capture freshness marker',
  );
  const capture = stepBlock(
    composeJob,
    'Full Compose browser API and topology layer',
  );
  const manifest = stepBlock(composeJob, 'Write F4.1 visual capture manifest');
  const captureBranch = capture.match(
    /(?:if|elif) \[ "\$\{\{ inputs\.visual_mode \}\}" = "capture" \]; then\n([\s\S]*?)\n\s*(?:elif|else|fi)/,
  )?.[1];
  assert.ok(checkout >= 0, 'Compose job checks out the repository');
  assert.ok(checkout < composeJob.indexOf(marker));
  assert.ok(composeJob.indexOf(marker) < composeJob.indexOf(capture));
  assert.ok(composeJob.indexOf(capture) < composeJob.indexOf(manifest));
  assert.ok(captureBranch, 'Compose step has an explicit capture branch');
  assert.match(captureBranch, /LEXON_VISUAL_MODE=capture pnpm test:e2e/);
  assert.doesNotMatch(captureBranch, /--update-snapshots/);
  assert.match(
    marker,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.visual_mode == 'capture'/,
  );
  assert.match(marker, /Date\.now\(\)/);
  assert.match(marker, /\.cache\/f4\.1-visual\/start-epoch-ms\.txt/);
  assert.match(
    manifest,
    /if: always\(\) && github\.event_name == 'workflow_dispatch' && inputs\.visual_mode == 'capture'/,
  );
  assert.match(
    manifest,
    /scripts\/test\/visual-capture-manifest\.mjs --set F4\.1-visual/,
  );
  assert.match(manifest, /--not-before/);
  assert.match(manifest, /\.cache\/f4\.1-visual\/start-epoch-ms\.txt/);
  assert.doesNotMatch(manifest, /--update-snapshots|rm\s+-rf/);
});

test('manual capture and update artifacts always upload for fourteen days', () => {
  const upload = stepBlock(composeJob, 'Upload F4.1 Linux visual set');
  assert.match(
    upload,
    /if: always\(\) && github\.event_name == 'workflow_dispatch' && inputs\.visual_mode != 'compare'/,
  );
  assert.match(upload, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(
    upload,
    /name: f4\.1-visual-\$\{\{ inputs\.visual_mode \}\}-\$\{\{ github\.sha \}\}/,
  );
  for (const path of [
    'docs/references/F4.1-visual/review/*.png',
    'docs/references/F4.1-visual/baseline/*.png',
    'docs/references/F4.1-visual/index.json',
    'docs/references/F4.1-visual/approval.json',
    'docs/references/F4.1-visual/capture-manifest.json',
    '.cache/f4.1-visual/baseline-manifest.json',
    '.cache/f4.1-visual/start-epoch-ms.txt',
  ])
    assert.ok(upload.includes(path), `visual upload includes ${path}`);
  assert.match(upload, /retention-days: 14/);
  assert.doesNotMatch(upload, /--update-snapshots|rm\s+-rf/);
});

test('baselines are verified only after a manual update on the approved set', () => {
  const verify = stepBlock(
    composeJob,
    'Verify F4.1 approved Linux baseline manifest',
  );
  assert.match(
    verify,
    /if: success\(\) && github\.event_name == 'workflow_dispatch' && inputs\.visual_mode == 'update'/,
  );
  assert.match(
    verify,
    /scripts\/test\/write-visual-baseline-manifest\.mjs --set F4\.1-visual/,
  );
  assert.doesNotMatch(workflow, /f2\.1-visual-rework|F2\.1-visual/);
});
