import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { RunEventsService } from '../../src/modules/chat/run-events.service.js';
import { StreamHub } from '../../src/infrastructure/queue/stream-hub.js';
import { SseConnectionRegistry } from '../../src/infrastructure/queue/sse-connection-registry.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  AiStepRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { RunStreams } from '../../src/infrastructure/queue/run-streams.js';

test('the owning user can open the authorized run event stream', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-sse-health.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Open the authorized stream',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };

    const response = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const openingFrames = await readUntil(response, 'snapshot-end');
    expect(openingFrames).toContain('"type":"snapshot-start"');
    expect(openingFrames).toContain('"reset":true');
    expect(openingFrames).toContain(`"runId":"${runId}"`);

    const resumed = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: { ...headers, 'last-event-id': '999:9999999999999-0' },
      signal: AbortSignal.timeout(2_000),
    });
    expect(resumed.status).toBe(200);
    const resetFrames = await readUntil(resumed, 'snapshot-end');
    expect(resetFrames).toContain('"type":"snapshot-start"');
    expect(resetFrames).toContain(`"runId":"${runId}"`);

    const missing = await fetch(`${origin}/api/runs/${randomUUID()}/events`, {
      headers,
      signal: AbortSignal.timeout(2_000),
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).not.toContain(
      'text/event-stream',
    );
  } finally {
    await app.close();
  }
});

test('a sequential authorized reconnect resumes from the last actual XADD cursor', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-reconnect-health.json',
      ),
    ),
  );
  const redis = new Redis(services.valkey.streamsUrl);
  let streams: RunStreams | undefined;
  let runId: string | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Reconnect with the actual stream cursor',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    ({ runId } = (await created.json()) as { runId: string });
    const identityResponse = await fetch(`${origin}/api/identity`, { headers });
    const identity = (await identityResponse.json()) as {
      user: { id: string };
      organization: { id: string };
    };
    const database = app.get(TenantDatabase);
    const steps = new AiStepRepository();
    const scope = { orgId: identity.organization.id, userId: identity.user.id };
    const claimed = await database.withTenant(scope, (tx) =>
      steps.claim(tx, {
        runId: runId!,
        sequence: 1,
        expectedVersion: 1,
        leaseMs: 30_000,
      }),
    );
    expect(claimed).not.toBeNull();
    const claim = claimed!.claim;
    streams = new RunStreams({
      url: services.valkey.streamsUrl,
      prefix: services.queuePrefix,
      authority: {
        authorizeActive: (value) =>
          database.withTenant(
            { orgId: value.orgId, userId: value.userId },
            (tx) => steps.streamActiveProof(tx, value),
          ),
        authorizeTerminal: async () => undefined,
        authorizeCommitted: async () => undefined,
        reconcile: async (entries) =>
          entries.map(({ runId: id }) => ({
            runId: id,
            state: 'missing' as const,
          })),
        advanceStreamGeneration: (value, observed) =>
          database.withTenant(
            { orgId: value.orgId, userId: value.userId },
            (tx) => steps.advanceStreamGeneration(tx, value, observed),
          ),
        advanceTerminalStreamGeneration: async () => undefined,
      },
    });
    const event = (delta: string) => ({
      version: 1 as const,
      runId: runId!,
      type: 'text-delta' as const,
      id: runId!,
      delta,
    });
    const prefix = await streams.publishWithCursor(
      claim,
      event('replay prefix'),
    );
    const checkpoint = await streams.publishWithCursor(
      claim,
      event('replay checkpoint'),
    );
    expect(prefix.status).toBe('written');
    expect(checkpoint.status).toBe('written');
    expect(prefix.eventId).toMatch(/^\d+-\d+$/);
    expect(checkpoint.eventId).toMatch(/^\d+-\d+$/);
    const first = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: {
        ...headers,
        'last-event-id': `${prefix.generation}:${prefix.eventId}`,
      },
      signal: AbortSignal.timeout(2_000),
    });
    expect(first.status).toBe(200);
    const firstFrames = await readUntil(first, 'replay checkpoint');
    expect(firstFrames).toContain(
      `id: ${prefix.generation}:${checkpoint.eventId}`,
    );
    expect(firstFrames).toContain('replay checkpoint');
    expect(firstFrames).not.toContain('replay prefix');

    const live = await streams.publishWithCursor(
      claim,
      event('reconnected suffix'),
    );
    expect(live.status).toBe('written');
    const second = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: {
        ...headers,
        'last-event-id': `${checkpoint.generation}:${checkpoint.eventId}`,
      },
      signal: AbortSignal.timeout(2_000),
    });
    expect(second.status).toBe(200);
    const secondFrames = await readUntil(second, 'reconnected suffix');
    expect(secondFrames).toContain(`id: ${live.generation}:${live.eventId}`);
    expect(secondFrames).not.toContain('replay prefix');
    expect(secondFrames).not.toContain('replay checkpoint');
  } finally {
    await streams?.close();
    if (runId) {
      const streamBase = `${services.queuePrefix}:{run-streams}`;
      await redis.zrem(`${streamBase}:active`, runId);
      await redis.hdel(`${streamBase}:contexts`, runId);
      await redis.del(
        `${streamBase}:${runId}:events`,
        `${streamBase}:${runId}:generation`,
        `${streamBase}:${runId}:guard`,
      );
    }
    redis.disconnect();
    await app.close();
  }
});

test('an unauthenticated request to an existing run allocates no SSE reader or lease', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-unauthorized-health.json',
      ),
    ),
  );
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Keep unauthorized streams unopened',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const events = app.get(RunEventsService);
    const connect = vi.spyOn(events, 'connect');
    const response = await fetch(`${origin}/api/runs/${runId}/events`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).not.toContain(
      'text/event-stream',
    );
    expect(connect).not.toHaveBeenCalled();
    expect(
      await redis.keys(`${services.queuePrefix}:{sse-connections}:*`),
    ).toEqual([]);
  } finally {
    redis.disconnect();
    await app.close();
  }
});

test('same-team peers, foreign organizations and deleted runs receive the same non-stream response', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-private-health.json',
      ),
    ),
  );
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const fixture = await createChatFixture(services);
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const peer = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const identity = async (headers: Record<string, string>) =>
      (await (await fetch(`${origin}/api/identity`, { headers })).json()) as {
        user: { id: string };
      };
    const ownerId = (await identity(owner)).user.id;
    const peerId = (await identity(peer)).user.id;
    const team = await organizations.seedTeam([ownerId, peerId]);
    for (const headers of [owner, peer]) {
      const switched = await fetch(`${origin}/api/organizations/active`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: team.id }),
      });
      expect(switched.status).toBe(200);
    }
    const chatId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Keep the event stream owner-private',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const hub = app.get(StreamHub);
    const registry = app.get(SseConnectionRegistry);
    const subscribe = vi.spyOn(hub, 'subscribe');
    const admit = vi.spyOn(registry, 'admit');
    for (const headers of [peer, foreign]) {
      const response = await fetch(`${origin}/api/runs/${runId}/events`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).not.toContain(
        'text/event-stream',
      );
    }
    await fixture.chat.deleteFor({ orgId: team.id, userId: ownerId }, chatId);
    const deleted = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: owner,
      signal: AbortSignal.timeout(2_000),
    });
    expect(deleted.status).toBe(404);
    expect(deleted.headers.get('content-type')).not.toContain(
      'text/event-stream',
    );
    expect(subscribe).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(
      await redis.keys(`${services.queuePrefix}:{sse-connections}:*`),
    ).toEqual([]);
  } finally {
    redis.disconnect();
    await app.close();
    await organizations.close();
    await fixture.close();
  }
});

test('a peer disconnect does not invalidate another same-session stream across renewals', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-sse-peer-health.json'),
    ),
  );
  const controllers: AbortController[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Keep the peer event stream active',
        effort: 'high',
      }),
    });
    const { runId } = (await created.json()) as { runId: string };
    const open = async () => {
      const controller = new AbortController();
      controllers.push(controller);
      return fetch(`${origin}/api/runs/${runId}/events`, {
        headers,
        signal: controller.signal,
      });
    };
    const first = await open();
    const firstReader = first.body!.getReader();
    const second = await open();
    const secondReader = second.body!.getReader();
    await readUntilReader(secondReader, 'snapshot-end', false);
    controllers[0]!.abort();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const outcome = await Promise.race([
      secondReader.read().then(({ done }) => (done ? 'closed' : 'data')),
      new Promise<'pending'>((resolve) =>
        setTimeout(() => resolve('pending'), 200),
      ),
    ]);
    expect(outcome).not.toBe('closed');
    await firstReader.cancel().catch(() => {});
    await secondReader.cancel().catch(() => {});
  } finally {
    for (const controller of controllers) controller.abort();
    await app.close();
  }
});

test('the seventh live SSE connection evicts only the oldest socket', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-sse-limit-health.json'),
    ),
  );
  const controllers: AbortController[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Exercise per-user live stream eviction',
        effort: 'high',
      }),
    });
    const { runId } = (await created.json()) as { runId: string };
    const open = async () => {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${origin}/api/runs/${runId}/events`, {
        headers,
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      readers.push(reader);
      await readUntilReader(reader, 'snapshot-end', false);
    };
    for (let index = 0; index < 6; index++) await open();
    await open();
    const zsetKey = (
      await redis.keys(`${services.queuePrefix}:{sse-connections}:*`)
    ).find((key) => !key.endsWith(':owners') && !key.endsWith(':order'));
    expect(zsetKey).toBeDefined();
    // The registry's oldest lease is the first live request and its stream must terminate.
    const firstClosed = await Promise.race([
      readers[0]!.read().then(({ done }) => done),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);
    expect(firstClosed).toBe(true);
    expect(await redis.zcard(zsetKey!)).toBe(6);
    expect(
      await Promise.race([
        readers[1]!.read().then(({ done }) => done),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 200),
        ),
      ]),
    ).toBe(false);
  } finally {
    for (const controller of controllers) controller.abort();
    for (const reader of readers) await reader.cancel().catch(() => {});
    redis.disconnect();
    await app.close();
  }
});

test('revoking the request session closes its existing run event stream', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-revocation-health.json',
      ),
    ),
  );
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Close the stream after session revocation',
        effort: 'high',
      }),
    });
    const { runId } = (await created.json()) as { runId: string };
    const response = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    await readUntilReader(reader, 'snapshot-end', false);
    const revoked = await fetch(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(revoked.status).toBe(200);
    const closed = await Promise.race([
      reader.read().then(({ done }) => done),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
    expect(closed).toBe(true);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await app.close();
  }
});

test('application shutdown closes active SSE sockets before releasing resources', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-shutdown-health.json',
      ),
    ),
  );
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let appClosed = false;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Close the live socket on server shutdown',
        effort: 'high',
      }),
    });
    const { runId } = (await created.json()) as { runId: string };
    const response = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    await readUntilReader(reader, 'snapshot-end', false);
    await app.close();
    appClosed = true;
    const closed = await Promise.race([
      reader.read().then(({ done }) => done),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    expect(closed).toBe(true);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    if (!appClosed) await app.close();
  }
});

test('organization switch, membership removal and new MFA policy revoke cookie streams while Bearer selection stays independent', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-sse-selection-health.json',
  );
  // The file shares one Valkey limiter namespace across its API applications.
  // Keep the production per-IP signup rule from making these fixture users order-dependent.
  environment.AUTH_RATE_RULES_JSON = JSON.stringify({
    signup: { account: 3, ip: 100, windowSeconds: 600 },
    'verification-resend': { account: 3, ip: 100, windowSeconds: 600 },
  });
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const controllers: AbortController[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const peer = await apiHeaders(app);
    const other = await apiHeaders(app);
    const identity = async (headers: Record<string, string>) =>
      (await (await fetch(`${origin}/api/identity`, { headers })).json()) as {
        user: { id: string };
      };
    const ownerId = (await identity(owner)).user.id;
    const peerId = (await identity(peer)).user.id;
    const otherId = (await identity(other)).user.id;
    const firstTeam = await organizations.seedTeam([ownerId, peerId, otherId]);
    const secondTeam = await organizations.seedTeam([ownerId, peerId, otherId]);
    for (const headers of [owner, peer, other]) {
      expect(
        (
          await fetch(`${origin}/api/organizations/active`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ organizationId: firstTeam.id }),
          })
        ).status,
      ).toBe(200);
    }
    const createRun = async (headers: Record<string, string>, text: string) => {
      const response = await fetch(`${origin}/api/chats`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          chatId: randomUUID(),
          userMessageId: randomUUID(),
          requestId: randomUUID(),
          text,
          effort: 'high',
        }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { runId: string };
    };
    const open = async (runId: string, headers: Record<string, string>) => {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${origin}/api/runs/${runId}/events`, {
        headers,
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      readers.push(reader);
      await readUntilReader(reader, 'snapshot-end', false);
      return reader;
    };
    const waitClosed = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
    ) => {
      const closed = await Promise.race([
        reader.read().then(({ done }) => done),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 2500),
        ),
      ]);
      expect(closed).toBe(true);
    };

    const firstRun = await createRun(
      owner,
      'Revoke after active organization switch',
    );
    const switchedSocket = await open(firstRun.runId, owner);
    expect(
      (
        await fetch(`${origin}/api/organizations/active`, {
          method: 'POST',
          headers: { ...owner, 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: secondTeam.id }),
        })
      ).status,
    ).toBe(200);
    await waitClosed(switchedSocket);

    expect(
      (
        await fetch(`${origin}/api/organizations/active`, {
          method: 'POST',
          headers: { ...owner, 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: firstTeam.id }),
        })
      ).status,
    ).toBe(200);
    const secondRun = await createRun(owner, 'Revoke after membership removal');
    const removedMemberSocket = await open(secondRun.runId, owner);
    const ownerMember = firstTeam.members.find(
      (member) => member.userId === ownerId,
    )!;
    await organizations.mutateMember(ownerMember.id, 'delete');
    await waitClosed(removedMemberSocket);

    const peerRun = await createRun(
      peer,
      'Revoke after organization MFA is required',
    );
    const mfaSocket = await open(peerRun.runId, peer);
    await organizations.setRequire2fa(firstTeam.id, true);
    await waitClosed(mfaSocket);

    await organizations.setRequire2fa(firstTeam.id, false);
    const bearerIssued = await fetch(`${origin}/api/identity/bearer-sessions`, {
      method: 'POST',
      headers: peer,
    });
    expect(bearerIssued.status).toBe(201);
    const { token } = (await bearerIssued.json()) as { token: string };
    const bearerHeaders = {
      authorization: `Bearer ${token}`,
      origin: peer.origin!,
    };
    const bearerSocket = await open(peerRun.runId, bearerHeaders);
    expect(
      (
        await fetch(`${origin}/api/organizations/active`, {
          method: 'POST',
          headers: { ...peer, 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: secondTeam.id }),
        })
      ).status,
    ).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const bearerOutcome = await Promise.race([
      bearerSocket.read().then(({ done }) => (done ? 'closed' : 'data')),
      new Promise<'pending'>((resolve) =>
        setTimeout(() => resolve('pending'), 200),
      ),
    ]);
    expect(bearerOutcome).not.toBe('closed');
  } finally {
    for (const controller of controllers) controller.abort();
    for (const reader of readers) await reader.cancel().catch(() => {});
    await app.close();
    await organizations.close();
  }
});

async function readUntil(response: Response, needle: string): Promise<string> {
  if (!response.body) throw new Error('Run event stream body unavailable');
  const reader = response.body.getReader();
  return readUntilReader(reader, needle);
}

async function readUntilReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  cancel = true,
): Promise<string> {
  const decoder = new TextDecoder();
  let result = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
      if (result.includes(needle)) return result;
    }
  } finally {
    if (cancel) await reader.cancel().catch(() => {});
  }
  throw new Error(`Run event stream did not emit ${needle}`);
}
