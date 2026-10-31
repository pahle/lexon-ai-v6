import { expect, it } from 'vitest';
import {
  provisionRun,
  allowContainerReuse,
} from '../setup/resource-lifecycle.js';

it('releases every acquired resource when later startup fails', async () => {
  const stopped: string[] = [];
  await expect(
    provisionRun(async (register) => {
      register(async () => {
        stopped.push('postgres');
      });
      register(async () => {
        stopped.push('valkey');
        throw new Error('stop failed');
      });
      throw new Error('startup failed');
    }),
  ).rejects.toThrow('startup failed');
  expect(stopped).toEqual(['valkey', 'postgres']);
});

it('keeps one run alive until its idempotent teardown is called', async () => {
  let starts = 0;
  let stops = 0;
  const run = await provisionRun(async (register) => {
    starts++;
    register(async () => {
      stops++;
    });
    return 'ready';
  });
  expect(run.value).toBe('ready');
  expect(starts).toBe(1);
  expect(stops).toBe(0);
  await run.stop();
  await run.stop();
  expect(stops).toBe(1);
});

it('defaults to fresh containers and forbids opt-in reuse in CI', () => {
  expect(allowContainerReuse({})).toBe(false);
  expect(allowContainerReuse({ LEXON_TEST_REUSE: '1' })).toBe(true);
  expect(() =>
    allowContainerReuse({ LEXON_TEST_REUSE: '1', CI: 'true' }),
  ).toThrow('forbidden in CI');
});
