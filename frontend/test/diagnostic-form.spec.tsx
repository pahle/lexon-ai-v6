import { expect, it, vi } from 'vitest';
import { DiagnosticForm } from '../src/components/diagnostic-form.js';
import { render, submit, settle } from './render.js';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
it('rejects invalid UUID locally without a fetch', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected fetch'));
  const view = await render(<DiagnosticForm />);
  try {
    await submit(view.container, 'invalid');
    expect(view.container.textContent).toContain('Enter a valid UUID');
    expect(network).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    network.mockRestore();
  }
});
it('submits exactly the probe ID and shows acceptance', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ probeId: id, accepted: true }));
  const view = await render(<DiagnosticForm />);
  try {
    await submit(view.container, id);
    await expect
      .poll(async () => {
        await settle();
        return view.container.textContent;
      })
      .toContain('Validation accepted');
    expect(network.mock.calls[0]![0]).toBe('/api/diagnostics/validation');
    expect(network.mock.calls[0]![1]?.body).toBe(
      JSON.stringify({ probeId: id }),
    );
  } finally {
    await view.unmount();
    network.mockRestore();
  }
});
it('shows a safe backend validation error', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'secret body' } },
        { status: 400 },
      ),
    );
  const view = await render(<DiagnosticForm />);
  try {
    await submit(view.container, id);
    await expect
      .poll(async () => {
        await settle();
        return view.container.textContent;
      })
      .toContain('Validation failed');
    expect(view.container.textContent).not.toContain('secret');
  } finally {
    await view.unmount();
    network.mockRestore();
  }
});
