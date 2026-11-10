import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export interface SseConnectionLease {
  readonly userId: string;
  readonly connectionId: string;
  readonly processId: string;
  readonly ownerToken: string;
  readonly admittedAt: number;
  readonly expiresAt: number;
}

export interface EvictedSseConnection {
  readonly connectionId: string;
  readonly processId: string;
  readonly ownerToken: string;
}

const ADMIT = `
local limit = tonumber(ARGV[1])
local leaseMs = tonumber(ARGV[2])
local id = ARGV[3]
local process = ARGV[4]
local token = ARGV[5]
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expiry = now + leaseMs
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, member in ipairs(members) do
  local value = redis.call('HGET', KEYS[2], member)
  local owner, ownerToken, ownerExpiry = string.match(value or '', '^([^|]+)|([^|]+)|(%d+)$')
  if not ownerExpiry or tonumber(ownerExpiry) <= now then
    redis.call('ZREM', KEYS[1], member)
    redis.call('HDEL', KEYS[2], member)
  end
end
local evicted = {}
if redis.call('ZCARD', KEYS[1]) >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0)[1]
  local value = redis.call('HGET', KEYS[2], oldest)
  local owner, ownerToken = string.match(value or '', '^([^|]+)|([^|]+)|%d+$')
  evicted = {oldest or '', owner or '', ownerToken or ''}
  redis.call('ZREM', KEYS[1], oldest)
  redis.call('HDEL', KEYS[2], oldest)
end
local order = redis.call('INCR', KEYS[3])
redis.call('ZADD', KEYS[1], order, id)
redis.call('HSET', KEYS[2], id, process .. '|' .. token .. '|' .. expiry)
local ttl = leaseMs * 3
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('PEXPIRE', KEYS[3], ttl)
return {evicted[1] or '', evicted[2] or '', evicted[3] or '', now, expiry}
`;

const RENEW = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local value = redis.call('HGET', KEYS[2], ARGV[1])
local process, token, expiry = string.match(value or '', '^([^|]+)|([^|]+)|(%d+)$')
if token ~= ARGV[2] or not expiry or tonumber(expiry) <= now then return 0 end
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
local leaseMs = tonumber(ARGV[3])
local newExpiry = now + leaseMs
redis.call('HSET', KEYS[2], ARGV[1], process .. '|' .. token .. '|' .. newExpiry)
local ttl = leaseMs * 3
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('PEXPIRE', KEYS[3], ttl)
return {now, newExpiry}
`;

const RELEASE = `
local value = redis.call('HGET', KEYS[2], ARGV[1])
local token = string.match(value or '', '^[^|]+|([^|]+)|%d+$')
if token ~= ARGV[2] then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
end
return 1
`;

/** Cross-process per-user admission with owner-token-fenced renew and release. */
export class SseConnectionRegistry {
  readonly #client: Redis;
  readonly #prefix: string;
  #connecting: Promise<void> | undefined;

  constructor(
    url: string,
    prefix: string,
    private readonly leaseMs = 3000,
  ) {
    this.#prefix = `${prefix}:{sse-connections}`;
    this.#client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      connectTimeout: 500,
      commandTimeout: 1000,
    });
    this.#client.on('error', () => undefined);
  }

  async admit(
    userId: string,
    connectionId: string,
    processId: string,
    limit: number,
  ): Promise<{
    readonly lease: SseConnectionLease;
    readonly evicted?: EvictedSseConnection;
  }> {
    if (
      !uuid(userId) ||
      !uuid(connectionId) ||
      !uuid(processId) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 512
    )
      throw new Error('Invalid SSE connection admission');
    const ownerToken = randomUUID();
    await this.#ready();
    const raw = (await this.#client.eval(
      ADMIT,
      3,
      this.#userKey(userId),
      this.#ownersKey(userId),
      this.#counterKey(userId),
      String(limit),
      String(this.leaseMs),
      connectionId,
      processId,
      ownerToken,
    )) as [string, string, string, number | string, number | string];
    const admittedAt = Number(raw[3]);
    const expiresAt = Number(raw[4]);
    return {
      lease: {
        userId,
        connectionId,
        processId,
        ownerToken,
        admittedAt,
        expiresAt,
      },
      ...(raw?.[0]
        ? {
            evicted: {
              connectionId: raw[0],
              processId: raw[1]!,
              ownerToken: raw[2]!,
            },
          }
        : {}),
    };
  }

  async renew(
    lease: SseConnectionLease,
  ): Promise<SseConnectionLease | undefined> {
    await this.#ready();
    const ok = await this.#client.eval(
      RENEW,
      3,
      this.#userKey(lease.userId),
      this.#ownersKey(lease.userId),
      this.#counterKey(lease.userId),
      lease.connectionId,
      lease.ownerToken,
      String(this.leaseMs),
    );
    if (!Array.isArray(ok)) return undefined;
    return { ...lease, expiresAt: Number(ok[1]) };
  }

  async release(lease: SseConnectionLease): Promise<boolean> {
    await this.#ready();
    const result = await this.#client.eval(
      RELEASE,
      3,
      this.#userKey(lease.userId),
      this.#ownersKey(lease.userId),
      this.#counterKey(lease.userId),
      lease.connectionId,
      lease.ownerToken,
    );
    return Number(result) === 1;
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }

  async #ready(): Promise<void> {
    if (this.#client.status === 'ready') return;
    if (!this.#connecting) {
      this.#connecting = (async () => {
        if (this.#client.status === 'wait' || this.#client.status === 'end') {
          await this.#client.connect();
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
            this.#client.off('ready', onReady);
            this.#client.off('error', onError);
          };
          this.#client.once('ready', onReady);
          this.#client.once('error', onError);
        });
      })().finally(() => {
        this.#connecting = undefined;
      });
    }
    await this.#connecting;
  }

  #userKey(userId: string): string {
    return `${this.#prefix}:${userId}`;
  }
  #ownersKey(userId: string): string {
    return `${this.#prefix}:${userId}:owners`;
  }
  #counterKey(userId: string): string {
    return `${this.#prefix}:${userId}:order`;
  }
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
