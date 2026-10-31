import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HealthWriter,
  writeHealthSnapshot,
} from '../../src/infrastructure/telemetry/health-writer.js';
import {
  parseHealthSnapshot,
  ProgressHeartbeat,
  type HealthSnapshot,
} from '../../src/infrastructure/telemetry/health-snapshot.js';
import { checkHealthFile } from '../../src/bootstrap/health-check.js';
let directory: string;
let path: string;
const sample = (): HealthSnapshot => ({
  status: 'active',
  liveness: 'up',
  readiness: 'up',
  writtenAt: new Date().toISOString(),
  dependencies: { postgres: 'up' },
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lexon-writer-'));
  path = join(directory, 'status.json');
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});
it('atomically replaces complete snapshots without exposing partial healthy JSON', async () => {
  await writeHealthSnapshot(path, sample());
  const writing = Array.from({ length: 20 }, (_, i) =>
    writeHealthSnapshot(path, {
      ...sample(),
      status: i % 2 ? 'active' : 'standby',
    }),
  );

  await Promise.all([
    ...writing,
    ...Array.from({ length: 30 }, async () => {
      expect(
        parseHealthSnapshot(JSON.parse(await readFile(path, 'utf8'))).readiness,
      ).toBe('up');
    }),
  ]);
  expect(await readdir(directory)).toEqual(['status.json']);
});
it('rejects snapshot fields that could carry secrets', async () => {
  await expect(
    writeHealthSnapshot(path, {
      ...sample(),
      error: 'secret',
    } as HealthSnapshot),
  ).rejects.toThrow(/^Invalid health snapshot$/);
  expect(() =>
    parseHealthSnapshot({ ...sample(), dependencies: { hostname: 'up' } }),
  ).toThrow('Invalid health snapshot');
});
it('marks EACCES unhealthy, attempts invalidation, and recovers on a later write', async () => {
  let denied = true;
  const invalidate = vi.fn(async () => {
    await rm(path, { force: true });
  });
  const write = vi.fn(async (p: string, s: HealthSnapshot) => {
    if (denied)
      throw Object.assign(new Error('secret-host'), { code: 'EACCES' });
    await writeHealthSnapshot(p, s);
  });
  await writeHealthSnapshot(path, sample());
  const writer = new HealthWriter(
    { path, writeIntervalMs: 10, staleMs: 100 },
    async () => sample(),
    { write, invalidate },
  );
  await writer.cycle();
  expect(writer.health()).toBe('down');
  expect(invalidate).toHaveBeenCalledOnce();
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  denied = false;
  await writer.cycle();
  expect(writer.health()).toBe('up');
  await writer.stop();
  expect(writer.health()).toBe('down');
  expect(
    await checkHealthFile({
      path,
      mode: 'readiness',
      now: new Date(),
      staleMs: 100,
    }),
  ).toBe(1);
});
it('a failed invalidation leaves an old file which expires within the staleness bound', async () => {
  const old = sample();
  await writeHealthSnapshot(path, old);
  const fail = async () => {
    throw Object.assign(new Error('secret'), { code: 'EACCES' });
  };
  const writer = new HealthWriter(
    { path, writeIntervalMs: 10, staleMs: 100 },
    async () => sample(),
    { write: fail, invalidate: fail },
  );
  await writer.cycle();
  expect(writer.health()).toBe('down');
  expect(
    await checkHealthFile({
      path,
      mode: 'readiness',
      now: new Date(Date.parse(old.writtenAt) + 100),
      staleMs: 100,
    }),
  ).toBe(1);
});
it('does not overlap cycles or keep advancing a stalled work heartbeat', async () => {
  const heartbeat = new ProgressHeartbeat(100);
  heartbeat.beat();
  const first = sample();
  let resolve!: () => void;
  const blocked = new Promise<void>((done) => {
    resolve = done;
  });
  const sampleFn = vi.fn(async () => {
    await blocked;
    const live = heartbeat.isAlive(new Date(Date.parse(first.writtenAt) + 101));
    return {
      ...first,
      liveness: live ? ('up' as const) : ('down' as const),
      readiness: 'down' as const,
      status: 'unhealthy' as const,
    };
  });
  const writer = new HealthWriter(
    { path, writeIntervalMs: 10, staleMs: 100 },
    sampleFn,
  );
  await writeFile(path, JSON.stringify(first));
  const a = writer.cycle();
  const b = writer.cycle();
  expect(sampleFn).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(path, 'utf8')).writtenAt).toBe(
    first.writtenAt,
  );
  resolve();
  await Promise.all([a, b]);
  expect(JSON.parse(await readFile(path, 'utf8')).liveness).toBe('down');
  await writer.stop();
});

it('discards a write that completes after shutdown', async () => {
  let entered!: () => void;
  const writing = new Promise<void>((done) => {
    entered = done;
  });
  let release!: () => void;
  const finish = new Promise<void>((done) => {
    release = done;
  });
  const writer = new HealthWriter(
    { path, writeIntervalMs: 10, staleMs: 100 },
    async () => sample(),
    {
      write: async (p, s) => {
        entered();
        await finish;
        await writeHealthSnapshot(p, s);
      },
      invalidate: async (p) => {
        await rm(p, { force: true });
      },
    },
  );
  const cycle = writer.cycle();
  await writing;
  await writer.stop();
  release();
  await cycle;
  expect(writer.health()).toBe('down');
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reports snapshot write failure through an operational callback without error details', async () => {
  const report = vi.fn();
  const writer = new HealthWriter(
    { path, writeIntervalMs: 10, staleMs: 100 },
    async () => sample(),
    {
      write: async () => {
        throw new Error('secret-host');
      },
      invalidate: async () => undefined,
    },
    report,
  );
  await writer.cycle();
  expect(report).toHaveBeenCalledWith();
  expect(writer.health()).toBe('down');
});
