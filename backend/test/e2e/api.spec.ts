import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  HealthResponseSchema,
  DiagnosticResponseSchema,
  ErrorResponseSchema,
} from '@lexon/contracts';
import { descriptor, docker, containerId } from './runtime-support.js';
test('public API follows shared contracts and has no chat endpoint', async ({
  request,
}) => {
  const origin = descriptor().apiUrl;
  const health = await request.get(origin + '/api/health');
  expect(health.status()).toBe(200);
  const version = HealthResponseSchema.parse(await health.json()).version;
  expect(version).toBeTruthy();
  const id = randomUUID();
  const accepted = await request.post(origin + '/api/diagnostics/validation', {
    data: { probeId: id },
  });
  expect(accepted.status()).toBe(200);
  expect(DiagnosticResponseSchema.parse(await accepted.json())).toEqual({
    probeId: id,
    accepted: true,
  });
  const rejected = await request.post(origin + '/api/diagnostics/validation', {
    data: { probeId: 'secret-content' },
  });
  expect(rejected.status()).toBe(400);
  const safe = ErrorResponseSchema.parse(await rejected.json());
  expect(safe.error.code).toBe('VALIDATION_ERROR');
  expect(JSON.stringify(safe)).not.toContain('secret-content');
  expect(
    (await request.post(origin + '/api/chat', { data: {} })).status(),
  ).toBe(404);
});
test('evaluation export boots independently in the built backend image', async () => {
  const output = await docker([
    'exec',
    '--workdir',
    '/app/backend',
    await containerId('api'),
    'node',
    '--input-type=module',
    '-e',
    "import {createEvaluationContext} from '@lexon/backend/evaluation';const context=await createEvaluationContext();console.log(context.version);await context.close();",
  ]);
  expect(output).toMatch(/^\d+\.\d+\.\d+$/);
});
