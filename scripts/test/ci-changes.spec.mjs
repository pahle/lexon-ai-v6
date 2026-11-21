import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyChanges } from '../ci-changes.mjs';

// CI skips its heavy jobs only for docs-only pull requests, and runs each
// mutation gate only when its guarded paths change. Pushes to main and manual
// runs always run everything.

const pr = (paths) => classifyChanges({ event: 'pull_request', paths });
const all = {
  docsOnly: false,
  mutationIdentity: true,
  mutationContracts: true,
  mutationIndicator: true,
};

test('a docs-only pull request skips the heavy jobs and every mutation gate', () => {
  assert.deepEqual(
    pr([
      'docs/superpowers/specs/2026-11-21-f4.3-platform-console-design.md',
      'docs/briefs/F4.3-platform-admin-console.md',
      'README.md',
      'backend/NOTES.md',
    ]),
    {
      docsOnly: true,
      mutationIdentity: false,
      mutationContracts: false,
      mutationIndicator: false,
    },
  );
});

test('any change outside docs runs everything that is not a mutation gate', () => {
  for (const path of [
    'backend/src/app.module.ts',
    'docs/references/F4.1-visual/index.json',
    '.github/workflows/real-evals.yml',
    'scripts/e2e.mjs',
    'docs/../backend/x.ts',
  ])
    assert.equal(pr(['docs/a.md', path]).docsOnly, false, path);
});

test('docs that CI reads as data are not docs-only', () => {
  for (const path of [
    'docs/references/F4.1-visual/approval.json',
    'docs/references/F4.1-visual/baseline/a-desktop-light.png',
    'docs/references/sources.json',
    'docs/design/f4.1-prototype/source/prototype.html',
    'docs/brand/lexon-2026-v4.1/tokens.css',
  ])
    assert.equal(pr([path]).docsOnly, false, path);
  // Markdown in those folders is prose and stays docs-only.
  assert.equal(pr(['docs/references/F4.2-acceptance.md']).docsOnly, true);
  assert.equal(pr(['docs/design/f4.1-prototype/README.md']).docsOnly, true);
});

test('an empty or unknown file list runs everything', () => {
  assert.deepEqual(pr([]), all);
  assert.deepEqual(classifyChanges({ event: 'pull_request' }), all);
});

test('push and manual runs always run everything', () => {
  for (const event of ['push', 'workflow_dispatch'])
    assert.deepEqual(classifyChanges({ event, paths: ['docs/a.md'] }), all);
});

test('each mutation gate runs when its guarded paths change', () => {
  assert.deepEqual(
    pr(['backend/src/modules/identity-access/identity-policy.ts']),
    {
      ...all,
      mutationContracts: false,
      mutationIndicator: false,
    },
  );
  assert.equal(
    pr(['backend/src/modules/organizations/invitation-policy.ts'])
      .mutationIdentity,
    true,
  );
  assert.equal(
    pr(['backend/test/unit/session-evidence.spec.ts']).mutationIdentity,
    true,
  );
  assert.equal(
    pr(['backend/stryker.identity.config.mjs']).mutationIdentity,
    true,
  );
  assert.equal(pr(['shared/src/job-title.ts']).mutationContracts, true);
  assert.equal(pr(['shared/test/job-title.spec.ts']).mutationContracts, true);
  assert.equal(
    pr(['frontend/src/components/chat/indicator/indicator-sequence.ts'])
      .mutationIndicator,
    true,
  );
  assert.equal(
    pr(['frontend/test/indicator-sequence.spec.tsx']).mutationIndicator,
    true,
  );
  // shared/ is imported by both other gates' code under test.
  assert.deepEqual(pr(['shared/src/identity.ts']), all);
});

test('unrelated code changes skip the mutation gates', () => {
  assert.deepEqual(pr(['backend/src/modules/chat/chat.service.ts']), {
    docsOnly: false,
    mutationIdentity: false,
    mutationContracts: false,
    mutationIndicator: false,
  });
});

test('dependency, toolchain, and workflow changes run every mutation gate', () => {
  for (const path of [
    'pnpm-lock.yaml',
    'package.json',
    'pnpm-workspace.yaml',
    'backend/package.json',
    'frontend/package.json',
    'shared/package.json',
    '.github/workflows/ci.yml',
    'scripts/ci-changes.mjs',
    'tsconfig.base.json',
  ])
    assert.deepEqual(pr([path]), all, path);
});
