import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import {
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
} from '@opentelemetry/api';
import { startAiTelemetry } from '../../src/infrastructure/telemetry/ai-telemetry.js';

// GHSA-45rx-2jwx-cxfr: a malformed `uber-trace-id` crashes the process only
// when Jaeger is the active propagator. The AI worker wires its own
// `noPropagation` propagator into NodeSDK, so extract is the identity and
// inject writes nothing, whatever the sdk-node version pulls in.
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn(function NodeSDK() {
    return {
      start: vi.fn(),
      shutdown: vi.fn(async () => {}),
    };
  }),
}));

it('configures NodeSDK with a propagator that never extracts or injects trace headers', async () => {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const telemetry = await startAiTelemetry({
    collectorUrl: 'http://localhost:4318',
    serviceName: 'lexon-test',
  });
  try {
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    const options = vi.mocked(NodeSDK).mock.calls[0]?.[0];
    const propagator = options?.textMapPropagator;
    expect(propagator).toBeDefined();
    if (!propagator) throw new Error('NodeSDK built without a propagator');
    const active = context.active();
    const extracted = propagator.extract(
      active,
      {
        'uber-trace-id': '%',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        baggage: 'a=b',
      },
      defaultTextMapGetter,
    );
    expect(extracted).toBe(active);
    const carrier: Record<string, string> = {};
    const setter = vi.fn(defaultTextMapSetter.set);
    propagator.inject(context.active(), carrier, { set: setter });
    expect(setter).not.toHaveBeenCalled();
    expect(carrier).toEqual({});
    expect(propagator.fields()).toEqual([]);
  } finally {
    await telemetry.close();
  }
});

it('keeps the AI worker entrypoint the only startAiTelemetry call site', async () => {
  const { readFile } = await import('node:fs/promises');
  const { globSync } = await import('node:fs');
  const files = globSync('src/**/*.ts', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  }).map((file) => fileURLToPath(new URL(`../../${file}`, import.meta.url)));
  const users: string[] = [];
  for (const file of files)
    if (/startAiTelemetry\(/.test(await readFile(file, 'utf8')))
      users.push(file);
  // The `startAiTelemetry(` pattern also matches the function declaration in
  // telemetry/ai-telemetry.ts; re-exports without a call (telemetry/index.ts)
  // never match. A call site outside the AI worker would mean another
  // process registers the OTel propagator chain.
  expect(
    users
      .map((f) => f.split('backend/')[1])
      .filter((f) => f !== 'src/infrastructure/telemetry/ai-telemetry.ts'),
  ).toEqual(['src/entrypoints/ai-worker/main.ts']);
});
