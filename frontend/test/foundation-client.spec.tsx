import { expect, it, vi } from 'vitest';
import { createFoundationClient } from '../src/lib/foundation-client.js';
import { createServerFoundationClient } from '../src/lib/server-foundation-client.js';
const health = {
  status: 'ok',
  version: '0.0.1',
  dependencies: { postgres: 'up' },
};
it('keeps browser requests on the same origin and validates shared responses', async () => {
  const network = vi.fn<typeof fetch>(async () => Response.json(health));
  const client = createFoundationClient({ baseUrl: '/api', fetch: network });
  expect(await client.health()).toEqual(health);
  expect(network.mock.calls[0]![0]).toBe('/api/health');
  network.mockResolvedValueOnce(Response.json({ version: 'bad-shape' }));
  await expect(client.health()).rejects.toThrow('Invalid backend response');
});
it('uses the private internal URL for a bounded server request', async () => {
  const network = vi.fn<typeof fetch>(async () => Response.json(health));
  await createServerFoundationClient({
    backendUrl: 'http://internal-api:3001',
    fetch: network,
  }).health();
  expect(network.mock.calls[0]![0]).toBe('http://internal-api:3001/api/health');
  expect(network.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
});
it('posts only a validated probe ID and maps errors without exposing backend text', async () => {
  const network = vi.fn<typeof fetch>(async () =>
    Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'secret-body-text' } },
      { status: 400 },
    ),
  );
  const client = createFoundationClient({ baseUrl: '/api', fetch: network });
  const probeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await expect(client.diagnose({ probeId })).rejects.toThrow(
    /^Validation failed$/,
  );
  expect(network.mock.calls[0]![0]).toBe('/api/diagnostics/validation');
  expect(network.mock.calls[0]![1]?.body).toBe(JSON.stringify({ probeId }));
  network.mockClear();
  await expect(client.diagnose({ probeId: 'secret-invalid' })).rejects.toThrow(
    'Enter a valid UUID',
  );
  expect(network).not.toHaveBeenCalled();
});
