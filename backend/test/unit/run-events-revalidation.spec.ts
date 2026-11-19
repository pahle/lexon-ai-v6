import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  RunActor,
  VerifiedIdentity,
} from '../../src/modules/identity-access/index.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';
import { RunEventsService } from '../../src/modules/chat/run-events.service.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(
  assert: (identity: VerifiedIdentity, orgId: string) => Promise<void>,
) {
  const userId = randomUUID();
  const orgId = randomUUID();
  const actor = { userId, orgId } as RunActor;
  const identity = {
    userId,
    sessionId: randomUUID(),
    activeOrganizationId: orgId,
  } as VerifiedIdentity;
  const registry = {
    admit: vi.fn(
      async (_u: string, connectionId: string, processId: string) => ({
        lease: {
          userId,
          connectionId,
          processId,
          ownerToken: randomUUID(),
          admittedAt: 1,
          expiresAt: Date.now() + 3000,
        },
      }),
    ),
    renew: vi.fn(async (lease: unknown) => lease),
    release: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
  const signals = {
    subscribeChatTitleInvalidations: vi.fn(async () => async () => undefined),
  };
  const service = new RunEventsService(
    {} as never,
    {} as never,
    { assertLiveActor: vi.fn() } as never,
    {} as never,
    registry as never,
    signals as never,
    'test',
    50,
    { assert },
  );
  const connect = async () => {
    const close = vi.fn(async () => undefined);
    const sink = {
      write: () => true,
      drain: async () => true,
      close,
    };
    await service.connectChatInvalidations(actor, sink, identity);
    return close;
  };
  return { connect, registry };
}
const unavailable = () => new IdentityError('AUTH_UNAVAILABLE', 503);
const revoked = () => new IdentityError('AUTH_REQUIRED', 401);

test('N invalidation streams on one session -> at most one assert per 5 s', async () => {
  const assert = vi.fn(async () => undefined);
  const { connect } = setup(assert);
  for (let i = 0; i < 20; i++) await connect();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(assert.mock.calls.length).toBeLessThanOrEqual(4);
  expect(assert.mock.calls.length).toBeGreaterThanOrEqual(3);
});

test('lease renewal stays at 1 s while revalidation runs every 5 s', async () => {
  const assert = vi.fn(async () => undefined);
  const { connect, registry } = setup(assert);
  await connect();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(registry.renew.mock.calls.length).toBeGreaterThanOrEqual(9);
  expect(assert.mock.calls.length).toBeLessThanOrEqual(2);
});

test('revoked -> closed within 5 s + 1 tick', async () => {
  const assert = vi.fn(async () => {
    throw revoked();
  });
  const { connect } = setup(assert);
  const close = await connect();
  await vi.advanceTimersByTimeAsync(6000);
  expect(close).toHaveBeenCalledWith('revoked');
});

test('AUTH_UNAVAILABLE x3 then ok -> stream stays open', async () => {
  let calls = 0;
  const assert = vi.fn(async () => {
    if (++calls <= 3) throw unavailable();
  });
  const { connect } = setup(assert);
  const close = await connect();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls).toBeGreaterThan(3);
  expect(close).not.toHaveBeenCalled();
});

test('AUTH_UNAVAILABLE for 2 intervals then revoked -> closed within one interval after recovery', async () => {
  let phase: 'down' | 'revoked' = 'down';
  const assert = vi.fn(async () => {
    throw phase === 'down' ? unavailable() : revoked();
  });
  const { connect } = setup(assert);
  const close = await connect();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(close).not.toHaveBeenCalled();
  phase = 'revoked';
  await vi.advanceTimersByTimeAsync(5_000);
  expect(close).toHaveBeenCalledWith('revoked');
});
