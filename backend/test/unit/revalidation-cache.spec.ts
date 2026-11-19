import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RevalidationCache } from '../../src/modules/identity-access/revalidation-cache.js';

const key = { userId: 'u', sessionId: 's', orgId: 'o' };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('50 concurrent get() for one key run load once', async () => {
  const cache = new RevalidationCache({ ttlMs: 1000 });
  const load = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const calls = Array.from({ length: 50 }, () => cache.get(key, load));
  await vi.advanceTimersByTimeAsync(50);
  await Promise.all(calls);
  expect(load).toHaveBeenCalledTimes(1);
});

test('a success is cached for ttlMs, then loads again; keys are independent', async () => {
  const cache = new RevalidationCache({ ttlMs: 1000 });
  const load = vi.fn(async () => undefined);
  await cache.get(key, load);
  await vi.advanceTimersByTimeAsync(999);
  await cache.get(key, load);
  expect(load).toHaveBeenCalledTimes(1);
  await cache.get({ ...key, sessionId: 'other' }, load);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await cache.get(key, load);
  expect(load).toHaveBeenCalledTimes(3);
});

test('rejection is not cached and every concurrent caller sees it', async () => {
  const cache = new RevalidationCache({ ttlMs: 1000 });
  const failing = vi.fn(async () => {
    throw new Error('unavailable');
  });
  const results = await Promise.allSettled([
    cache.get(key, failing),
    cache.get(key, failing),
  ]);
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  expect(failing).toHaveBeenCalledTimes(1);
  const ok = vi.fn(async () => undefined);
  await cache.get(key, ok);
  expect(ok).toHaveBeenCalledTimes(1);
});

test('an injected clock drives expiry', async () => {
  let now = 0;
  const cache = new RevalidationCache({ ttlMs: 10, now: () => now });
  const load = vi.fn(async () => undefined);
  await cache.get(key, load);
  now = 9;
  await cache.get(key, load);
  now = 10;
  await cache.get(key, load);
  expect(load).toHaveBeenCalledTimes(2);
});
