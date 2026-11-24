import { expect, it, vi } from 'vitest';
import {
  isRetryableAuthError,
  withAuthRetry,
} from '../../src/infrastructure/db/index.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';

// A serialization failure wrapped in a cause: the walk through pgFailure is
// what makes this retryable.
const wrappedSerialization = () => ({ cause: { code: '40001' } });
const unavailable = (error: unknown) =>
  error instanceof IdentityError
    ? error
    : new IdentityError('AUTH_UNAVAILABLE', 503);

it('retries a retryable error to exhaustion and maps the terminal failure', async () => {
  const work = vi.fn(async () => {
    throw wrappedSerialization();
  });
  await expect(
    withAuthRetry(work, {
      attempts: 3,
      retryable: isRetryableAuthError,
      map: unavailable,
    }),
  ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 });
  expect(work).toHaveBeenCalledTimes(3);
});

it('resolves when the work succeeds on the last attempt', async () => {
  let calls = 0;
  const value = await withAuthRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw wrappedSerialization();
      return 'done';
    },
    { attempts: 3, retryable: isRetryableAuthError },
  );
  expect(value).toBe('done');
  expect(calls).toBe(3);
});

it('runs a non-retryable error through map exactly once with no retry', async () => {
  const failure = new Error('unmapped');
  const map = vi.fn((error: unknown) => error);
  const work = vi.fn(async () => {
    throw failure;
  });
  await expect(
    withAuthRetry(work, { retryable: () => false, map }),
  ).rejects.toBe(failure);
  expect(work).toHaveBeenCalledTimes(1);
  expect(map).toHaveBeenCalledTimes(1);
  expect(map).toHaveBeenCalledWith(failure);
});

it('rethrows the last error on exhaustion when no map is given', async () => {
  const failure = wrappedSerialization();
  const work = vi.fn(async () => {
    throw failure;
  });
  await expect(
    withAuthRetry(work, { retryable: isRetryableAuthError }),
  ).rejects.toBe(failure);
  expect(work).toHaveBeenCalledTimes(3);
});

it('isRetryableAuthError reads wrapped 40001 and 40P01 only', () => {
  expect(isRetryableAuthError({ code: '40001' })).toBe(true);
  expect(isRetryableAuthError({ code: '40P01' })).toBe(true);
  expect(isRetryableAuthError({ cause: { code: '40001' } })).toBe(true);
  expect(isRetryableAuthError({ cause: { cause: { code: '40P01' } } })).toBe(
    true,
  );
  expect(isRetryableAuthError({ code: '23505' })).toBe(false);
  expect(isRetryableAuthError({ cause: { code: '23505' } })).toBe(false);
  expect(isRetryableAuthError(new Error('boom'))).toBe(false);
});
