import { Redis } from 'ioredis';
import { z } from 'zod';
import type { AiRunRepository, TenantDatabase } from '../db/index.js';

const runIdSchema = z.uuid();
const POLL_INTERVAL_MS = 1000;
const DATABASE_POLL_TIMEOUT_MS = 500;

export interface CancelSignalsOptions {
  readonly url: string;
  readonly prefix: string;
  readonly database: TenantDatabase;
  readonly runs: AiRunRepository;
}

export class CancelSignals {
  readonly #prefix: string;
  readonly #url: string;
  readonly #database: TenantDatabase;
  readonly #runs: AiRunRepository;
  readonly #publisher: Redis;
  readonly #contexts = new Map<string, { orgId: string; userId: string }>();
  readonly #closeSubscriptions = new Set<() => Promise<void>>();
  #deletionSubscriber: Redis | undefined;
  readonly #deletionListeners = new Map<string, Set<() => void>>();
  #deletionOperations: Promise<void> = Promise.resolve();

  constructor(options: CancelSignalsOptions) {
    if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(options.prefix))
      throw new Error('Invalid cancellation signal configuration');
    this.#prefix = `${options.prefix}:ai-cancel`;
    this.#url = options.url;
    this.#database = options.database;
    this.#runs = options.runs;
    this.#publisher = redis(options.url);
  }

  bind(
    runId: string,
    context: { readonly orgId: string; readonly userId: string },
  ): () => void {
    if (
      !runIdSchema.safeParse(runId).success ||
      !runIdSchema.safeParse(context.orgId).success ||
      !runIdSchema.safeParse(context.userId).success
    )
      throw new Error('Invalid cancellation signal context');
    const current = this.#contexts.get(runId);
    if (
      current &&
      (current.orgId !== context.orgId || current.userId !== context.userId)
    )
      throw new Error('Cancellation signal context conflict');
    const binding = { orgId: context.orgId, userId: context.userId };
    this.#contexts.set(runId, binding);
    return () => {
      if (this.#contexts.get(runId) === binding) this.#contexts.delete(runId);
    };
  }

  async publish(runId: string): Promise<void> {
    if (!runIdSchema.safeParse(runId).success)
      throw new Error('Invalid cancellation signal');
    try {
      if (this.#publisher.status === 'wait') await this.#publisher.connect();
      await this.#publisher.publish(this.#channel(runId), runId);
    } catch {
      throw new Error('Cancellation signal unavailable');
    }
  }

  async publishDeletion(runId: string): Promise<void> {
    if (!runIdSchema.safeParse(runId).success)
      throw new Error('Invalid deletion revocation signal');
    try {
      if (this.#publisher.status === 'wait') await this.#publisher.connect();
      await this.#publisher.publish(this.#deletionChannel(runId), runId);
    } catch {
      throw new Error('Deletion revocation signal unavailable');
    }
  }

  async subscribeDeletion(
    runId: string,
    onDeleted: () => void,
  ): Promise<() => Promise<void>> {
    if (!runIdSchema.safeParse(runId).success)
      throw new Error('Invalid deletion revocation subscription');
    let active = true;
    await this.#serializeDeletion(async () => {
      const subscriber = await this.#getDeletionSubscriber();
      const channel = this.#deletionChannel(runId);
      let listeners = this.#deletionListeners.get(channel);
      const first = !listeners;
      if (!listeners) {
        listeners = new Set();
        this.#deletionListeners.set(channel, listeners);
      }
      listeners.add(onDeleted);
      if (first) {
        try {
          await subscriber.subscribe(channel);
        } catch {
          listeners.delete(onDeleted);
          this.#deletionListeners.delete(channel);
          throw new Error('Deletion revocation subscription unavailable');
        }
      }
    });
    const unsubscribe = async () => {
      if (!active) return;
      active = false;
      await this.#serializeDeletion(async () => {
        const channel = this.#deletionChannel(runId);
        const listeners = this.#deletionListeners.get(channel);
        listeners?.delete(onDeleted);
        if (listeners?.size === 0) {
          this.#deletionListeners.delete(channel);
          try {
            await this.#deletionSubscriber?.unsubscribe(channel);
          } catch {
            // Shared subscriber remains owned until close().
          }
        }
      });
      this.#closeSubscriptions.delete(unsubscribe);
    };
    this.#closeSubscriptions.add(unsubscribe);
    return unsubscribe;
  }

  async subscribe(
    runId: string,
    onCancel: () => void,
  ): Promise<() => Promise<void>> {
    if (!runIdSchema.safeParse(runId).success || !this.#contexts.has(runId))
      throw new Error('Cancellation signal context unavailable');
    const context = this.#contexts.get(runId)!;
    const channelSubscriber = redis(this.#url, true);
    let active = true;
    let fired = false;
    let pollTask = Promise.resolve();
    const fire = () => {
      if (!fired) {
        fired = true;
        onCancel();
      }
    };
    channelSubscriber.on('message', (channel, message) => {
      if (channel === this.#channel(runId) && message === runId) fire();
    });
    try {
      if (channelSubscriber.status === 'wait')
        await channelSubscriber.connect();
      await channelSubscriber.subscribe(this.#channel(runId));
    } catch {
      channelSubscriber.disconnect();
    }
    const poll = async () => {
      if (!active || fired) return;
      try {
        const run = await this.#database.withTenant(
          context,
          (tx) => this.#runs.find(tx, runId),
          { timeoutMs: DATABASE_POLL_TIMEOUT_MS },
        );
        if (run?.status === 'cancelling' || run?.status === 'cancelled') fire();
      } catch {
        // A bounded poll retries on the next tick; it never changes run state.
      }
    };
    pollTask = poll();
    const timer = setInterval(() => {
      pollTask = pollTask.then(poll);
    }, POLL_INTERVAL_MS);
    const unsubscribe = async () => {
      if (!active) return;
      active = false;
      clearInterval(timer);
      await pollTask;
      try {
        await channelSubscriber.unsubscribe(this.#channel(runId));
      } catch {
        // Disconnect below still closes the owned subscriber.
      }
      channelSubscriber.disconnect();
      this.#closeSubscriptions.delete(unsubscribe);
    };
    this.#closeSubscriptions.add(unsubscribe);
    return unsubscribe;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#closeSubscriptions].map((close) => close()));
    await this.#serializeDeletion(async () => {
      this.#deletionListeners.clear();
      this.#deletionSubscriber?.disconnect();
      this.#deletionSubscriber = undefined;
    });
    this.#publisher.disconnect();
    this.#contexts.clear();
  }

  #channel(runId: string): string {
    return `${this.#prefix}:${runId}`;
  }

  #deletionChannel(runId: string): string {
    return `${this.#prefix}:deleted:${runId}`;
  }

  async #getDeletionSubscriber(): Promise<Redis> {
    if (!this.#deletionSubscriber) {
      const subscriber = redis(
        this.#url,
        true,
        `lexon-chat-deletion-revocations:${this.#prefix}`,
      );
      subscriber.on('message', (channel: string, message: string) => {
        if (channel !== this.#deletionChannel(message)) return;
        for (const listener of this.#deletionListeners.get(channel) ?? [])
          listener();
      });
      this.#deletionSubscriber = subscriber;
    }
    const subscriber = this.#deletionSubscriber;
    try {
      if (subscriber.status === 'wait') await subscriber.connect();
    } catch {
      subscriber.disconnect();
      this.#deletionSubscriber = undefined;
      throw new Error('Deletion revocation subscription unavailable');
    }
    return subscriber;
  }

  async #serializeDeletion<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#deletionOperations;
    let release!: () => void;
    this.#deletionOperations = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function redis(
  url: string,
  lazyConnect = true,
  connectionName?: string,
): Redis {
  const client = new Redis(url, {
    lazyConnect,
    ...(connectionName ? { connectionName } : {}),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    retryStrategy: () => null,
    connectTimeout: 500,
    commandTimeout: 500,
  });
  client.on('error', () => undefined);
  return client;
}
