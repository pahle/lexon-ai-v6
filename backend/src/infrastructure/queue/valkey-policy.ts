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
): Promise<{
  queue: 'up' | 'down';
  streams: 'up' | 'down';
  limiter: 'up' | 'down';
}> {
  const results = new Map<string, Promise<'up' | 'down'>>();
  const check = (url: string) => {
    let pending = results.get(url);
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
          );
          if (!Array.isArray(values)) return 'down';
          const settings = new Map<string, string>();
          for (let i = 0; i < values.length; i += 2)
            settings.set(String(values[i]), String(values[i + 1]));
          return settings.get('maxmemory-policy') === 'noeviction' &&
            settings.get('appendonly') === 'yes' &&
            settings.get('appendfsync') === 'everysec'
            ? 'up'
            : 'down';
        } catch {
          return 'down';
        } finally {
          client?.disconnect();
        }
      })();
      results.set(url, pending);
    }
    return pending;
  };
  const [queue, streams, limiter] = await Promise.all([
    check(targets.queueUrl),
    check(targets.streamsUrl),
    check(targets.limiterUrl),
  ]);
  return { queue, streams, limiter };
}
