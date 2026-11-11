import assert from 'node:assert/strict';
import { test } from 'node:test';
import { E2E_PROJECTS, resolveE2ESelection } from '../e2e-projects.mjs';

test('default E2E selection includes the chat proof and its test overlay', () => {
  const selection = resolveE2ESelection([]);

  assert.ok(selection.selectedProjects.includes('chat-runtime-proof'));
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
