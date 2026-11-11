import { AsyncResource } from 'node:async_hooks';
import { Redis } from 'ioredis';

export interface StreamEntry {
  readonly id: string;
  readonly event: string;
  readonly generation?: number;
}

export interface StreamSubscription {
  readonly key: string;
  cursor: string;
  readonly receive: (entry: StreamEntry) => void;
  readonly lineageChanged?: (generation: number | undefined) => void;
}

/** One shared blocking XREAD connection and one shared replay connection. */
export class SseStreamReader {
  readonly #blocking: Redis;
  readonly #replay: Redis;
  readonly #subscriptions = new Map<string, Set<StreamSubscription>>();
  readonly #boundSubscriptions = new WeakMap<
    StreamSubscription,
    StreamSubscription
  >();
  readonly #subscriptionResources = new Map<
    StreamSubscription,
    AsyncResource
  >();
  readonly #cursors = new Map<string, string>();
  readonly #lineages = new Map<string, number | undefined>();
  #replayConnecting: Promise<void> | undefined;
  #running = false;
  #closed = false;

  constructor(url: string) {
    const options = {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      retryStrategy: () => null,
      connectTimeout: 500,
      commandTimeout: 1500,
    };
    this.#blocking = new Redis(url, options);
    this.#replay = new Redis(url, options);
    this.#blocking.on('error', () => undefined);
    this.#replay.on('error', () => undefined);
  }

  async latest(key: string): Promise<string | undefined> {
    try {
      await this.#replayReady();
      const entries = await this.#replay.xrevrange(key, '+', '-', 'COUNT', 1);
      return entries[0]?.[0];
    } catch {
      return undefined;
    }
  }

  async oldest(key: string): Promise<string | undefined> {
    try {
      await this.#replayReady();
      const entries = await this.#replay.xrange(key, '-', '+', 'COUNT', 1);
      return entries[0]?.[0];
    } catch {
      return undefined;
    }
  }

  async generation(key: string): Promise<number | undefined> {
    try {
      await this.#replayReady();
      const value = await this.#replay.get(
        key.replace(/:events$/, ':generation'),
      );
      if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
      const generation = Number(value);
      return Number.isSafeInteger(generation) ? generation : undefined;
    } catch {
      return undefined;
    }
  }

  async contains(key: string, id: string): Promise<boolean> {
    try {
      await this.#replayReady();
      const rows = await this.#replay.xrange(key, id, id, 'COUNT', 1);
      return rows[0]?.[0] === id;
    } catch {
      return false;
    }
  }

  async range(
    key: string,
    after: string,
    through: string,
  ): Promise<readonly StreamEntry[] | undefined> {
    try {
      await this.#replayReady();
      const rows = await this.#replay.xrange(
        key,
        `(${after}`,
        through,
        'COUNT',
        1024,
      );
      return rows.map(([id, fields]) => ({
        id,
        event: fields[fields.indexOf('event') + 1] ?? '',
      }));
    } catch {
      return undefined;
    }
  }

  add(subscription: StreamSubscription): void {
    let registered = this.#boundSubscriptions.get(subscription);
    if (!registered) {
      const resource = new AsyncResource('LexonSseStreamSubscription');
      registered = {
        key: subscription.key,
        get cursor() {
          return subscription.cursor;
        },
        set cursor(value: string) {
          subscription.cursor = value;
        },
        receive: resource.bind((entry: StreamEntry) =>
          subscription.receive(entry),
        ),
        ...(subscription.lineageChanged
          ? {
              lineageChanged: resource.bind((generation: number | undefined) =>
                subscription.lineageChanged!(generation),
              ),
            }
          : {}),
      };
      this.#boundSubscriptions.set(subscription, registered);
      this.#subscriptionResources.set(subscription, resource);
    }
    const set = this.#subscriptions.get(subscription.key) ?? new Set();
    if (set.size)
      registered.cursor = this.#cursors.get(subscription.key) ?? '0-0';
    set.add(registered);
    this.#subscriptions.set(subscription.key, set);
    if (!this.#cursors.has(subscription.key))
      this.#cursors.set(subscription.key, registered.cursor);
    this.#start();
  }

  /** Advance one subscriber after replay; the shared cursor remains at the slowest subscriber. */
  advance(subscription: StreamSubscription, id: string): void {
    const registered =
      this.#boundSubscriptions.get(subscription) ?? subscription;
    if (compareIds(id, registered.cursor) > 0) registered.cursor = id;
    this.#updateSharedCursor(subscription.key);
  }

  remove(subscription: StreamSubscription): void {
    const registered =
      this.#boundSubscriptions.get(subscription) ?? subscription;
    const set = this.#subscriptions.get(subscription.key);
    set?.delete(registered);
    this.#subscriptionResources.get(subscription)?.emitDestroy();
    this.#subscriptionResources.delete(subscription);
    this.#boundSubscriptions.delete(subscription);
    if (!set?.size) {
      this.#subscriptions.delete(subscription.key);
      this.#cursors.delete(subscription.key);
      this.#lineages.delete(subscription.key);
    } else {
      this.#updateSharedCursor(subscription.key);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#subscriptions.clear();
    for (const resource of this.#subscriptionResources.values())
      resource.emitDestroy();
    this.#subscriptionResources.clear();
    this.#cursors.clear();
    this.#lineages.clear();
    this.#blocking.disconnect();
    this.#replay.disconnect();
  }

  #start(): void {
    if (this.#running || this.#closed) return;
    this.#running = true;
    void this.#readLoop();
  }

  async #readLoop(): Promise<void> {
    try {
      if (this.#blocking.status === 'wait' || this.#blocking.status === 'end')
        await this.#blocking.connect();
      while (!this.#closed) {
        const keys = [...this.#subscriptions.keys()];
        if (!keys.length) break;
        const before = await this.#readLineages(keys);
        let changed = false;
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index]!;
          const generation = before[index];
          if (
            this.#lineages.has(key) &&
            this.#lineages.get(key) !== generation
          ) {
            this.#cursors.set(key, '0-0');
            for (const subscription of this.#subscriptions.get(key) ?? []) {
              subscription.cursor = '0-0';
              subscription.lineageChanged?.(generation);
            }
            changed = true;
          }
          this.#lineages.set(key, generation);
        }
        if (changed) continue;
        const ids = keys.map((key) => this.#cursors.get(key) ?? '0-0');
        let result: unknown;
        try {
          result = await this.#blocking.xread(
            'COUNT',
            128,
            'BLOCK',
            1000,
            'STREAMS',
            ...keys,
            ...ids,
          );
        } catch {
          if (!this.#closed)
            await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (!Array.isArray(result)) continue;
        const streams = result as [string, [string, string[]][]][];
        const after = await this.#readLineages(streams.map(([key]) => key));
        let changedDuringRead = false;
        for (let index = 0; index < streams.length; index++) {
          const [key] = streams[index]!;
          const current = after[index];
          if (this.#lineages.get(key) !== current) {
            this.#lineages.set(key, current);
            this.#cursors.set(key, '0-0');
            for (const subscription of this.#subscriptions.get(key) ?? []) {
              subscription.cursor = '0-0';
              subscription.lineageChanged?.(current);
            }
            changedDuringRead = true;
          }
        }
        if (changedDuringRead) continue;
        for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
          const stream = streams[streamIndex]!;
          const [key, rows] = stream;
          const generation = after[streamIndex];
          for (const [id, fields] of rows) {
            const stamped = fields[fields.indexOf('generation') + 1];
            const entryGeneration =
              stamped && /^[1-9]\d*$/.test(stamped)
                ? Number(stamped)
                : undefined;
            if (generation !== undefined && entryGeneration !== generation) {
              this.#cursors.set(key, '0-0');
              for (const subscription of this.#subscriptions.get(key) ?? []) {
                subscription.cursor = '0-0';
                subscription.lineageChanged?.(generation);
              }
              continue;
            }
            const entry = {
              id,
              event: fields[fields.indexOf('event') + 1] ?? '',
              ...(entryGeneration !== undefined &&
              Number.isSafeInteger(entryGeneration)
                ? { generation: entryGeneration }
                : {}),
            };
            for (const subscription of this.#subscriptions.get(key) ?? []) {
              if (compareIds(id, subscription.cursor) <= 0) continue;
              subscription.cursor = id;
              subscription.receive(entry);
            }
            this.#updateSharedCursor(key);
          }
        }
      }
    } catch {
      // A later subscription restarts the bounded reader after a connection failure.
    } finally {
      this.#running = false;
      if (this.#subscriptions.size && !this.#closed) {
        this.#start();
      } else if (!this.#closed && this.#blocking.status !== 'end') {
        this.#blocking.disconnect();
      }
    }
  }

  async #readLineages(
    keys: readonly string[],
  ): Promise<(number | undefined)[]> {
    try {
      await this.#replayReady();
      const values = await this.#replay.mget(
        ...keys.map((key) => key.replace(/:events$/, ':generation')),
      );
      return values.map((value) => {
        if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
        const generation = Number(value);
        return Number.isSafeInteger(generation) ? generation : undefined;
      });
    } catch {
      return keys.map(() => undefined);
    }
  }

  #updateSharedCursor(key: string): void {
    const subscriptions = [...(this.#subscriptions.get(key) ?? [])];
    if (!subscriptions.length) return;
    let minimum = subscriptions[0]!.cursor;
    for (const subscription of subscriptions.slice(1))
      if (compareIds(subscription.cursor, minimum) < 0)
        minimum = subscription.cursor;
    this.#cursors.set(key, minimum);
  }

  async #replayReady(): Promise<void> {
    if (this.#replay.status === 'ready') return;
    if (!this.#replayConnecting) {
      this.#replayConnecting = (async () => {
        if (this.#replay.status === 'wait' || this.#replay.status === 'end') {
          await this.#replay.connect();
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            this.#replay.off('ready', onReady);
            this.#replay.off('error', onError);
          };
          this.#replay.once('ready', onReady);
          this.#replay.once('error', onError);
        });
      })().finally(() => {
        this.#replayConnecting = undefined;
      });
    }
    await this.#replayConnecting;
  }
}

function compareIds(left: string, right: string): number {
  const [leftMs, leftSeq] = left.split('-').map((part) => BigInt(part ?? '0'));
  const [rightMs, rightSeq] = right
    .split('-')
    .map((part) => BigInt(part ?? '0'));
  if (leftMs !== rightMs) return leftMs! < rightMs! ? -1 : 1;
  if (leftSeq !== rightSeq) return leftSeq! < rightSeq! ? -1 : 1;
  return 0;
}
