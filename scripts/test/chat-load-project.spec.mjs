import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readConfigScript = `
  import config from './playwright.config.ts';
  const normalize = (value) => {
    if (value instanceof RegExp)
      return { regexp: value.source, flags: value.flags };
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, normalize(nested)]),
      );
    return value;
  };
  process.stdout.write(JSON.stringify(normalize(config)));
`;

function readPlaywrightConfig(chatLoadFlag) {
  const env = { CI: 'true' };
  if (chatLoadFlag !== undefined) env.LEXON_CHAT_LOAD = chatLoadFlag;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', readConfigScript],
    { cwd: root, encoding: 'utf8', env },
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function withoutChatLoad(projects) {
  return projects.filter((project) => project.name !== 'chat-sse-load');
}

test('chat SSE load project is absent without the flag or with flag zero', () => {
  const normal = readPlaywrightConfig(undefined);
  const zero = readPlaywrightConfig('0');

  assert.ok(
    !normal.projects.some((project) => project.name === 'chat-sse-load'),
  );
  assert.ok(!zero.projects.some((project) => project.name === 'chat-sse-load'));
  assert.deepEqual(zero.projects, normal.projects);
});

test('chat SSE load project is registered only with the opt-in flag', () => {
  const normal = readPlaywrightConfig(undefined);
  const enabled = readPlaywrightConfig('1');
  const loadProjects = enabled.projects.filter(
    (project) => project.name === 'chat-sse-load',
  );

  assert.equal(loadProjects.length, 1);
  assert.equal(loadProjects[0].timeout, 180_000);
  assert.equal(
    loadProjects[0].testMatch,
    'backend/test/e2e/chat-sse-load.spec.ts',
  );
  assert.deepEqual(loadProjects[0].use, {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  });
  assert.deepEqual(withoutChatLoad(enabled.projects), normal.projects);
});

test('load opt-in preserves global timeouts, retries, workers, and defaults', () => {
  const normal = readPlaywrightConfig(undefined);
  const zero = readPlaywrightConfig('0');
  const enabled = readPlaywrightConfig('1');
  const settings = ({
    testDir,
    timeout,
    expect,
    snapshotPathTemplate,
    workers,
    forbidOnly,
    retries,
    reporter,
    use,
  }) => ({
    testDir,
    timeout,
    expect,
    snapshotPathTemplate,
    workers,
    forbidOnly,
    retries,
    reporter,
    use,
  });

  assert.equal(normal.timeout, 45_000);
  assert.equal(normal.expect.timeout, 10_000);
  assert.equal(normal.retries, 0);
  assert.equal(normal.workers, 1);
  assert.deepEqual(settings(zero), settings(normal));
  assert.deepEqual(settings(enabled), settings(normal));
  assert.deepEqual(withoutChatLoad(enabled.projects), normal.projects);
});
