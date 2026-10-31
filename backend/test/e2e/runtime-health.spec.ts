import { test, expect } from '@playwright/test';
import { HealthResponseSchema } from '@lexon/contracts';
import { descriptor, docker, containerId } from './runtime-support.js';
test('four runtimes and data services are healthy with working host access', async ({
  request,
}) => {
  for (const service of [
    'postgres',
    'valkey',
    'seaweedfs',
    'api',
    'ai-worker',
    'document-worker',
    'dispatcher',
    'frontend',
  ]) {
    const id = await containerId(service);
    expect(
      await docker(['inspect', '--format', '{{.State.Health.Status}}', id]),
    ).toBe('healthy');
  }
  const api = await request.get(descriptor().apiUrl + '/api/health');
  expect(api.status()).toBe(200);
  expect(HealthResponseSchema.parse(await api.json()).status).toBe('ok');
  expect((await request.get(descriptor().frontendUrl)).status()).toBe(200);
  for (const service of ['ai-worker', 'document-worker', 'dispatcher'])
    for (const mode of ['liveness', 'readiness'])
      await docker([
        'exec',
        await containerId(service),
        'node',
        'backend/dist/bootstrap/health-check.js',
        '--mode',
        mode,
      ]);
});
