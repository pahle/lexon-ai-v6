import { Redis } from 'ioredis';
interface PolicyClient {
  ping(): Promise<string>;
  config(command: 'GET', ...keys: string[]): Promise<unknown>;
  disconnect(): void;
}
interface Targets {
  queueUrl: string;
  streamsUrl: string;
  limiterUrl: string;
}
const connect = (url: string): PolicyClient => {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  return client;
};
export async function checkValkeyPolicy(
  targets: Targets,
  factory: (url: string) => PolicyClient = connect,
  streamsMaxMemoryBytes?: number,
): Promise<{
  queue: 'up' | 'down';
  streams: 'up' | 'down';
  limiter: 'up' | 'down';
}> {
  const results = new Map<string, Promise<'up' | 'down'>>();
  const check = (url: string, streamsTarget = false) => {
    const key = `${url}|${streamsTarget && streamsMaxMemoryBytes !== undefined}`;
    let pending = results.get(key);
    if (!pending) {
      pending = (async () => {
        let client: PolicyClient | undefined;
        try {
          client = factory(url);
          if ((await client.ping()) !== 'PONG') return 'down';
          const values = await client.config(
            'GET',
            'maxmemory-policy',
            'appendonly',
            'appendfsync',
            ...(streamsTarget && streamsMaxMemoryBytes !== undefined
              ? ['maxmemory']
              : []),
          );
          if (!Array.isArray(values)) return 'down';
          const settings = new Map<string, string>();
          for (let i = 0; i < values.length; i += 2)
            settings.set(String(values[i]), String(values[i + 1]));
          return settings.get('maxmemory-policy') === 'noeviction' &&
            settings.get('appendonly') === 'yes' &&
            settings.get('appendfsync') === 'everysec' &&
            (!streamsTarget ||
              streamsMaxMemoryBytes === undefined ||
              (Number.isSafeInteger(streamsMaxMemoryBytes) &&
                streamsMaxMemoryBytes > 0 &&
                settings.get('maxmemory') === String(streamsMaxMemoryBytes)))
            ? 'up'
            : 'down';
        } catch {
          return 'down';
        } finally {
          client?.disconnect();
        }
      })();
      results.set(key, pending);
    }
    return pending;
  };
  const [queue, streams, limiter] = await Promise.all([
    check(targets.queueUrl),
    check(targets.streamsUrl, true),
    check(targets.limiterUrl),
  ]);
  return { queue, streams, limiter };
}
