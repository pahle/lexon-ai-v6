import { AsyncResource } from 'node:async_hooks';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ChatInvalidationEventSchema,
  type ChatIdentityFallbackEvent,
  type ChatSnapshot,
  type ChatStreamRecoveryMode,
} from '@lexon/contracts';
import {
  RUN_SSE_REVALIDATION,
  RunAuthorizationService,
  type RunActor,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import {
  AiRunRepository,
  type ChatTitleNotification,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import {
  SseConnectionRegistry,
  type SseConnectionLease,
} from '../../infrastructure/queue/sse-connection-registry.js';
import {
  StreamHub,
  type SseSink,
  type Subscription,
} from '../../infrastructure/queue/stream-hub.js';
import { CancelSignals } from '../../infrastructure/queue/cancel-signals.js';

const PROCESS_ID = randomUUID();
const MAX_PENDING_TITLE_INVALIDATIONS = 64;
const TITLE_INVALIDATION_HEARTBEAT_MS = 15_000;
const TITLE_INVALIDATION_DRAIN_MS = 5000;
interface AuthorizationCheck {
  expiresAt: number;
  readonly pending: Promise<void>;
  cleanup?: ReturnType<typeof setTimeout>;
}

const authorizationCache = new Map<string, AuthorizationCheck>();

interface AuthorizedSnapshot {
  readonly snapshot: ChatSnapshot;
  readonly streamGeneration: number;
  readonly resumable: boolean;
}

interface SnapshotRead {
  expiresAt: number;
  value: AuthorizedSnapshot | undefined;
  pending: Promise<AuthorizedSnapshot | undefined> | undefined;
  cleanup?: ReturnType<typeof setTimeout>;
}

const snapshotCache = new Map<string, SnapshotRead>();

async function sharedSnapshotRead(
  key: string,
  read: () => Promise<AuthorizedSnapshot | undefined>,
): Promise<AuthorizedSnapshot | undefined> {
  const existing = snapshotCache.get(key);
  if (existing?.pending) return existing.pending;
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const entry: SnapshotRead = {
    expiresAt: Number.POSITIVE_INFINITY,
    value: undefined,
    pending: undefined,
  };
  const pending = read()
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + 1000;
      entry.cleanup = setTimeout(() => {
        if (snapshotCache.get(key) === entry) snapshotCache.delete(key);
      }, 1000);
      entry.cleanup.unref();
      return value;
    })
    .catch((error: unknown) => {
      if (entry.cleanup) clearTimeout(entry.cleanup);
      if (snapshotCache.get(key) === entry) snapshotCache.delete(key);
      throw error;
    });
  entry.pending = pending;
  snapshotCache.set(key, entry);
  void pending.then(
    () => {
      entry.pending = undefined;
    },
    () => {
      entry.pending = undefined;
    },
  );
  return pending;
}

interface RunSseRevalidation {
  assert(identity: VerifiedIdentity, orgId: string): Promise<void>;
}

@Injectable()
export class RunEventsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly authorization: RunAuthorizationService,
    private readonly hub: StreamHub,
    private readonly registry: SseConnectionRegistry,
    private readonly signals: CancelSignals,
    private readonly queuePrefix: string,
    private readonly connectionLimit: number,
    @Inject(RUN_SSE_REVALIDATION)
    private readonly revalidation: RunSseRevalidation,
  ) {}

  readonly #local = new Map<
    string,
    {
      readonly runId?: string;
      readonly close: () => Promise<void>;
      readonly shutdown: () => Promise<void>;
    }
  >();

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.#local.values()].map(({ shutdown }) => shutdown()),
    );
    await this.registry.close();
  }

  async closeRun(runId: string): Promise<void> {
    await Promise.all(
      [...this.#local.values()]
        .filter((connection) => connection.runId === runId)
        .map(({ close }) => close()),
    );
  }

  async connectChatInvalidations(
    actor: RunActor,
    sink: SseSink,
    identity: VerifiedIdentity,
    identityFallback?: ChatIdentityFallbackEvent,
  ): Promise<Subscription> {
    this.authorization.assertLiveActor(actor);
    const { orgId, userId } = actor;
    const connectionId = randomUUID();
    let lease: SseConnectionLease | undefined;
    try {
      const admitted = await this.registry.admit(
        userId,
        connectionId,
        PROCESS_ID,
        this.connectionLimit,
      );
      lease = admitted.lease;
      if (admitted.evicted?.processId === PROCESS_ID)
        await this.#local.get(admitted.evicted.connectionId)?.close();
    } catch {
      throw new NotFoundException();
    }

    let closed = false;
    let renewal: ReturnType<typeof setInterval> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => Promise<void>) | undefined;
    let checkingLease = false;
    let delivering = false;
    let invalidateAll = false;
    const pendingChatIds = new Set<string>();
    const notificationScope = new AsyncResource(
      'LexonChatInvalidationSubscription',
    );
    const close = async (
      reason?: 'slow-client' | 'revoked' | 'shutdown' | 'evicted',
    ): Promise<void> => {
      if (closed) return;
      closed = true;
      if (renewal) clearInterval(renewal);
      if (heartbeat) clearInterval(heartbeat);
      this.#local.delete(connectionId);
      pendingChatIds.clear();
      invalidateAll = false;
      await unsubscribe?.().catch(() => undefined);
      notificationScope.emitDestroy();
      if (lease) await this.registry.release(lease).catch(() => false);
      if (reason) await sink.close(reason).catch(() => undefined);
    };
    this.#local.set(connectionId, {
      close: () => close('evicted'),
      shutdown: () => close('shutdown'),
    });

    const drainInvalidations = async () => {
      if (closed || delivering) return;
      delivering = true;
      try {
        while (!closed && (invalidateAll || pendingChatIds.size > 0)) {
          let chatId: string | null;
          if (invalidateAll) {
            invalidateAll = false;
            chatId = null;
          } else {
            const nextChatId = pendingChatIds.values().next().value;
            if (!nextChatId) break;
            pendingChatIds.delete(nextChatId);
            chatId = nextChatId;
          }
          try {
            await this.revalidation.assert(identity, orgId);
          } catch {
            await close('revoked');
            return;
          }
          if (closed) return;
          const event = ChatInvalidationEventSchema.parse({
            version: 1,
            type: 'chat.invalidated',
            chatId,
          });
          if (!sink.write({ data: JSON.stringify(event) })) {
            let drained = false;
            try {
              drained = await sink.drain(TITLE_INVALIDATION_DRAIN_MS);
            } catch {
              drained = false;
            }
            if (!drained) {
              await close('slow-client');
              return;
            }
          }
        }
      } catch {
        await close('revoked');
      } finally {
        delivering = false;
      }
    };
    const enqueueInvalidation = (notification: ChatTitleNotification) => {
      if (
        closed ||
        notification.orgId !== orgId ||
        notification.userId !== userId
      )
        return;
      if (!invalidateAll) {
        pendingChatIds.add(notification.chatId);
        if (pendingChatIds.size > MAX_PENDING_TITLE_INVALIDATIONS) {
          pendingChatIds.clear();
          invalidateAll = true;
        }
      }
      void drainInvalidations();
    };

    try {
      unsubscribe = await this.signals.subscribeChatTitleInvalidations(
        notificationScope.bind(enqueueInvalidation),
        notificationScope.bind(() => void close('revoked')),
      );
      if (closed) {
        await unsubscribe();
        throw new NotFoundException();
      }
      sink.write({ data: ': connected' });
      if (
        identityFallback &&
        !sink.write({ data: JSON.stringify(identityFallback) })
      ) {
        const drained = await sink
          .drain(TITLE_INVALIDATION_DRAIN_MS)
          .catch(() => false);
        if (!drained) {
          await close('slow-client');
          return { close: () => close() };
        }
      }
      heartbeat = setInterval(() => {
        if (closed || delivering || invalidateAll || pendingChatIds.size > 0)
          return;
        void (async () => {
          if (sink.write({ data: ': heartbeat' })) return;
          const drained = await sink
            .drain(TITLE_INVALIDATION_DRAIN_MS)
            .catch(() => false);
          if (!drained) await close('slow-client');
        })();
      }, TITLE_INVALIDATION_HEARTBEAT_MS);
      heartbeat.unref();
      renewal = setInterval(() => {
        if (closed || !lease || checkingLease) return;
        checkingLease = true;
        void (async () => {
          const current = await this.registry.renew(lease!);
          if (!current) return close('evicted');
          lease = current;
          await this.revalidation.assert(identity, orgId);
        })()
          .catch(() => close('revoked'))
          .finally(() => {
            checkingLease = false;
          });
      }, 1000);
      renewal.unref();
      return { close: () => close() };
    } catch (error) {
      await close();
      throw error;
    }
  }

  async connect(
    actor: RunActor,
    runId: string,
    lastEventId: string | undefined,
    sink: SseSink,
    identity: VerifiedIdentity,
    recoveryMode: ChatStreamRecoveryMode = 'incremental',
  ): Promise<Subscription> {
    this.authorization.assertLiveActor(actor);
    const orgId = actor.orgId;
    const userId = actor.userId;
    const state = await this.database.withTenant(
      { orgId, userId },
      (tx) => this.runs.authorizedChatSnapshot(tx, runId, userId),
      { timeoutMs: 1000 },
    );
    if (!state) throw new NotFoundException();
    const connectionId = randomUUID();
    let lease: SseConnectionLease | undefined;
    try {
      const admitted = await this.registry.admit(
        userId,
        connectionId,
        PROCESS_ID,
        this.connectionLimit,
      );
      lease = admitted.lease;
      if (admitted.evicted?.processId === PROCESS_ID)
        await this.#local.get(admitted.evicted.connectionId)?.close();
    } catch {
      throw new NotFoundException();
    }
    const streamKey = `${this.queuePrefix}:{run-streams}:${runId}:events`;
    const snapshotKey = `${orgId}|${userId}|${runId}|${identity.channel}|${identity.sessionId}`;
    let streamSubscription: Subscription | undefined;
    let unsubscribeCancel: (() => Promise<void>) | undefined;
    let unbindCancel: (() => void) | undefined;
    let closed = false;
    let checking = false;
    let renewal: ReturnType<typeof setInterval> | undefined;
    const close = async (
      reason?: 'slow-client' | 'revoked' | 'shutdown' | 'evicted',
    ): Promise<void> => {
      if (closed) return;
      closed = true;
      if (renewal) clearInterval(renewal);
      this.#local.delete(connectionId);
      if (reason && streamSubscription?.revoke)
        await streamSubscription.revoke();
      else await streamSubscription?.close();
      await unsubscribeCancel?.();
      unbindCancel?.();
      if (lease) await this.registry.release(lease).catch(() => false);
      if (reason && streamSubscription) await sink.close(reason);
    };
    this.#local.set(connectionId, {
      runId,
      close: () => close('evicted'),
      shutdown: () => close('shutdown'),
    });
    try {
      unbindCancel = this.signals.bind(runId, { orgId, userId });
      const unsubscribe = await this.signals.subscribeDeletion(runId, () => {
        void close('revoked');
      });
      if (closed) {
        await unsubscribe();
        unbindCancel?.();
        throw new NotFoundException();
      }
      unsubscribeCancel = unsubscribe;
      const current = await this.database.withTenant(
        { orgId, userId },
        (tx) => this.runs.authorizedChatSnapshot(tx, runId, userId),
        { timeoutMs: 1000 },
      );
      if (!current || closed) {
        await close();
        throw new NotFoundException();
      }
      const reloadFallback = async () => {
        const refreshed = await sharedSnapshotRead(snapshotKey, async () => {
          await this.revalidation.assert(identity, orgId);
          const value = await this.database.withTenant(
            { orgId, userId },
            (tx) => this.runs.authorizedChatSnapshot(tx, runId, userId),
            { timeoutMs: 1000 },
          );
          return value ?? undefined;
        });
        return refreshed
          ? {
              snapshot: refreshed.snapshot,
              streamGeneration: refreshed.streamGeneration,
              reload: reloadFallback,
            }
          : undefined;
      };
      const guardedSink: SseSink = {
        setRecoveryMode: (mode) => sink.setRecoveryMode?.(mode),
        write: (frame) => (closed ? false : sink.write(frame)),
        drain: async (timeoutMs) => {
          if (closed) return false;
          let drained: boolean;
          try {
            drained = await sink.drain(timeoutMs);
          } catch {
            return false;
          }
          if (!drained || closed) return false;
          try {
            const current = await this.database.withTenant(
              { orgId, userId },
              (tx) => this.runs.authorizedChatSnapshot(tx, runId, userId),
              { timeoutMs: 1000 },
            );
            if (!current || closed) {
              await close('revoked');
              return false;
            }
            return true;
          } catch {
            await close('revoked');
            return false;
          }
        },
        close: (reason) => sink.close(reason),
      };
      streamSubscription = await this.hub.subscribe(
        streamKey,
        lastEventId,
        guardedSink,
        {
          snapshot: current.snapshot,
          streamGeneration: current.streamGeneration,
          reload: reloadFallback,
        },
        recoveryMode,
      );
      if (closed) {
        if (streamSubscription.revoke) await streamSubscription.revoke();
        else await streamSubscription.close();
        throw new NotFoundException();
      }
      renewal = setInterval(() => {
        if (checking || closed || !lease) return;
        checking = true;
        void (async () => {
          const current = await this.registry.renew(lease!);
          if (!current) return close('evicted');
          lease = current;
          const key = `${userId}|${runId}|${identity.channel}|${identity.sessionId}`;
          let check = authorizationCache.get(key);
          if (!check || check.expiresAt <= Date.now()) {
            const entry: AuthorizationCheck = {
              expiresAt: Number.POSITIVE_INFINITY,
              pending: Promise.resolve(),
            };
            const pending = (async () => {
              await this.revalidation.assert(identity, orgId);
              const owned = await this.database.withTenant(
                { orgId, userId },
                (tx) => this.runs.existsForOwnedChat(tx, runId, userId),
                { timeoutMs: 1000 },
              );
              if (!owned) throw new NotFoundException();
            })().then(() => {
              entry.expiresAt = Date.now() + 1000;
              entry.cleanup = setTimeout(() => {
                if (authorizationCache.get(key) === entry)
                  authorizationCache.delete(key);
              }, 1000);
              entry.cleanup.unref();
            });
            Object.assign(entry, { pending });
            check = entry;
            authorizationCache.set(key, entry);
            void pending.catch(() => {
              if (entry.cleanup) clearTimeout(entry.cleanup);
              if (authorizationCache.get(key) === entry)
                authorizationCache.delete(key);
            });
          }
          await check.pending;
        })()
          .catch(() => close('revoked'))
          .finally(() => {
            checking = false;
          });
      }, 1000);
      renewal.unref();
      return { close: () => close() };
    } catch (error) {
      await close();
      throw error;
    }
  }
}
