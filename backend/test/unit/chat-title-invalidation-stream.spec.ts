import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { ChatTitleNotification } from '../../src/infrastructure/db/index.js';
import type {
  RunActor,
  VerifiedIdentity,
} from '../../src/modules/identity-access/index.js';
import { RunEventsService } from '../../src/modules/chat/run-events.service.js';

function setup(options: { limit?: number; blockDrain?: boolean } = {}) {
  const userId = randomUUID();
  const orgId = randomUUID();
  const actor = { userId, orgId } as RunActor;
  const identity = { userId, activeOrganizationId: orgId } as VerifiedIdentity;
  let callback: ((notification: ChatTitleNotification) => void) | undefined;
  let unavailable: (() => void) | undefined;
  const unsubscribes = vi.fn(async () => undefined);
  let admissions = 0;
  let firstConnectionId = '';
  const leases: Array<{
    userId: string;
    connectionId: string;
    processId: string;
    ownerToken: string;
    admittedAt: number;
    expiresAt: number;
  }> = [];
  const registry = {
    admit: vi.fn(
      async (_user: string, connectionId: string, processId: string) => {
        admissions++;
        if (admissions === 1) firstConnectionId = connectionId;
        const lease = {
          userId,
          connectionId,
          processId,
          ownerToken: randomUUID(),
          admittedAt: 1,
          expiresAt: Date.now() + 3000,
        };
        leases.push(lease);
        return {
          lease,
          ...(options.limit && admissions > options.limit
            ? {
                evicted: {
                  connectionId: firstConnectionId,
                  processId,
                  ownerToken: randomUUID(),
                },
              }
            : {}),
        };
      },
    ),
    renew: vi.fn(async (lease: (typeof leases)[number]) => lease),
    release: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
  const signals = {
    subscribeChatTitleInvalidations: vi.fn(
      async (next: typeof callback, onUnavailable: typeof unavailable) => {
        callback = next;
        unavailable = onUnavailable;
        return unsubscribes;
      },
    ),
  };
  let releaseDrain!: () => void;
  const drainGate = new Promise<void>((resolve) => {
    releaseDrain = resolve;
  });
  const sinks: Array<{
    writes: string[];
    close: ReturnType<typeof vi.fn>;
    sink: {
      write(frame: { data: string }): boolean;
      drain(): Promise<boolean>;
      close(reason?: string): Promise<void>;
    };
  }> = [];
  const service = new RunEventsService(
    {} as never,
    {} as never,
    { assertLiveActor: vi.fn() } as never,
    {} as never,
    registry as never,
    signals as never,
    'test',
    options.limit ?? 6,
    { assert: vi.fn(async () => undefined) },
  );
  const connect = async () => {
    const writes: string[] = [];
    const close = vi.fn(async () => undefined);
    let firstData = true;
    const sink = {
      write(frame: { data: string }) {
        writes.push(frame.data);
        if (frame.data.startsWith('{') && options.blockDrain && firstData) {
          firstData = false;
          return false;
        }
        return true;
      },
      drain: vi.fn(async () => {
        if (!options.blockDrain) return true;
        await drainGate;
        return true;
      }),
      close,
    };
    sinks.push({ writes, close, sink });
    const subscription = await service.connectChatInvalidations(
      actor,
      sink,
      identity,
    );
    return subscription;
  };
  return {
    actor,
    callback: () => callback!,
    connect,
    get firstConnectionId() {
      return firstConnectionId;
    },
    releaseDrain,
    registry,
    service,
    sinks,
    unsubscribes,
    unavailable: () => unavailable!,
  };
}

const notification = (
  orgId: string,
  userId: string,
  chatId = randomUUID(),
): ChatTitleNotification => ({ orgId, userId, chatId });

test('title invalidation stream coalesces overflow to one owner-wide event while a slow sink drains', async () => {
  const context = setup({ blockDrain: true });
  const subscription = await context.connect();
  const first = randomUUID();
  context.callback()(
    notification(context.actor.orgId, context.actor.userId, first),
  );
  await vi.waitFor(() =>
    expect(context.sinks[0]!.sink.drain).toHaveBeenCalledOnce(),
  );
  for (let index = 0; index < 65; index++)
    context.callback()(notification(context.actor.orgId, context.actor.userId));
  context.releaseDrain();
  await vi.waitFor(() =>
    expect(
      context.sinks[0]!.writes.some((frame) => frame.includes('"chatId":null')),
    ).toBe(true),
  );
  expect(
    context.sinks[0]!.writes.filter((frame) => frame.includes('"chatId":null')),
  ).toHaveLength(1);
  await subscription.close();
  expect(context.unsubscribes).toHaveBeenCalledOnce();
});

test('title invalidation stream closes and releases its lease when a slow client cannot drain', async () => {
  const context = setup({ blockDrain: true });
  const subscription = await context.connect();
  context.sinks[0]!.sink.drain = vi.fn(async () => false);
  context.callback()(notification(context.actor.orgId, context.actor.userId));
  await vi.waitFor(() =>
    expect(context.sinks[0]!.close).toHaveBeenCalledWith('slow-client'),
  );
  expect(context.registry.release).toHaveBeenCalledOnce();
  await subscription.close();
});

test('admission at the per-user limit evicts and closes the oldest local title stream', async () => {
  const context = setup({ limit: 1 });
  await context.connect();
  await context.connect();
  expect(context.sinks[0]!.close).toHaveBeenCalledWith('evicted');
  expect(context.registry.release).toHaveBeenCalledWith(
    expect.objectContaining({ connectionId: context.firstConnectionId }),
  );
  await context.service.onModuleDestroy();
  expect(context.sinks[1]!.close).toHaveBeenCalledWith('shutdown');
});

test('notification-listener loss closes a live title stream and cleans up its subscription', async () => {
  const context = setup();
  const subscription = await context.connect();
  context.unavailable()();
  await vi.waitFor(() => expect(context.unsubscribes).toHaveBeenCalledOnce());
  await subscription.close();
  expect(context.registry.release).toHaveBeenCalledOnce();
});
