import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withOwnedStack } from '../e2e-lifecycle.mjs';
test('failed startup always tears down only the owned project and removes private temp data', async () => {
  const calls = [];
  await assert.rejects(
    withOwnedStack({
      project: 'lexon-e2e-abc123',
      directory: '/test-owned',
      start: async () => {
        calls.push('start');
        throw new Error('startup failed');
      },
      exercise: async () => calls.push('test'),
      down: async (project) => calls.push(project),
      remove: async (path) => calls.push(path),
    }),
    /startup failed/,
  );
  assert.deepEqual(calls, ['start', 'lexon-e2e-abc123', '/test-owned']);
});
test('abort propagates to startup, then tears down without exercising tests', async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(
    withOwnedStack({
      project: 'lexon-e2e-abc123',
      directory: '/test-owned',
      signal: controller.signal,
      start: async (signal) => {
        controller.abort();
        assert.equal(signal.aborted, true);
      },
      exercise: async () => calls.push('test'),
      down: async (project) => calls.push(project),
      remove: async (path) => calls.push(path),
    }),
    /interrupted/,
  );
  assert.deepEqual(calls, ['lexon-e2e-abc123', '/test-owned']);
});
test('cleanup failure still removes secret files and never accepts another project namespace', async () => {
  const calls = [];
  await assert.rejects(
    withOwnedStack({
      project: 'lexon-e2e-abc123',
      directory: '/test-owned',
      start: async () => undefined,
      exercise: async () => undefined,
      down: async () => {
        throw new Error('cleanup failed');
      },
      remove: async (path) => calls.push(path),
    }),
    /cleanup failed/,
  );
  assert.deepEqual(calls, ['/test-owned']);
  await assert.rejects(
    withOwnedStack({ project: 'unrelated', directory: '/test-owned' }),
    /Invalid E2E project/,
  );
});
test('test and exercise-abort failures remove real private operator configuration', async () => {
  const { mkdtemp, writeFile, stat, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  for (const abort of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'lexon-cleanup-'));
    const path = join(directory, 'operator-environment.json');
    await writeFile(path, 'private-fixture', { mode: 0o600 });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const controller = new AbortController();
    let down = false;
    await assert.rejects(
      withOwnedStack({
        project: 'lexon-e2e-abc123',
        directory,
        signal: controller.signal,
        start: async () => {},
        exercise: async () => {
          if (abort) controller.abort();
          throw new Error('exercise failed');
        },
        down: async () => {
          down = true;
        },
        remove: (directory) => rm(directory, { recursive: true, force: true }),
      }),
    );
    assert.equal(down, true);
    await assert.rejects(stat(path), { code: 'ENOENT' });
  }
});
