import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { E2E_PROJECTS, resolveE2ESelection } from '../e2e-projects.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const loadProjectArgs = ['--project', 'chat-sse-load'];
const relevantPaths = [
  'backend/src/modules/chat/run-events.controller.ts',
  'backend/src/modules/chat/run-events.service.ts',
  'backend/src/modules/chat/run.service.ts',
  'backend/src/modules/chat/step-executor.ts',
  'backend/src/modules/chat/step-coordinator.ts',
  'backend/src/modules/chat/chat-profiles.ts',
  'backend/src/infrastructure/queue/stream-hub.ts',
  'backend/src/infrastructure/queue/sse-stream-reader.ts',
  'backend/src/infrastructure/queue/sse-connection-registry.ts',
  'backend/src/infrastructure/queue/run-streams.ts',
  'infra/Caddyfile',
  'backend/test/load/chat-sse.js',
  'backend/test/e2e/chat-sse-load.spec.ts',
  'backend/test/e2e/chat-load-api-main.mjs',
  'backend/test/e2e/chat-load-control.mjs',
  'backend/test/e2e/compose.chat-load.yml',
  'backend/test/e2e/compose.chat-runtime-proof.yml',
  'backend/test/e2e/chat-worker-main.mjs',
  'backend/test/e2e/auth-api-main.mjs',
  'backend/src/bootstrap/api.ts',
  'backend/src/entrypoints/api/root.module.ts',
  'backend/src/config/runtime-config.ts',
  'backend/src/config/ai-config.ts',
  'backend/src/config/chat-config.ts',
  'shared/src/chat.ts',
  'shared/src/ai-run.ts',
  'shared/src/index.ts',
  'docker-compose.yml',
  'backend/Dockerfile',
  'config/container-images.env',
  'package.json',
  'backend/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/compose-runner.mjs',
  'scripts/compose-environment.mjs',
  'scripts/container-images.mjs',
  'scripts/container-images.d.mts',
  'scripts/e2e-lifecycle.mjs',
  'scripts/e2e-projects.mjs',
  'scripts/e2e.mjs',
  'scripts/chat-load-paths.mjs',
  'scripts/chat-load-evidence.mjs',
  'scripts/test/chat-load-command.spec.mjs',
  'scripts/test/chat-load-project.spec.mjs',
  'scripts/test/chat-load-artifacts.spec.mjs',
  'scripts/test/chat-load-paths.spec.mjs',
  'scripts/test/chat-load-evidence.spec.mjs',
  'scripts/test/fixtures/chat-load-e2e-preload.mjs',
  'scripts/test/fixtures/chat-load-observations.mjs',
  'playwright.config.ts',
  '.github/workflows/chat-sse-load.yml',
];
const unrelatedPaths = [
  'docs/briefs/unrelated.md',
  'docs/references/another-feature.md',
  'frontend/src/components/chat/chat-composer.tsx',
  'frontend/src/app/workspace/page.tsx',
  'backend/src/modules/chat/chat-search.service.ts',
  'backend/src/infrastructure/db/chat-search.repository.ts',
  'backend/src/infrastructure/queue/README.md',
];

function selectedLoadProject(loadTrigger) {
  return resolveE2ESelection(loadProjectArgs, E2E_PROJECTS, {
    includeLoad: true,
    loadTrigger,
  }).selectedProjects;
}

async function readOptionalWorkflow(path) {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function parseQuotedPushPaths(workflow) {
  const lines = workflow.split(/\r?\n/u);
  const pushIndex = lines.findIndex((line) => line === '  push:');
  if (pushIndex < 0) return [];

  const pushLines = [];
  for (const line of lines.slice(pushIndex + 1)) {
    if (line.trim() && !line.startsWith('    ')) break;
    pushLines.push(line);
  }

  const pathsIndex = pushLines.findIndex((line) => line === '    paths:');
  if (pathsIndex < 0) return [];

  const paths = [];
  for (const line of pushLines.slice(pathsIndex + 1)) {
    if (line.trim() && !line.startsWith('      ')) break;
    const match = /^ {6}-\s+(['"])(.+)\1\s*$/u.exec(line);
    if (match?.[2]) paths.push(match[2]);
  }
  return paths;
}

function matchesAnyPath(path, patterns) {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

test('manual dispatch selects chat load regardless of changed paths', () => {
  assert.deepEqual(
    selectedLoadProject({ eventName: 'workflow_dispatch', changedPaths: [] }),
    ['chat-sse-load'],
  );
});

test('push selects chat load for each covered SSE, config, and bootstrap path', () => {
  for (const changedPath of relevantPaths) {
    assert.deepEqual(
      selectedLoadProject({ eventName: 'push', changedPaths: [changedPath] }),
      ['chat-sse-load'],
      `push path ${changedPath} did not select the load layer`,
    );
  }
});

test('unrelated, empty, and unsupported change events do not select chat load', () => {
  for (const changedPaths of [...unrelatedPaths.map((path) => [path]), []]) {
    assert.deepEqual(
      selectedLoadProject({ eventName: 'push', changedPaths }),
      [],
    );
  }

  assert.deepEqual(
    selectedLoadProject({
      eventName: 'pull_request',
      changedPaths: ['backend/src/modules/chat/run-events.service.ts'],
    }),
    [],
  );
  assert.deepEqual(selectedLoadProject(undefined), []);
});

test('direct explicit load opt-in without CI trigger context remains available', () => {
  assert.deepEqual(
    resolveE2ESelection(loadProjectArgs, E2E_PROJECTS, { includeLoad: true })
      .selectedProjects,
    ['chat-sse-load'],
  );
});

test('load workflow config requires manual dispatch and scoped push paths', async () => {
  const workflow = await readOptionalWorkflow(
    '.github/workflows/chat-sse-load.yml',
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:/);
  const pushPaths = parseQuotedPushPaths(workflow);
  assert.ok(pushPaths.length > 0, 'push trigger omitted quoted path filters');
  for (const changedPath of relevantPaths) {
    assert.ok(
      matchesAnyPath(changedPath, pushPaths),
      `load workflow path filters did not match ${changedPath}`,
    );
  }
  for (const changedPath of unrelatedPaths) {
    assert.ok(
      !matchesAnyPath(changedPath, pushPaths),
      `unrelated path ${changedPath} matched load workflow filters`,
    );
  }
  assert.doesNotMatch(workflow, /pull_request_target:|schedule:/);
});

test('load workflow always uploads only fresh per-run safe evidence', async () => {
  const workflow = await readOptionalWorkflow(
    '.github/workflows/chat-sse-load.yml',
  );

  const upload = workflow.slice(
    workflow.indexOf('      - name: Upload safe chat SSE load evidence'),
  );
  assert.match(upload, /if:\s*always\(\)/u);
  assert.match(
    upload,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u,
  );
  assert.match(upload, /test-results\/f4-chat-load\//u);
  assert.match(upload, /test-results\/f4-chat-load\/diagnostic\.json/u);
  assert.doesNotMatch(
    upload,
    /docs\/references\/F4-(?:sse-load|stream-latency)\.json/u,
  );
});

test('normal CI keeps pull-request, push, and Compose E2E coverage', async () => {
  const workflow = await readOptionalWorkflow('.github/workflows/ci.yml');

  assert.match(workflow, /\n {2}pull_request:/);
  assert.match(workflow, /\n {2}push:/);
  assert.match(workflow, /pnpm test:e2e/);
});
