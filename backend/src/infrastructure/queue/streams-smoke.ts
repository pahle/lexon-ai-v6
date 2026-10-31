import { Redis } from 'ioredis';
export async function streamsSmoke(
  url: string,
  prefix: string,
): Promise<boolean> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  const key = `${prefix}:streams-smoke`;
  try {
    const id = await client.xadd(key, 'MAXLEN', '=', 1, '*', 'status', 'ok');
    await client.expire(key, 60);
    const result = await client.xread('COUNT', 1, 'STREAMS', key, '0-0');
    return (
      result?.[0]?.[1]?.[0]?.[0] === id &&
      (await client.xlen(key)) === 1 &&
      (await client.ttl(key)) > 0
    );
  } finally {
    await client.del(key).catch(() => undefined);
    client.disconnect();
  }
}
