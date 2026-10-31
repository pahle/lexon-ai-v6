import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import {
  HealthResponseSchema,
  ErrorResponseSchema,
  DiagnosticResponseSchema,
} from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createApi } from '../../src/bootstrap/api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';

test('serves native shared-schema validation and sanitized errors with correlated request IDs', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-api-'));
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown,
    ...args: unknown[]
  ) => {
    const value = String(chunk);
    if (value.startsWith('{')) {
      lines.push(value);
      const callback = args.find((x) => typeof x === 'function') as
        (() => void) | undefined;
      callback?.();
      return true;
    }
    return original(chunk as string);
  }) as typeof process.stdout.write);
  const app = await createApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, join(directory, 'health.json')),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const healthy = await fetch(origin + '/api/health');
    expect(healthy.status).toBe(200);
    expect(HealthResponseSchema.parse(await healthy.json()).status).toBe('ok');
    const id = randomUUID();
    const response = await fetch(origin + '/api/diagnostics/validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': id },
      body: JSON.stringify({ probeId: id }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(id);
    expect(DiagnosticResponseSchema.parse(await response.json())).toEqual({
      probeId: id,
      accepted: true,
    });
    for (const body of [
      JSON.stringify({ probeId: 'secret-invalid' }),
      JSON.stringify({ probeId: id, 'secret-property': 'secret-value' }),
      '{secret-malformed',
    ]) {
      const response = await fetch(origin + '/api/diagnostics/validation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': id },
        body,
      });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain('secret');
      const parsed = ErrorResponseSchema.parse(JSON.parse(text));
      expect(parsed.requestId).toBe(id);
      expect(parsed.error.code).toBe(
        body.startsWith('{secret') ? 'INVALID_JSON' : 'VALIDATION_ERROR',
      );
    }
    await expect.poll(() => lines.join('')).toContain(id);
    expect(lines.join('')).not.toContain('secret');
  } finally {
    await app.close();
    spy.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
test('readiness fails safely during a dependency outage while HTTP liveness stays up', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-api-down-'));
  const proxy = await FaultProxy.start(services.valkey.queueUrl);
  const env = createAuthEnvironment(services, join(directory, 'health.json'));
  const app = await createApi(
    loadRuntimeConfig('api', {
      ...env,
      VALKEY_QUEUE_URL: proxy.url,
      DEPENDENCY_TIMEOUT_MS: '100',
    }),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    expect((await fetch(origin + '/api/health')).status).toBe(200);
    proxy.disconnect();
    const down = await fetch(origin + '/api/health');
    expect(down.status).toBe(503);
    const value = HealthResponseSchema.parse(await down.json());
    expect(value.status).toBe('unavailable');
    expect(value.dependencies.queue).toBe('down');
    expect((await fetch(origin + '/api/health/live')).status).toBe(200);
  } finally {
    await app.close();
    await proxy.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('API startup failure closes resources and exits with sanitized logs', async ({
  services,
}) => {
  const { createServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const server = createServer();
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture listener unavailable');
  const directory = await mkdtemp(join(tmpdir(), 'lexon-bind-failure-'));
  const child = spawn(
    process.execPath,
    [new URL('../../dist/entrypoints/api/main.js', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        ...createAuthEnvironment(services, join(directory, 'health.json')),
        PORT: String(address.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += String(data);
  });
  child.stderr.on('data', (data) => {
    output += String(data);
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try {
    expect(await exited).toEqual({ code: 1, signal: null });
    expect(output).toContain('boot_failed');
    expect(output).not.toContain(services.appUrl);
    expect(output).not.toContain(services.s3.credentials.secretAccessKey);
  } finally {
    clearTimeout(timer);
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
