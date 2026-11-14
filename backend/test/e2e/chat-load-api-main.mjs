import { createServer } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import Redis from 'ioredis';
import { loadRuntimeConfig } from '../../dist/config/runtime-config.js';
import { RunEventsService } from '../../dist/modules/chat/run-events.service.js';
import { IdentityError } from '../../dist/modules/identity-access/identity-error.js';
import { TenantTransactionTimeoutError } from '../../dist/infrastructure/db/tenant-database.js';
import { SseConnectionRegistry } from '../../dist/infrastructure/queue/sse-connection-registry.js';
import { SseStreamReader } from '../../dist/infrastructure/queue/sse-stream-reader.js';
import { StreamHub } from '../../dist/infrastructure/queue/stream-hub.js';

const socketPath = '/run/lexon/health/chat-load-control.sock';
const config = loadRuntimeConfig('api', process.env);
const purposes = [
  'reader',
  'limiter',
  'control',
  'queue',
  'auth',
  'notifications',
  'other',
  'health',
];
let nextClientName = 0;
const originalConnect = Redis.prototype.connect;
Redis.prototype.connect = function (...args) {
  const stack = new Error().stack ?? '';
  const purpose = stack.includes('sse-stream-reader')
    ? 'reader'
    : stack.includes('auth-limiter')
      ? 'limiter'
      : stack.includes('sse-connection-registry') ||
          stack.includes('cancel-signals')
        ? 'control'
        : stack.includes('queue-producer') ||
            stack.includes('run-streams') ||
            stack.includes('step-permits')
          ? 'queue'
          : stack.includes('valkey-policy') ||
              stack.includes('runtime-lifecycle')
            ? 'health'
            : 'other';
  try {
    if (this.options.connectionName !== 'lexon-load-control-observer')
      this.options.connectionName = `lexon-load-${purpose}-${++nextClientName}`;
  } catch {
    // Test-only names are observational and never required for Redis behavior.
  }
  return originalConnect.apply(this, args);
};

const { app } = await import('./auth-api-main.mjs');
const hub = app.get(StreamHub, { strict: false });
const reader = app.get(SseStreamReader, { strict: false });
const registry = app.get(SseConnectionRegistry, { strict: false });
const events = app.get(RunEventsService, { strict: false });
const observer = new Redis(config.valkey.streamsUrl, {
  lazyConnect: true,
  connectionName: 'lexon-load-control-observer',
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
  connectTimeout: 500,
  commandTimeout: 1500,
});
observer.on('error', () => undefined);
await observer.connect();
const observerClientId = Number(await observer.client('ID'));

const owners = [];
const loadRunOwnerIndex = new Map();
function newCauseCounters() {
  return [0, 1].map(() => ({
    renewal: { succeeded: 0, missing: 0, rejected: 0 },
    revalidation: {
      succeeded: 0,
      authRequired: 0,
      auth2faRequired: 0,
      authUnavailable: 0,
      other: 0,
    },
    ownership: { present: 0, missing: 0, errors: 0 },
    snapshot: { present: 0, missing: 0, errors: 0 },
    tenantTransaction: { timeouts: 0, otherErrors: 0 },
  }));
}
let causeCounters = newCauseCounters();

function ownerIndexForUser(userId) {
  const index = owners.indexOf(userId);
  return index < 0 ? undefined : index;
}

function countCause(ownerIndex, group, outcome) {
  if (ownerIndex === undefined) return;
  const counters = causeCounters[ownerIndex]?.[group];
  if (!counters || typeof counters[outcome] !== 'number') return;
  counters[outcome] += 1;
}

function observeCall(receiver, original, args, ownerIndex, onSuccess, onError) {
  let result;
  try {
    result = Reflect.apply(original, receiver, args);
  } catch (error) {
    onError(error, ownerIndex);
    throw error;
  }
  if (!result || typeof result.then !== 'function') {
    onSuccess(result, ownerIndex);
    return result;
  }
  result.then(
    (value) => onSuccess(value, ownerIndex),
    (error) => onError(error, ownerIndex),
  );
  return result;
}

function countTenantTransactionError(error, ownerIndex) {
  countCause(
    ownerIndex,
    'tenantTransaction',
    error instanceof TenantTransactionTimeoutError ? 'timeouts' : 'otherErrors',
  );
}

const originalTenantWithTenant = events.database.withTenant;
events.database.withTenant = function (...args) {
  const ownerIndex = ownerIndexForUser(args[0]?.userId);
  return observeCall(
    this,
    originalTenantWithTenant,
    args,
    ownerIndex,
    () => undefined,
    (error, index) => countTenantTransactionError(error, index),
  );
};

const originalRenew = registry.renew;
registry.renew = function (...args) {
  const ownerIndex = ownerIndexForUser(args[0]?.userId);
  return observeCall(
    this,
    originalRenew,
    args,
    ownerIndex,
    (lease, index) =>
      countCause(index, 'renewal', lease ? 'succeeded' : 'missing'),
    (_error, index) => countCause(index, 'renewal', 'rejected'),
  );
};

const originalRevalidation = events.revalidation;
Object.defineProperty(events, 'revalidation', {
  configurable: true,
  writable: true,
  value: {
    assert(...args) {
      const ownerIndex = ownerIndexForUser(args[0]?.userId);
      return observeCall(
        originalRevalidation,
        originalRevalidation.assert,
        args,
        ownerIndex,
        (_value, index) => countCause(index, 'revalidation', 'succeeded'),
        (error, index) => {
          const outcome =
            error instanceof IdentityError && error.code === 'AUTH_REQUIRED'
              ? 'authRequired'
              : error instanceof IdentityError &&
                  error.code === 'AUTH_2FA_REQUIRED'
                ? 'auth2faRequired'
                : error instanceof IdentityError &&
                    error.code === 'AUTH_UNAVAILABLE'
                  ? 'authUnavailable'
                  : 'other';
          countCause(index, 'revalidation', outcome);
        },
      );
    },
  },
});

const originalExistsForOwnedChat = events.runs.existsForOwnedChat;
events.runs.existsForOwnedChat = function (...args) {
  const ownerIndex = ownerIndexForUser(args[2]);
  return observeCall(
    this,
    originalExistsForOwnedChat,
    args,
    ownerIndex,
    (exists, index) =>
      countCause(index, 'ownership', exists ? 'present' : 'missing'),
    (_error, index) => {
      countCause(index, 'ownership', 'errors');
    },
  );
};

const originalAuthorizedChatSnapshot = events.runs.authorizedChatSnapshot;
events.runs.authorizedChatSnapshot = function (...args) {
  const ownerIndex = ownerIndexForUser(args[2]);
  return observeCall(
    this,
    originalAuthorizedChatSnapshot,
    args,
    ownerIndex,
    (snapshot, index) =>
      countCause(index, 'snapshot', snapshot ? 'present' : 'missing'),
    (_error, index) => {
      countCause(index, 'snapshot', 'errors');
    },
  );
};
const activeReaderEntries = new Set();
const activeReaderOwners = new Map();
let activeHubSubscriptions = 0;
const activeHubSubscriptionsByOwner = [0, 0];
const activeReaderSubscriptionsByOwner = [0, 0];
const closeReasons = {
  evicted: 0,
  revoked: 0,
  slowClient: 0,
  shutdown: 0,
  normal: 0,
};

function ownerIndexForStreamKey(key) {
  const runId = /:\{run-streams\}:([0-9a-f-]{36}):events$/iu.exec(key)?.[1];
  return runId === undefined ? undefined : loadRunOwnerIndex.get(runId);
}

const originalReaderAdd = reader.add.bind(reader);
const originalReaderRemove = reader.remove.bind(reader);
reader.add = (subscription) => {
  if (!activeReaderEntries.has(subscription)) {
    activeReaderEntries.add(subscription);
    const ownerIndex = ownerIndexForStreamKey(subscription.key);
    if (ownerIndex !== undefined) {
      activeReaderOwners.set(subscription, ownerIndex);
      activeReaderSubscriptionsByOwner[ownerIndex] += 1;
    }
  }
  return originalReaderAdd(subscription);
};
reader.remove = (subscription) => {
  if (activeReaderEntries.delete(subscription)) {
    const ownerIndex = activeReaderOwners.get(subscription);
    if (ownerIndex !== undefined) {
      activeReaderOwners.delete(subscription);
      activeReaderSubscriptionsByOwner[ownerIndex] -= 1;
    }
  }
  return originalReaderRemove(subscription);
};
const originalHubSubscribe = hub.subscribe.bind(hub);
hub.subscribe = async (...args) => {
  activeHubSubscriptions += 1;
  const ownerIndex = ownerIndexForStreamKey(String(args[0]));
  if (ownerIndex !== undefined) activeHubSubscriptionsByOwner[ownerIndex] += 1;
  let counted = true;
  const finish = () => {
    if (!counted) return;
    counted = false;
    activeHubSubscriptions -= 1;
    if (ownerIndex !== undefined)
      activeHubSubscriptionsByOwner[ownerIndex] -= 1;
  };
  try {
    const sink = args[2];
    const observedSink = new Proxy(sink, {
      get(target, property, receiver) {
        if (property !== 'close')
          return Reflect.get(target, property, receiver);
        return async (reason) => {
          if (ownerIndex !== undefined) {
            const reasonName =
              reason === 'slow-client'
                ? 'slowClient'
                : reason === undefined
                  ? 'normal'
                  : reason;
            if (Object.hasOwn(closeReasons, reasonName))
              closeReasons[reasonName] += 1;
          }
          return Reflect.get(target, property, target).call(target, reason);
        };
      },
    });
    const subscription = await originalHubSubscribe(
      args[0],
      args[1],
      observedSink,
      ...args.slice(3),
    );
    return {
      close: async () => {
        try {
          await subscription.close();
        } finally {
          finish();
        }
      },
      ...(subscription.revoke
        ? {
            revoke: async () => {
              try {
                await subscription.revoke?.();
              } finally {
                finish();
              }
            },
          }
        : {}),
    };
  } catch (error) {
    finish();
    throw error;
  }
};

const leaseCounts = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local result = {}
for index = 1, 3, 2 do
  local ownerCount = 0
  local members = redis.call('ZRANGE', KEYS[index], 0, -1)
  for _, member in ipairs(members) do
    local value = redis.call('HGET', KEYS[index + 1], member)
    local _, _, expiry = string.match(value or '', '^([^|]+)|([^|]+)|(%d+)$')
    if expiry and tonumber(expiry) > now then ownerCount = ownerCount + 1 end
  end
  table.insert(result, ownerCount)
end
return result
`;
const streamLengths = `
return { redis.call('XLEN', KEYS[1]), redis.call('XLEN', KEYS[2]) }
`;
async function snapshot() {
  if (owners.length !== 2) throw new Error('Owners are not configured');
  const activeLeasesByOwner = (
    await observer.eval(
      leaseCounts,
      4,
      ...owners.flatMap((owner) => [
        `${config.queuePrefix}:{sse-connections}:${owner}`,
        `${config.queuePrefix}:{sse-connections}:${owner}:owners`,
      ]),
    )
  ).map(Number);
  const byPurpose = Object.fromEntries(purposes.map((purpose) => [purpose, 0]));
  const clientList = String(await observer.client('LIST'));
  const lines = clientList.split('\n').filter(Boolean);
  const observerLine = lines.find(
    (line) => Number(/(?:^| )id=(\d+)/u.exec(line)?.[1]) === observerClientId,
  );
  const observerAddress = observerLine
    ? /(?:^| )addr=([^ ]+)/u.exec(observerLine)?.[1]
    : undefined;
  const observerIp = observerAddress
    ? observerAddress.startsWith('[')
      ? observerAddress.slice(1, observerAddress.indexOf(']'))
      : observerAddress.slice(0, observerAddress.lastIndexOf(':'))
    : undefined;
  if (!observerIp) throw new Error('Cannot identify API Valkey clients');
  for (const line of lines) {
    const address = /(?:^| )addr=([^ ]+)/u.exec(line)?.[1];
    const ip = address
      ? address.startsWith('[')
        ? address.slice(1, address.indexOf(']'))
        : address.slice(0, address.lastIndexOf(':'))
      : undefined;
    if (ip !== observerIp) continue;
    if (!line) continue;
    const name = /(?:^| )name=([^ ]*)/u.exec(line)?.[1] ?? '';
    const purpose =
      name === 'lexon-load-control-observer'
        ? 'control'
        : /^lexon-load-(reader|limiter|control|queue|auth|notifications|other|health)-/u.exec(
            name,
          )?.[1];
    byPurpose[purpose ?? (name ? 'other' : 'health')] += 1;
  }
  const cpu = process.cpuUsage();
  return {
    apiContainerPid: process.pid,
    activeSubscriptions: activeHubSubscriptions,
    activeSubscriptionsByOwner: [...activeHubSubscriptionsByOwner],
    activeLeases: activeLeasesByOwner.reduce(
      (total, count) => total + count,
      0,
    ),
    activeLeasesByOwner,
    readerSubscriptions: activeReaderEntries.size,
    readerSubscriptionsByOwner: [...activeReaderSubscriptionsByOwner],
    readerConnections: byPurpose.reader,
    closeReasons: { ...closeReasons },
    valkeyClientsByPurpose: byPurpose,
    causeCounters: causeCounters.map((counter) => ({
      renewal: { ...counter.renewal },
      revalidation: { ...counter.revalidation },
      ownership: { ...counter.ownership },
      snapshot: { ...counter.snapshot },
      tenantTransaction: { ...counter.tenantTransaction },
    })),
    apiMemoryBytes: process.memoryUsage().rss,
    apiCpuMicros: cpu.user + cpu.system,
    config: {
      perUserSseLimit: config.chat.maxConnectionsPerUser,
      globalRunCap: config.ai.maxActive,
      perOrganizationRunCap: config.ai.maxActivePerOrg,
    },
  };
}

await rm(socketPath, { force: true });
const control = createServer((socket) => {
  socket.setEncoding('utf8');
  socket.setTimeout(5000, () => socket.destroy());
  let buffer = '';
  socket.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > 16_384) return socket.destroy();
    if (!buffer.includes('\n')) return;
    try {
      const request = JSON.parse(buffer.split('\n')[0]);
      if (request.op === 'ready') {
        socket.end('{"ready":true}\n');
        return;
      }
      if (request.op === 'set-owners') {
        if (
          !Array.isArray(request.userIds) ||
          request.userIds.length !== 2 ||
          request.userIds.some(
            (id) =>
              typeof id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
                id,
              ),
          )
        )
          throw new Error('Invalid owner identities');
        owners.splice(0, owners.length, ...request.userIds);
        socket.end('{"ok":true}\n');
        return;
      }
      if (
        request.op === 'set-load-runs' &&
        Array.isArray(request.runIds) &&
        request.runIds.length === 2 &&
        request.runIds.every(
          (id) =>
            typeof id === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
              id,
            ),
        )
      ) {
        loadRunOwnerIndex.clear();
        request.runIds.forEach((id, index) => loadRunOwnerIndex.set(id, index));
        causeCounters = newCauseCounters();
        activeHubSubscriptionsByOwner.fill(0);
        activeReaderSubscriptionsByOwner.fill(0);
        Object.keys(closeReasons).forEach((reason) => {
          closeReasons[reason] = 0;
        });
        socket.end('{"ok":true}\n');
        return;
      }
      if (request.op === 'snapshot') {
        socket.end(JSON.stringify(await snapshot()) + '\n');
        return;
      }
      if (
        request.op === 'stream-lengths' &&
        Array.isArray(request.runIds) &&
        request.runIds.length === 2 &&
        request.runIds.every(
          (id) =>
            typeof id === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
              id,
            ),
        )
      ) {
        const lengths = await observer.eval(
          streamLengths,
          2,
          ...request.runIds.map(
            (id) => `${config.queuePrefix}:{run-streams}:${id}:events`,
          ),
        );
        socket.end(JSON.stringify(lengths.map(Number)) + '\n');
        return;
      }
      if (request.op === 'close-runs') {
        if (
          !Array.isArray(request.runIds) ||
          request.runIds.length > 2 ||
          request.runIds.some(
            (id) =>
              typeof id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
                id,
              ),
          )
        )
          throw new Error('Invalid run identities');
        await Promise.all(request.runIds.map((id) => events.closeRun(id)));
        socket.end('{"ok":true}\n');
        return;
      }
      throw new Error('Invalid control operation');
    } catch {
      socket.end('{"error":"invalid chat load control request"}\n');
    }
  });
});
await new Promise((resolve, reject) => {
  control.once('error', reject);
  control.listen(socketPath, resolve);
});
await chmod(socketPath, 0o600);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => control.close(resolve));
  await observer.quit().catch(() => undefined);
  await registry.close().catch(() => undefined);
  await rm(socketPath, { force: true });
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
