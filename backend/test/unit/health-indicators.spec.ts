import { expect, it, vi } from 'vitest';
import { HealthIndicators } from '../../src/infrastructure/telemetry/health-indicators.js';
const valkey = async () => ({
  queue: 'up' as const,
  streams: 'up' as const,
  limiter: 'up' as const,
});
it('checks only runtime-required dependencies using native Terminus indicators', async () => {
  const storage = { check: vi.fn(async () => 'up' as const) };
  const indicators = new HealthIndicators(
    { database: { check: async () => 'up' }, valkey, storage },
    100,
  );
  expect(await indicators.check('ai-worker')).toEqual({
    postgres: 'up',
    queue: 'up',
    streams: 'up',
    limiter: 'up',
  });
  expect(storage.check).not.toHaveBeenCalled();
  expect(await indicators.check('document-worker')).toMatchObject({
    storage: 'up',
  });
  expect(await indicators.check('api')).toMatchObject({ storage: 'up' });
});
it('bounds hanging dependencies and strips exception detail', async () => {
  const indicators = new HealthIndicators(
    {
      database: { check: () => new Promise(() => undefined) },
      valkey: async () => {
        throw new Error('redis://secret-host');
      },
      storage: { check: async () => 'down' },
    },
    20,
  );
  const start = Date.now();
  const result = await indicators.check('api');
  expect(result).toEqual({
    postgres: 'down',
    queue: 'down',
    streams: 'down',
    limiter: 'down',
    storage: 'down',
  });
  expect(Date.now() - start).toBeLessThan(500);
  expect(JSON.stringify(result)).not.toContain('secret');
});
