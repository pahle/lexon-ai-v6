import { expect, it, vi } from 'vitest';
import { QueryProvider } from '../src/components/query-provider.js';
import { HealthStatus } from '../src/components/health-status.js';
import { render, settle } from './render.js';
it('shows loading then backend version through a same-origin query', async () => {
  let resolve!: (response: Response) => void;
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await render(
    <QueryProvider>
      <HealthStatus />
    </QueryProvider>,
  );
  try {
    expect(view.container.textContent).toContain('Checking backend');
    expect(network.mock.calls[0]![0]).toBe('/api/health');
    resolve(
      Response.json({
        status: 'ok',
        version: '0.0.1',
        dependencies: { postgres: 'up' },
      }),
    );
    await expect
      .poll(async () => {
        await settle();
        return view.container.textContent;
      })
      .toContain('Backend version 0.0.1');
  } finally {
    await view.unmount();
    network.mockRestore();
  }
});
it('renders unavailable status safely', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json(
        {
          status: 'unavailable',
          version: '0.0.1',
          dependencies: { postgres: 'down' },
        },
        { status: 503 },
      ),
    );
  const view = await render(
    <QueryProvider>
      <HealthStatus />
    </QueryProvider>,
  );
  try {
    await expect
      .poll(async () => {
        await settle();
        return view.container.textContent;
      })
      .toContain('Backend unavailable');
  } finally {
    await view.unmount();
    network.mockRestore();
  }
});
