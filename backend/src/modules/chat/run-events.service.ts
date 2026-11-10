import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  RUN_SSE_REVALIDATION,
  RunAuthorizationService,
  type RunActor,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import {
  AiRunRepository,
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

const PROCESS_ID = randomUUID();
interface AuthorizationCheck {
  expiresAt: number;
  readonly pending: Promise<void>;
  cleanup?: ReturnType<typeof setTimeout>;
}

const authorizationCache = new Map<string, AuthorizationCheck>();

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
    private readonly queuePrefix: string,
    private readonly connectionLimit: number,
    @Inject(RUN_SSE_REVALIDATION)
    private readonly revalidation: RunSseRevalidation,
  ) {}

  readonly #local = new Map<string, () => Promise<void>>();

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.#local.values()].map((close) => close()));
    await this.registry.close();
  }

  async connect(
    actor: RunActor,
    runId: string,
    lastEventId: string | undefined,
    sink: SseSink,
    identity: VerifiedIdentity,
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
        await this.#local.get(admitted.evicted.connectionId)?.();
    } catch {
      throw new NotFoundException();
    }
    const streamKey = `${this.queuePrefix}:{run-streams}:${runId}:events`;
    let streamSubscription: Subscription | undefined;
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
      await streamSubscription?.close();
      if (lease) await this.registry.release(lease).catch(() => false);
      if (reason) await sink.close(reason);
    };
    this.#local.set(connectionId, () => close('evicted'));
    try {
      const reloadFallback = async () => {
        await this.revalidation.assert(identity, orgId);
        const refreshed = await this.database.withTenant(
          { orgId, userId },
          (tx) => this.runs.authorizedChatSnapshot(tx, runId, userId),
          { timeoutMs: 1000 },
        );
        return refreshed
          ? {
              snapshot: refreshed.snapshot,
              streamGeneration: refreshed.streamGeneration,
              reload: reloadFallback,
            }
          : undefined;
      };
      streamSubscription = await this.hub.subscribe(
        streamKey,
        lastEventId,
        sink,
        {
          snapshot: state.snapshot,
          streamGeneration: state.streamGeneration,
          reload: reloadFallback,
        },
      );
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
