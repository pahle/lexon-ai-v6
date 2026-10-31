import { expect, it } from 'vitest';
import { createEvaluationContext } from '../src/context.js';
it('boots the backend through its public package export without infrastructure or secrets', async () => {
  const before = process.listenerCount('SIGTERM');
  const context = await createEvaluationContext();
  try {
    expect(context.version).toBeTypeOf('string');
    expect(context.version.length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
  expect(process.listenerCount('SIGTERM')).toBe(before);
});
