import { expect, it, vi } from 'vitest';
import { checkValkeyPolicy } from '../../src/infrastructure/queue/index.js';
const urls = {
  queueUrl: 'redis://localhost:6379/0',
  streamsUrl: 'redis://localhost:6379/1',
  limiterUrl: 'redis://localhost:6380/0',
};
const valid = [
  'appendfsync',
  'everysec',
  'appendonly',
  'yes',
  'maxmemory-policy',
  'noeviction',
];
it.each([
  ['maxmemory-policy', 'allkeys-lru'],
  ['appendonly', 'no'],
  ['appendfsync', 'always'],
])('rejects invalid %s without exposing details', async (key, value) => {
  const values = [...valid];
  values[values.indexOf(key) + 1] = value!;
  const factory = vi.fn(() => ({
    ping: async () => 'PONG',
    config: async () => values,
    disconnect: vi.fn(),
  }));
  expect(await checkValkeyPolicy(urls, factory)).toEqual({
    queue: 'down',
    streams: 'down',
    limiter: 'down',
  });
});
it('checks distinct targets and closes every client', async () => {
  const disconnect = vi.fn();
  const factory = vi.fn(() => ({
    ping: async () => 'PONG',
    config: async () => valid,
    disconnect,
  }));
  expect(
    await checkValkeyPolicy({ ...urls, streamsUrl: urls.queueUrl }, factory),
  ).toEqual({ queue: 'up', streams: 'up', limiter: 'up' });
  expect(factory).toHaveBeenCalledTimes(2);
  expect(disconnect).toHaveBeenCalledTimes(2);
});
it('returns down on unavailable connections', async () => {
  const factory = () => ({
    ping: async () => {
      throw new Error('secret connection detail');
    },
    config: async () => valid,
    disconnect: vi.fn(),
  });
  expect(await checkValkeyPolicy(urls, factory)).toEqual({
    queue: 'down',
    streams: 'down',
    limiter: 'down',
  });
});

it.each(['0', '734003200', '805306367'])(
  'rejects Streams maxmemory %s against the declared 768 MiB target',
  async (maxmemory) => {
    const factory = (url: string) => ({
      ping: async () => 'PONG',
      config: async (_command: 'GET', ...keys: string[]) => {
        const settings = new Map<string, string>();
        for (let i = 0; i < valid.length; i += 2)
          settings.set(valid[i]!, valid[i + 1]!);
        settings.set(
          'maxmemory',
          url === urls.streamsUrl ? maxmemory : '805306368',
        );
        return keys.flatMap((key) => [key, settings.get(key)!]);
      },
      disconnect: vi.fn(),
    });
    expect(await checkValkeyPolicy(urls, factory, 805_306_368)).toMatchObject({
      queue: 'up',
      streams: 'down',
      limiter: 'up',
    });
  },
);
