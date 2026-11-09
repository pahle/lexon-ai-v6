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
    'VALKEYCLI_AUTH="$VALKEY_PASSWORD" valkey-cli --raw CONFIG GET maxmemory-policy appendonly appendfsync maxmemory',
  ]);
  // CONFIG GET returns name/value pairs in an unspecified order.
  const lines = result.split('\n');
  expect(lines).toHaveLength(8);
  const settings = Object.fromEntries(
    Array.from({ length: lines.length / 2 }, (_, index) => [
      lines[index * 2],
      lines[index * 2 + 1],
    ]),
  );
  expect(settings).toEqual({
    'maxmemory-policy': 'noeviction',
    appendonly: 'yes',
    appendfsync: 'everysec',
    maxmemory: '805306368',
  });
});
test('isolated wrong eviction/AOF/fsync configurations reject startup and correct policy recovers', async () => {
  test.setTimeout(180000);
  const result = await promisify(execFile)(
    process.execPath,
    ['scripts/policy-smoke.mjs', descriptor().project],
    { timeout: 170000, maxBuffer: 1024 * 1024 },
  );
  for (const timing of result.stderr.matchAll(
    /API policy rejection observation ms: (\d+)/g,
  ))
    console.info('Policy rejection observed after ms:', Number(timing[1]));
  expect(result.stdout.trim()).toBe(
    'Valkey startup rejection and recovery passed',
  );
});
