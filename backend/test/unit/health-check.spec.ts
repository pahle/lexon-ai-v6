import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  checkHealthFile,
  runHealthCheckCommand,
} from '../../src/bootstrap/health-check.js';
const now = new Date('2026-10-31T00:00:00.000Z');
let directory: string;
let path: string;
const snapshot = () => ({
  status: 'active',
  liveness: 'up',
  readiness: 'up',
  writtenAt: now.toISOString(),
  dependencies: { postgres: 'up', queue: 'up', streams: 'up', limiter: 'up' },
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lexon-health-'));
  path = join(directory, 'status.json');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('rejects a missing health file', async () => {
  const missingPath = path;
  expect(
    await checkHealthFile({
      path: missingPath,
      mode: 'readiness',
      now,
      staleMs: 20000,
    }),
  ).toBe(1);
});
it.each(['liveness', 'readiness'] as const)(
  'accepts fresh healthy %s and healthy standby',
  async (mode) => {
    for (const status of ['active', 'standby']) {
      await writeFile(path, JSON.stringify({ ...snapshot(), status }));
      expect(await checkHealthFile({ path, mode, now, staleMs: 20000 })).toBe(
        0,
      );
    }
  },
);
it.each([-20001, -20000, 1001])(
  'rejects stale or future timestamp offset %i',
  async (offset) => {
    await writeFile(
      path,
      JSON.stringify({
        ...snapshot(),
        writtenAt: new Date(now.getTime() + offset).toISOString(),
      }),
    );
    expect(
      await checkHealthFile({ path, mode: 'readiness', now, staleMs: 20000 }),
    ).toBe(1);
  },
);
it('rejects unhealthy and partial/malformed/unexpected fields without leaking their content', async () => {
  for (const data of [
    '{',
    JSON.stringify({ status: 'active' }),
    JSON.stringify({
      ...snapshot(),
      status: 'unhealthy',
      liveness: 'down',
      readiness: 'down',
    }),
    JSON.stringify({ ...snapshot(), host: 'secret-host' }),
    JSON.stringify({ ...snapshot(), dependencies: { 'secret-host': 'up' } }),
  ]) {
    await writeFile(path, data);
    expect(
      await checkHealthFile({ path, mode: 'readiness', now, staleMs: 20000 }),
    ).toBe(1);
  }
});
it('keeps liveness independent from dependency readiness', async () => {
  await writeFile(
    path,
    JSON.stringify({
      ...snapshot(),
      readiness: 'down',
      dependencies: { postgres: 'down' },
    }),
  );
  expect(
    await checkHealthFile({ path, mode: 'liveness', now, staleMs: 20000 }),
  ).toBe(0);
  expect(
    await checkHealthFile({ path, mode: 'readiness', now, staleMs: 20000 }),
  ).toBe(1);
});
it('the checker command validates only its small environment subset', async () => {
  expect(
    await runHealthCheckCommand(['--mode', 'liveness'], {
      HEALTH_FILE: path,
      HEALTH_STALE_MS: '-1',
      DATABASE_APP_URL: 'secret',
    }),
  ).toBe(1);
  expect(await runHealthCheckCommand(['--mode', 'unknown'], {})).toBe(1);
  expect(
    await runHealthCheckCommand(['--mode', 'readiness'], {
      HEALTH_FILE: 'relative',
    }),
  ).toBe(1);
  await writeFile(
    path,
    JSON.stringify({ ...snapshot(), writtenAt: new Date().toISOString() }),
  );
  expect(
    await runHealthCheckCommand(['--mode', 'readiness'], {
      HEALTH_FILE: path,
      HEALTH_STALE_MS: '20000',
    }),
  ).toBe(0);
});
