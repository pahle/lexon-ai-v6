import { expect, it, vi } from 'vitest';
import { JobRegistry } from '../../src/modules/platform/job-registry.js';

it('registers typed durable step handlers and rejects unknown job types', () => {
  const registry = new JobRegistry();
  const handler = {
    strategy: 'durable-step' as const,
    handle: vi.fn(async () => ({ kind: 'done' as const })),
  };
  registry.register('run.start.v1', handler);
  expect(registry.resolve('run.start.v1')).toBe(handler);
  expect(() => registry.resolve('unknown.v1')).toThrow('Unknown job type');
  expect(() => registry.register('run.start.v1', handler)).toThrow(
    'Duplicate job type',
  );
});

it('preserves short transaction handlers for F0 composition', () => {
  const registry = new JobRegistry();
  const handler = {
    strategy: 'short-transaction' as const,
    handle: vi.fn(async () => undefined),
  };
  registry.register('platform.noop.v1', handler);
  expect(registry.resolve('platform.noop.v1')).toBe(handler);
});
