import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  composeFilesForE2EProjects,
  E2E_PROJECTS,
  resolveE2ESelection,
} from '../e2e-projects.mjs';

test('default E2E selection includes the chat proof and its test overlay', () => {
  const selection = resolveE2ESelection([]);

  assert.ok(selection.selectedProjects.includes('chat-runtime-proof'));
  assert.ok(selection.selectedProjects.includes('chat-browser'));
  assert.deepEqual(selection.args, []);
});

test('explicit proof project selectors include both CLI spellings', () => {
  for (const args of [
    ['--project', 'chat-runtime-proof'],
    ['--project=chat-runtime-proof'],
  ]) {
    const selection = resolveE2ESelection(args);
    assert.deepEqual(selection.selectedProjects, ['chat-runtime-proof']);
  }
});

test('chat browser selects its Compose overlay and browser test project', () => {
  const selection = resolveE2ESelection(['--project', 'chat-browser']);
  assert.deepEqual(selection.selectedProjects, ['chat-browser']);
  assert.ok(
    composeFilesForE2EProjects(
      selection.selectedProjects,
      '/repository/',
    ).includes('/repository/backend/test/e2e/compose.chat-runtime-proof.yml'),
  );
});

test('explicit project lists retain every selected project', () => {
  const selection = resolveE2ESelection([
    '--project',
    'chat-runtime-proof',
    'identity-api',
  ]);

  assert.deepEqual(selection.selectedProjects, [
    'identity-api',
    'chat-runtime-proof',
  ]);
});

test('package filters resolve their mapped projects before choosing overlays', () => {
  const frontend = resolveE2ESelection(['--package', 'frontend']);
  assert.deepEqual(frontend.selectedProjects, E2E_PROJECTS.frontend);
  assert.ok(frontend.selectedProjects.includes('chat-runtime-proof'));
  assert.ok(frontend.selectedProjects.includes('chat-browser'));
  assert.deepEqual(
    frontend.args.filter((argument) => argument === '--project').length,
    E2E_PROJECTS.frontend.length,
  );

  const backend = resolveE2ESelection(['--package=backend']);
  assert.deepEqual(backend.selectedProjects, E2E_PROJECTS.backend);
  assert.ok(!backend.selectedProjects.includes('chat-runtime-proof'));
});

test('a different explicit project does not select the chat proof overlay', () => {
  const selection = resolveE2ESelection(['--project', 'identity-api']);

  assert.deepEqual(selection.selectedProjects, ['identity-api']);
  assert.ok(!selection.selectedProjects.includes('chat-runtime-proof'));
});

test('project selectors preserve Playwright wildcard matching', () => {
  const selection = resolveE2ESelection(['--project=identity-*']);

  assert.deepEqual(selection.selectedProjects, [
    'identity-api',
    'identity-browser',
  ]);
});

test('case-insensitive exact and mixed wildcard selectors match installed Playwright', () => {
  const cli = fileURLToPath(
    new URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
  );
  for (const selectors of [
    ['--project=CHAT-RUNTIME-PROOF'],
    ['--project=CHAT-*', '--project', 'IDENTITY-API'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [cli, 'test', '--list', ...selectors],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const actualProjects = new Set(
      [...result.stdout.matchAll(/^\s+\[([^\]]+)\]/gm)].map(
        (match) => match[1],
      ),
    );
    const resolvedProjects = new Set(
      resolveE2ESelection(selectors).selectedProjects,
    );
    assert.deepEqual([...resolvedProjects].sort(), [...actualProjects].sort());
    const composeFiles = composeFilesForE2EProjects(
      [...resolvedProjects],
      '/repository/',
    );
    assert.equal(
      composeFiles.includes(
        '/repository/backend/test/e2e/compose.chat-runtime-proof.yml',
      ),
      actualProjects.has('chat-runtime-proof'),
    );
  }
});

test('chat-runtime-proof discovers the Compose worker crash recovery test', () => {
  const cli = fileURLToPath(
    new URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [cli, 'test', '--list', '--project', 'chat-runtime-proof'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('chat-recovery.spec.ts'),
    'chat-runtime-proof omitted chat-recovery.spec.ts from test discovery',
  );
  assert.ok(
    result.stdout.includes(
      'recovers a held answer after SIGKILL and restart of ai-worker',
    ),
    'chat-runtime-proof omitted the SIGKILL recovery scenario',
  );
});

test('chat-browser discovers the dedicated chat accessibility suite', () => {
  const cli = fileURLToPath(
    new URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [cli, 'test', '--list', '--project', 'chat-browser'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('chat-accessibility.spec.ts'),
    'chat-browser omitted chat-accessibility.spec.ts from test discovery',
  );
});
