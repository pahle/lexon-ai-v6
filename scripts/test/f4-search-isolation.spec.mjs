import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function listFiles(config, extraArgs = []) {
  return execFileSync(
    'pnpm',
    ['exec', 'vitest', 'list', '--filesOnly', '--config', config, ...extraArgs],
    { encoding: 'utf8' },
  );
}

test('the ordinary root and backend test selections exclude the search benchmark', () => {
  const rootFiles = listFiles('vitest.config.ts');
  const backendFiles = listFiles('vitest.config.ts', [
    '--project',
    'backend-unit',
    '--project',
    'backend-integration',
  ]);
  assert.doesNotMatch(rootFiles, /chat-search-performance\.spec\.ts/);
  assert.doesNotMatch(backendFiles, /chat-search-performance\.spec\.ts/);
  assert.match(rootFiles, /backend\/test\/integration\/chat-search\.spec\.ts/);
});

test('the dedicated selection discovers only the representative benchmark', () => {
  const files = listFiles('backend/vitest.chat-search-benchmark.config.ts');
  const discovered = files
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^\[[^\]]+\] /u, ''));
  assert.deepEqual(discovered, [
    'backend/test/integration/chat-search-performance.spec.ts',
  ]);
  const config = readFileSync(
    'backend/vitest.chat-search-benchmark.config.ts',
    'utf8',
  );
  assert.match(
    config,
    /globalSetup:\s*\[\s*'test\/setup\/search-benchmark-evidence\.ts',\s*'\.\.\/scripts\/test\/prepare-packages\.ts'/u,
  );
});

test('the isolated search workflow captures automatic triggers and failure evidence', () => {
  const workflow = readFileSync(
    '.github/workflows/f4-search-benchmark.yml',
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /push:/u);
  assert.match(workflow, /branches:\s*\n\s+- main/u);
  assert.match(workflow, /ubuntu-24\.04/u);
  assert.match(workflow, /chat-search\*\.spec\.ts/u);
  assert.match(workflow, /backend\/drizzle\/\*chat\*search\*\.sql/u);
  assert.match(workflow, /backend\/src\/infrastructure\/db\/testing\/\*\*/u);
  assert.match(workflow, /backend\/vitest\.chat-search-benchmark\.config\.ts/u);
  assert.match(workflow, /always\(\)/u);
  assert.match(workflow, /retention-days:\s*14/u);
  assert.match(workflow, /if-no-files-found:\s*error/u);
  assert.match(
    workflow,
    /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/u,
  );
  assert.match(
    workflow,
    /pnpm\/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1/u,
  );
  assert.match(
    workflow,
    /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/u,
  );
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u,
  );
  assert.doesNotMatch(workflow, /pnpm test(?:\s|$)/u);
});
