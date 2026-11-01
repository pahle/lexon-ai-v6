import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createRuntimeContext } from '../../src/bootstrap/context.js';
import { createApi } from '../../src/bootstrap/api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import { QueueConsumer } from '../../src/infrastructure/queue/index.js';
import { RuntimeLifecycle } from '../../src/bootstrap/runtime-lifecycle.js';
import { runtimeEnvironment } from '../setup/runtime-environment.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { dispatcherConnections } from '../../src/infrastructure/db/testing/dispatcher.js';

test('API and dispatcher register no processors; standby is ready and lock loss is unready', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-roots-'));
  const env = runtimeEnvironment(services, join(directory, 'a.json'));
  const proxy = await FaultProxy.start(services.appUrl);
  const api = await createApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, join(directory, 'a.json')),
    ),
  );
  const active = await createRuntimeContext(
    'dispatcher',
    loadRuntimeConfig('dispatcher', { ...env, DATABASE_APP_URL: proxy.url }),
  );
  const standby = await createRuntimeContext(
    'dispatcher',
    loadRuntimeConfig('dispatcher', {
      ...env,
      HEALTH_FILE: join(directory, 'b.json'),
    }),
  );
  try {
    for (const app of [api, active, standby])
      expect(() => app.get(QueueConsumer)).toThrow();
    expect('getHttpServer' in active).toBe(false);
    expect('getHttpServer' in standby).toBe(false);
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(directory, 'b.json'), 'utf8')).status,
      )
      .toBe('standby');
    expect(
      JSON.parse(await readFile(join(directory, 'b.json'), 'utf8')).readiness,
    ).toBe('up');
    const lifecycle = active.get(RuntimeLifecycle);
    proxy.disconnect();
    await expect
      .poll(async () => (await lifecycle.snapshot()).readiness)
      .toBe('down');
    expect((await lifecycle.snapshot()).readiness).toBe('down');
  } finally {
    await api.close();
    await active.close();
    await standby.close();
    await proxy.close();
    await rm(directory, { recursive: true, force: true });
    expect(await dispatcherConnections(services)).toBe(0);
  }
});
test('document-worker boot imports no AI and opens no TCP listener', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-imports-'));
  const config = loadRuntimeConfig(
    'document-worker',
    runtimeEnvironment(services, join(directory, 'health.json')),
  );
  const child = fork(
    new URL('../../.test-build/test/process/runtime-trace.js', import.meta.url),
    [],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] },
  );
  try {
    const result = new Promise<{ loaded: string[]; listeners: number }>(
      (resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code) reject(new Error('Runtime import proof failed'));
        });
      },
    );
    child.send(config);
    const value = await result;
    expect(value.listeners).toBe(0);
    expect(
      value.loaded.some((path) => path.includes('/queue/auth-limiter.js')),
    ).toBe(false);
    expect(
      value.loaded.some((path) => path.includes('/infrastructure/ai/')),
    ).toBe(false);
    expect(
      value.loaded.some((path) =>
        path.includes('/entrypoints/document-worker/root.module.js'),
      ),
    ).toBe(true);
    expect(
      value.loaded.some((path) =>
        path.includes('/entrypoints/ai-worker/root.module.js'),
      ),
    ).toBe(false);
  } finally {
    if (child.exitCode === null) {
      const exit = new Promise<void>((resolve) =>
        child.once('exit', () => resolve()),
      );
      child.kill('SIGKILL');
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
test('AI worker boots without storage or provider secrets and closes its processor', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-ai-root-'));
  const env = runtimeEnvironment(services, join(directory, 'health.json'));
  for (const key of Object.keys(env))
    if (key.startsWith('S3_')) delete env[key];
  const app = await createRuntimeContext(
    'ai-worker',
    loadRuntimeConfig('ai-worker', env),
  );
  try {
    expect(app.get(QueueConsumer)).toBeInstanceOf(QueueConsumer);
    expect('getHttpServer' in app).toBe(false);
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(directory, 'health.json'), 'utf8'))
            .readiness,
      )
      .toBe('up');
  } finally {
    await app.close();
    await expect(
      readFile(join(directory, 'health.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(directory, { recursive: true, force: true });
  }
});
test('every worker and standalone evaluation boot without Better Auth or SMTP SDK loading', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-auth-imports-'));
  try {
    for (const runtime of [
      'ai-worker',
      'document-worker',
      'dispatcher',
      'evaluation',
    ] as const) {
      const child = fork(
        new URL(
          '../../.test-build/test/process/runtime-trace.js',
          import.meta.url,
        ),
        [],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] },
      );
      let diagnostic = '';
      child.stderr?.on('data', (chunk) => {
        if (diagnostic.length < 8192) diagnostic += String(chunk);
      });
      try {
        const result = new Promise<{ loaded: string[]; listeners: number }>(
          (resolve, reject) => {
            child.once('message', resolve);
            child.once('error', reject);
            child.once('exit', (code) => {
              if (code)
                reject(
                  new Error(
                    'Runtime import proof failed: ' +
                      runtime +
                      ' ' +
                      (/\bERR_[A-Z_]+\b/.exec(diagnostic)?.[0] ??
                        'runtime_boot_failed'),
                  ),
                );
            });
          },
        );
        child.send(
          runtime === 'evaluation'
            ? 'evaluation'
            : loadRuntimeConfig(
                runtime,
                runtimeEnvironment(
                  services,
                  join(directory, runtime + '.json'),
                ),
              ),
        );
        const value = await result;
        expect(value.loaded.length > 20).toBe(true);
        expect(value.listeners).toBe(0);
        expect(
          value.loaded.some((path) => /better-auth|nodemailer/.test(path)),
        ).toBe(false);
      } finally {
        if (child.exitCode === null) {
          const exit = new Promise<void>((resolve) =>
            child.once('exit', () => resolve()),
          );
          child.kill('SIGKILL');
          await exit;
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
