import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

// GHSA-45rx-2jwx-cxfr: `decodeURIComponent` on a malformed `uber-trace-id`
// throws uncaught inside the Jaeger propagator — only when Jaeger is active.
// The API never starts an OTel SDK, so the request keeps its normal status and
// a second request proves the process is still serving.
test('a malformed uber-trace-id header keeps its normal status and the API stays alive', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-trace-header-health.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const malformed = await fetch(`${origin}/api/health/live`, {
      headers: { 'uber-trace-id': '%' },
    });
    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toEqual({ status: 'ok' });
    const stillAlive = await fetch(`${origin}/api/health/live`, {
      headers: { 'uber-trace-id': '%' },
    });
    expect(stillAlive.status).toBe(200);
  } finally {
    await app.close();
  }
});
