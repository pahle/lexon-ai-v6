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
    /globalSetup:\s*\[\s*'test\/setup\/search-benchmark-global-setup\.ts'\s*\]/u,
  );
  const setup = readFileSync(
    'backend/test/setup/search-benchmark-global-setup.ts',
    'utf8',
  );
  const initializeEvidence = setup.indexOf('initializeSearchEvidence();');
  const preparePackages = setup.indexOf('await preparePackages();');
  const loadInfrastructure = setup.indexOf("'./global-infrastructure.js'");
  assert.ok(initializeEvidence >= 0);
  assert.ok(preparePackages > initializeEvidence);
  assert.ok(loadInfrastructure > preparePackages);
});

test('the measured p95 uses 500 ms warning and strict 1000 ms blocking limits', () => {
  const benchmark = readFileSync(
    'backend/test/integration/chat-search-performance.spec.ts',
    'utf8',
  );
  const evidence = readFileSync(
    'backend/src/infrastructure/db/testing/chat-search-evidence.ts',
    'utf8',
  );
  assert.match(
    evidence,
    /warningP95Ms:\s*500[\s\S]{0,80}blockingP95Ms:\s*1000/u,
  );
  assert.match(benchmark, /SEARCH_GATE_POLICY/u);
  assert.match(
    benchmark,
    /summary\.blockingStatus[\s\S]{0,80}\.toBe\('pass'\)/u,
  );
  assert.match(benchmark, /formatSearchGateMarkdown/u);
  assert.match(benchmark, /GITHUB_STEP_SUMMARY/u);
});

test('the isolated search workflow captures automatic triggers and failure evidence', () => {
  const workflow = readFileSync(
    '.github/workflows/f4-search-benchmark.yml',
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /push:/u);
  assert.doesNotMatch(workflow, /pull_request:/u);
  const pushTrigger = workflow.match(
    /push:\s*\n([\s\S]*?)\npermissions:/u,
  )?.[1];
  assert.ok(pushTrigger);
  assert.match(pushTrigger, /branches:\s*\n\s+- '\*\*'/u);
  assert.doesNotMatch(pushTrigger, /tags:/u);
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

test('push and manual evidence checks out and names artifacts by github.sha', () => {
  const workflow = readFileSync(
    '.github/workflows/f4-search-benchmark.yml',
    'utf8',
  );
  assert.match(workflow, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/u);
  assert.match(
    workflow,
    /name: f4-search-benchmark-\$\{\{\s*github\.sha\s*\}\}/u,
  );
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head\.sha/u);
});

test('evidence initializes immediately after checkout and before tool setup', () => {
  const workflow = readFileSync(
    '.github/workflows/f4-search-benchmark.yml',
    'utf8',
  );
  const checkoutIndex = workflow.indexOf(
    'uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
  );
  const initializeIndex = workflow.indexOf(
    'run: node scripts/test/prepare-f4-search-evidence.mjs',
  );
  const pnpmSetupIndex = workflow.indexOf(
    'uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
  );
  const nodeSetupIndex = workflow.indexOf(
    'uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
  );
  assert.ok(checkoutIndex < initializeIndex);
  assert.ok(initializeIndex < pnpmSetupIndex);
  assert.ok(initializeIndex < nodeSetupIndex);
});

test('search route and contract files share the all-branch push path filter', () => {
  const workflow = readFileSync(
    '.github/workflows/f4-search-benchmark.yml',
    'utf8',
  );
  assert.equal(workflow.split('paths:').length - 1, 1);
  for (const path of [
    'backend/src/modules/chat/chat.controller.ts',
    'shared/src/chat.ts',
    'shared/src/index.ts',
  ])
    assert.equal(workflow.split(`- '${path}'`).length - 1, 1);
});
