import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type {
  RunActor,
  VerifiedIdentity,
} from '../../src/modules/identity-access/index.js';
import { RunEventsService } from '../../src/modules/chat/run-events.service.js';

const userId = randomUUID();
const orgId = randomUUID();
const actor = { userId, orgId } as RunActor;
const identity = { userId, sessionId: randomUUID() } as VerifiedIdentity;
const sink = { write: () => true, drain: async () => true, close: vi.fn() };

function service(options: { snapshot: unknown; admitFails: boolean }) {
  return new RunEventsService(
    {
      withTenant: async (_scope: unknown, work: (tx: never) => unknown) =>
        work({} as never),
    } as never,
    { authorizedChatSnapshot: async () => options.snapshot } as never,
    { assertLiveActor: vi.fn() } as never,
    {} as never,
    {
      admit: vi.fn(async () => {
        if (options.admitFails) throw new Error('valkey down');
        throw new Error('unreachable in these tests');
      }),
      close: vi.fn(),
    } as never,
    {} as never,
    'test',
    6,
    { assert: vi.fn() },
  );
}

test('chat stream: missing or foreign chat -> 404, before admission', async () => {
  await expect(
    service({ snapshot: null, admitFails: true }).connect(
      actor,
      randomUUID(),
      undefined,
      sink as never,
      identity,
    ),
  ).rejects.toMatchObject({ status: 404 });
});

test('chat stream: admit throws -> 503 STREAM_UNAVAILABLE for an owned chat', async () => {
  await expect(
    service({ snapshot: { snapshot: {} }, admitFails: true }).connect(
      actor,
      randomUUID(),
      undefined,
      sink as never,
      identity,
    ),
  ).rejects.toMatchObject({ code: 'STREAM_UNAVAILABLE', status: 503 });
});

test('invalidation stream: admit throws -> 503 STREAM_UNAVAILABLE', async () => {
  await expect(
    service({ snapshot: null, admitFails: true }).connectChatInvalidations(
      actor,
      sink as never,
      identity,
    ),
  ).rejects.toMatchObject({ code: 'STREAM_UNAVAILABLE', status: 503 });
});
