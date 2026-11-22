import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  composeFilesForE2EProjects,
  E2E_PROJECTS,
  resolveE2ESelection,
} from '../e2e-projects.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

function readPlaywrightConfig() {
  const script = `
    import config from './playwright.config.ts';
    process.stdout.write(JSON.stringify(config));
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { cwd: repositoryRoot, encoding: 'utf8', env: { CI: 'true' } },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

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

test('brand visual selects the runtime proof overlay and the F4.1 snapshot path', () => {
  assert.ok(E2E_PROJECTS.frontend.includes('brand-visual'));
  const selection = resolveE2ESelection(['--project', 'brand-visual']);
  assert.deepEqual(selection.selectedProjects, ['brand-visual']);
  assert.ok(
    composeFilesForE2EProjects(
      selection.selectedProjects,
      '/repository/',
    ).includes('/repository/backend/test/e2e/compose.chat-runtime-proof.yml'),
  );

  const config = readPlaywrightConfig();
  const project = config.projects.find(
    (entry) => entry.name === 'brand-visual',
  );
  assert.ok(project, 'brand-visual is missing from Playwright projects');
  assert.deepEqual(project.testMatch, [
    'backend/test/e2e/brand-visual-auth.spec.ts',
    'backend/test/e2e/brand-visual-shell.spec.ts',
    'backend/test/e2e/brand-visual-chat.spec.ts',
    'backend/test/e2e/brand-visual-chats-settings.spec.ts',
    'backend/test/e2e/brand-visual-platform.spec.ts',
    'backend/test/e2e/brand-visual-platform-accounts.spec.ts',
    'backend/test/e2e/visual-comparison-regression.spec.ts',
  ]);
  assert.equal(
    project.snapshotPathTemplate,
    '{testDir}/docs/references/F4.1-visual/{arg}{ext}',
  );
  assert.deepEqual(project.use, {
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    reducedMotion: 'reduce',
  });
});

test('the retired F2.1 and F4 visual projects are gone', () => {
  const config = readPlaywrightConfig();
  for (const name of ['chat-visual', 'visual-review']) {
    assert.ok(
      !Object.values(E2E_PROJECTS).flat().includes(name),
      `${name} is still selectable`,
    );
    assert.ok(
      !config.projects.some((entry) => entry.name === name),
      `${name} is still a Playwright project`,
    );
  }
  assert.equal(
    config.snapshotPathTemplate,
    '{testDir}/docs/references/F4.1-visual/{arg}{ext}',
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

test('chat SSE load selection is explicit opt-in in both CLI spellings', () => {
  for (const args of [
    ['--project', 'chat-sse-load'],
    ['--project=chat-sse-load'],
  ]) {
    const selection = resolveE2ESelection(args, E2E_PROJECTS, {
      includeLoad: true,
    });
    assert.deepEqual(selection.selectedProjects, ['chat-sse-load']);
  }
});

test('chat SSE load stays outside default, package, and non-opt-in selection', () => {
  const defaultSelection = resolveE2ESelection([]);
  assert.deepEqual(defaultSelection.args, []);
  assert.ok(!defaultSelection.selectedProjects.includes('chat-sse-load'));

  const frontend = resolveE2ESelection(['--package', 'frontend']);
  assert.ok(!frontend.selectedProjects.includes('chat-sse-load'));

  for (const args of [
    ['--project', 'chat-sse-load'],
    ['--project=chat-sse-load'],
  ]) {
    const selection = resolveE2ESelection(args);
    assert.ok(!selection.selectedProjects.includes('chat-sse-load'));
  }
});

test('chat SSE load selects both chat runtime and load Compose overlays', () => {
  const composeFiles = composeFilesForE2EProjects(
    ['chat-sse-load'],
    '/repository/',
  );

  assert.ok(
    composeFiles.includes(
      '/repository/backend/test/e2e/compose.chat-runtime-proof.yml',
    ),
  );
  assert.ok(
    composeFiles.includes('/repository/backend/test/e2e/compose.chat-load.yml'),
  );
});

// CI runs three shards. Playwright splits shards by test count, which put all
// brand-visual files (few tests, long) in shard 3. `--shard=N/3` therefore
// resolves to an explicit, time-balanced plan of projects and files. The
// plan must cover every default test exactly once.
function listTests(args) {
  const result = spawnSync(
    process.execPath,
    [
      `${repositoryRoot}node_modules/@playwright/test/cli.js`,
      'test',
      '--list',
      '--reporter=json',
      ...args,
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', LEXON_CHAT_LOAD: '0' },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const ids = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const item of spec.tests)
        ids.push(`${item.projectName} ${spec.file} ${spec.title} ${spec.line}`);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return ids;
}

test('the three-shard plan replaces Playwright count sharding', () => {
  for (const shard of [1, 2, 3]) {
    const selection = resolveE2ESelection([
      `--shard=${shard}/3`,
      '--reporter=blob',
    ]);
    assert.ok(!selection.args.some((arg) => arg.startsWith('--shard')));
    assert.ok(selection.args.includes('--reporter=blob'));
    assert.ok(selection.args.some((arg) => arg.startsWith('--project=')));
    assert.ok(selection.selectedProjects.length > 0);
    assert.ok(
      selection.selectedProjects.includes('brand-visual'),
      'every shard carries part of the brand-visual set',
    );
  }
});

test('other shard counts and explicit selections keep Playwright sharding', () => {
  assert.deepEqual(resolveE2ESelection(['--shard=1/4']).args, ['--shard=1/4']);
  assert.ok(
    resolveE2ESelection(['--project', 'topology', '--shard=1/3']).args.includes(
      '--shard=1/3',
    ),
  );
  assert.ok(
    resolveE2ESelection(['--package', 'backend', '--shard=1/3']).args.includes(
      '--shard=1/3',
    ),
  );
});

test('the shard plan covers every default test exactly once', () => {
  const all = listTests([]);
  assert.ok(all.length > 0);
  const shards = [1, 2, 3].map((shard) =>
    listTests(
      resolveE2ESelection([`--shard=${shard}/3`]).args.filter(
        (arg) => arg !== '--reporter=blob',
      ),
    ),
  );
  const union = shards.flat();
  assert.equal(new Set(union).size, union.length, 'no test runs twice');
  assert.deepEqual(union.toSorted(), all.toSorted(), 'no test is left out');
  for (const shard of shards) assert.ok(shard.length > 0);
});
