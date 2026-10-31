import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { descriptor, docker, containerId } from './runtime-support.js';
test('normal startup has noeviction and AOF everysec', async () => {
  const result = await docker([
    'exec',
    await containerId('valkey'),
    'sh',
    '-c',
    'VALKEYCLI_AUTH="$VALKEY_PASSWORD" valkey-cli --raw CONFIG GET maxmemory-policy appendonly appendfsync',
  ]);
  expect(result.split('\n')).toEqual([
    'appendfsync',
    'everysec',
    'appendonly',
    'yes',
    'maxmemory-policy',
    'noeviction',
  ]);
});
test('isolated wrong eviction/AOF/fsync configurations reject startup and correct policy recovers', async () => {
  test.setTimeout(180000);
  const result = await promisify(execFile)(
    process.execPath,
    ['scripts/policy-smoke.mjs', descriptor().project],
    { timeout: 170000, maxBuffer: 1024 * 1024 },
  );
  expect(result.stdout.trim()).toBe(
    'Valkey startup rejection and recovery passed',
  );
});
