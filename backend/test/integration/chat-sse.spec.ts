import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment as baseCreateAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { RunEventsService } from '../../src/modules/chat/run-events.service.js';
import {
  StreamHub,
  type SseSink,
} from '../../src/infrastructure/queue/stream-hub.js';
import { SseConnectionRegistry } from '../../src/infrastructure/queue/sse-connection-registry.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createSelectionInspector } from '../../src/infrastructure/db/testing/selection-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  AiRunRepository,
  AiStepRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { RunStreams } from '../../src/infrastructure/queue/run-streams.js';
import { CancelSignals } from '../../src/infrastructure/queue/cancel-signals.js';
import { SseStreamReader } from '../../src/infrastructure/queue/sse-stream-reader.js';
import {
  assertVerifiedIdentity,
  withVerifiedIdentity,
} from '../../src/modules/identity-access/identity.types.js';

const CHAT_SSE_AUTH_RATE_RULES = JSON.stringify({
  signup: { account: 3, ip: 100, windowSeconds: 600 },
  'verification-resend': { account: 3, ip: 100, windowSeconds: 600 },
});

function createSseAuthEnvironment(
  services: Parameters<typeof baseCreateAuthEnvironment>[0],
  healthPath: string,
): Record<string, string> {
  return {
    ...baseCreateAuthEnvironment(services, healthPath),
    AUTH_RATE_RULES_JSON: CHAT_SSE_AUTH_RATE_RULES,
  };
}

test('an unknown stream recovery mode is rejected before SSE admission', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createSseAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-mode-health.json',
      ),
    ),
  );
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
        text: 'Reject an unknown stream recovery mode',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const connect = vi.spyOn(app.get(RunEventsService), 'connect');

    const response = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: { ...headers, 'x-lexon-stream-recovery': 'unknown' },
      signal: AbortSignal.timeout(2_000),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).not.toContain(
      'text/event-stream',
    );
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test('a repaired identity on the first chat SSE request is announced in its first data frame', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createSseAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-identity-fallback-health.json',
      ),
    ),
  );
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const member = await apiHeaders(app);
    const peer = await apiHeaders(app);
    const identity = async (headers: Record<string, string>) =>
      (await (await fetch(`${origin}/api/identity`, { headers })).json()) as {
        user: { id: string };
        organization: { id: string };
      };
    const personalOrgId = (await identity(member)).organization.id;
    const memberId = (await identity(member)).user.id;
    const peerId = (await identity(peer)).user.id;
    const team = await organizations.seedTeam([memberId, peerId]);
    const selected = await fetch(`${origin}/api/organizations/active`, {
      method: 'POST',
      headers: { ...member, 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: team.id }),
    });
    expect(selected.status).toBe(200);
    await organizations.mutateMember(
      team.members.find(({ userId }) => userId === memberId)!.id,
      'delete',
    );

    const response = await fetch(`${origin}/api/chats/events`, {
      headers: member,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-lexon-fallback-reason')).toBe(
      'membership_removed',
    );
    reader = response.body!.getReader();
    const readFirstDataPayload = async (): Promise<unknown> => {
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { value, done } = await reader!.read();
        if (done) return undefined;
        buffered += decoder.decode(value, { stream: true });
        const frames = buffered.split('\n\n');
        buffered = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          try {
            return JSON.parse(dataLine.slice(6)) as unknown;
          } catch {
            return undefined;
          }
        }
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const firstPayload = await Promise.race([
      readFirstDataPayload(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 500);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    const payload =
      typeof firstPayload === 'object' && firstPayload !== null
        ? (firstPayload as Record<string, unknown>)
        : {};
    expect(payload).toMatchObject({
      version: 1,
      type: 'identity-fallback',
      reason: 'membership_removed',
      orgId: personalOrgId,
    });
    expect(Object.keys(payload).sort()).toEqual(
      ['orgId', 'reason', 'type', 'version'].sort(),
    );
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await app.close();
    await organizations.close();
  }
});

test('an in-flight old publication cannot recreate a deleted stream after guard expiry', async ({
  services,
}) => {
  const prefix = `${services.queuePrefix}:delete-guard-expiry`;
  const runId = randomUUID();
  const claim = {
    orgId: randomUUID(),
    userId: randomUUID(),
    runId,
    stepId: randomUUID(),
    sequence: 1,
    expectedVersion: 1,
    fence: 1,
    leaseUntil: new Date(Date.now() + 60_000),
  };
  let enteredAdvance!: () => void;
  let resumeAdvance!: () => void;
  const advanced = new Promise<void>((resolve) => (enteredAdvance = resolve));
  const held = new Promise<void>((resolve) => (resumeAdvance = resolve));
  const authority = {
    authorizeActive: async () => ({
      runVersion: claim.expectedVersion,
      nextSequence: claim.sequence,
      status: 'running' as const,
      stepId: claim.stepId,
      sequence: claim.sequence,
      expectedVersion: claim.expectedVersion,
      fence: claim.fence,
      leaseUntil: claim.leaseUntil,
    }),
    advanceStreamGeneration: async (_claim: unknown, observed: number) => {
      enteredAdvance();
      await held;
      return observed + 1;
    },
    authorizeTerminal: async () => undefined,
    reconcile: async (entries: readonly { runId: string }[]) =>
      entries.map(({ runId: entryRunId }) => ({
        runId: entryRunId,
        state: 'missing' as const,
      })),
  };
  const stalePublisher = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix,
    authority,
  });
  const cleaner = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix,
    authority: { ...authority, authorizeActive: async () => undefined },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const guardKey = `${prefix}:{run-streams}:${runId}:guard`;
  try {
    const oldPublish = stalePublisher.publish(claim, {
      version: 1,
      runId,
      type: 'text-start',
      id: randomUUID(),
    });
    await advanced;
    await cleaner.removeRuns([runId]);
    await redis.pexpire(guardKey, 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    resumeAdvance();

    expect(await oldPublish).not.toBe('written');
    expect(await redis.exists(guardKey)).toBe(0);
    expect(
      await redis.zscore(`${prefix}:{run-streams}:active`, runId),
    ).toBeNull();
    expect(await redis.exists(`${prefix}:{run-streams}:${runId}:events`)).toBe(
      0,
    );
    expect(
      await redis.exists(`${prefix}:{run-streams}:${runId}:generation`),
    ).toBe(0);
    expect(
      await cleaner.publish(claim, {
        version: 1,
        runId,
        type: 'text-start',
        id: randomUUID(),
      }),
    ).toBe('stale');
  } finally {
    resumeAdvance();
    await Promise.all([stalePublisher.close(), cleaner.close(), redis.quit()]);
  }
});

test('the owning user can open the authorized run event stream', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createSseAuthEnvironment(services, '/tmp/lexon-chat-sse-health.json'),
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
      createSseAuthEnvironment(
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

test('a missed deletion publication is checked before a backpressured SSE queue resumes', async ({
  services,
}) => {
  const config = loadRuntimeConfig(
    'api',
    createSseAuthEnvironment(
      services,
      '/tmp/lexon-chat-sse-delete-missed-health.json',
    ),
  );
  const owner = await createTestApi(config);
  const remote = await createTestApi(config);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let releaseDrain!: () => void;
  let signalDrain!: () => void;
  const drainBarrier = new Promise<void>((resolve) => (releaseDrain = resolve));
  const drainReached = new Promise<void>((resolve) => (signalDrain = resolve));
  const writtenCanaries: string[] = [];
  let delivery: Promise<void> | undefined;
  try {
    await owner.listen(0, '127.0.0.1');
    await remote.listen(0, '127.0.0.1');
    const ownerOrigin = await owner.getUrl();
    const remoteOrigin = await remote.getUrl();
    const headers = await apiHeaders(owner);
    const chatId = randomUUID();
    const created = await fetch(`${ownerOrigin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'missed notification recovery proof',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const events = remote.get(RunEventsService);
    const connect = events.connect.bind(events);
    vi.spyOn(events, 'connect').mockImplementation(
      async (actor, runId, lastEventId, sink, identity, recoveryMode) =>
        connect(
          actor,
          runId,
          lastEventId,
          { ...sink, drain: async () => true },
          identity,
          recoveryMode,
        ),
    );
    const hub = remote.get(StreamHub);
    vi.spyOn(hub, 'subscribe').mockImplementation(async (...args) => {
      const sink = args[2]!;
      const gatedSink: SseSink = {
        setRecoveryMode: (mode) => sink.setRecoveryMode?.(mode),
        write: (frame) => {
          if (frame.data.includes('delete-drain-second'))
            writtenCanaries.push('second');
          const writable = sink.write(frame);
          return frame.data.includes('delete-drain-first') ? false : writable;
        },
        drain: (timeoutMs) => sink.drain(timeoutMs),
        close: (reason) => sink.close(reason),
      };
      delivery = (async () => {
        gatedSink.write({ data: ': connected\n\n' });
        gatedSink.write({ data: 'data: delete-drain-first\n\n' });
        signalDrain();
        await drainBarrier;
        const canContinue = await gatedSink.drain(1000);
        if (canContinue)
          gatedSink.write({ data: 'data: delete-drain-second\n\n' });
      })();
      return {
        close: async () => {},
        revoke: async () => {
          await gatedSink.close('revoked');
        },
      };
    });

    const response = await fetch(`${remoteOrigin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    await drainReached;
    let preDeleteFrames = '';
    while (!preDeleteFrames.includes('delete-drain-first')) {
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      preDeleteFrames += new TextDecoder().decode(value);
    }
    vi.spyOn(owner.get(CancelSignals), 'publishDeletion').mockRejectedValueOnce(
      new Error('simulated owner publisher outage'),
    );
    const deleted = await fetch(`${ownerOrigin}/api/chats/${chatId}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleted.status).toBe(204);

    let remainder = '';
    const closes = (async () => {
      for (;;) {
        const { done, value } = await reader!.read();
        if (done) return true;
        remainder += new TextDecoder().decode(value);
      }
    })();
    releaseDrain();
    await delivery;
    expect(writtenCanaries).toEqual([]);
    expect(
      await Promise.race([
        closes,
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 1000),
        ),
      ]),
    ).toBe(true);
    expect(remainder).not.toContain('delete-drain-second');
  } finally {
    releaseDrain();
    await reader?.cancel().catch(() => {});
    await owner.close();
    await remote.close();
  }
});

test('a missed Valkey publication closes a writable remote SSE before later writes', async ({
  services,
}) => {
  const config = loadRuntimeConfig(
    'api',
    createSseAuthEnvironment(
      services,
      '/tmp/lexon-chat-sse-writable-delete-missed-health.json',
    ),
  );
  const owner = await createTestApi(config);
  const remote = await createTestApi(config);
  const fixture = await createChatFixture(services);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let removeAuditFailure: (() => Promise<void>) | undefined;
  let signalStreamReady!: () => void;
  let signalRevoked!: () => void;
  const streamReady = new Promise<void>(
    (resolve) => (signalStreamReady = resolve),
  );
  const revoked = new Promise<void>((resolve) => (signalRevoked = resolve));
  let tryPostDeleteWrite: (() => boolean) | undefined;
  let tryPostRollbackWrite: (() => boolean) | undefined;
  let applicationWrites = 0;
  let postDeleteWritesOnWire = 0;
  let initialWritable: boolean | undefined;
  try {
    await owner.listen(0, '127.0.0.1');
    await remote.listen(0, '127.0.0.1');
    const ownerOrigin = await owner.getUrl();
    const remoteOrigin = await remote.getUrl();
    const headers = await apiHeaders(owner);
    const chatId = randomUUID();
    const created = await fetch(`${ownerOrigin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'writable stream deletion proof',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };

    const events = remote.get(RunEventsService);
    const connect = events.connect.bind(events);
    vi.spyOn(events, 'connect').mockImplementation(
      async (
        actor,
        requestedRunId,
        lastEventId,
        sink,
        identity,
        recoveryMode,
      ) =>
        connect(
          actor,
          requestedRunId,
          lastEventId,
          {
            ...sink,
            write: (frame) => {
              applicationWrites++;
              if (frame.data.includes('post-delete-writable-canary'))
                postDeleteWritesOnWire++;
              return sink.write(frame);
            },
          },
          identity,
          recoveryMode,
        ),
    );

    const hub = remote.get(StreamHub);
    vi.spyOn(hub, 'subscribe').mockImplementation(async (...args) => {
      const sink = args[2]!;
      const liveSink: SseSink = {
        setRecoveryMode: (mode) => sink.setRecoveryMode?.(mode),
        write: (frame) => sink.write(frame),
        drain: (timeoutMs) => sink.drain(timeoutMs),
        close: (reason) => sink.close(reason),
      };
      initialWritable = liveSink.write({ data: ': connected\n\n' });
      liveSink.write({ data: 'data: writable-before-delete\n\n' });
      tryPostDeleteWrite = () =>
        liveSink.write({ data: 'data: post-delete-writable-canary\n\n' });
      tryPostRollbackWrite = () =>
        liveSink.write({ data: 'data: after-rollback-canary\n\n' });
      signalStreamReady();
      return {
        close: async () => {},
        revoke: async () => {
          signalRevoked();
          await liveSink.close('revoked');
        },
      };
    });

    const response = await fetch(`${remoteOrigin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    await streamReady;
    expect(initialWritable).toBe(true);
    let beforeDelete = '';
    while (!beforeDelete.includes('writable-before-delete')) {
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      beforeDelete += new TextDecoder().decode(value);
    }

    removeAuditFailure = await fixture.inspect.failChatDeletionAuditInsert();
    const rolledBack = await fetch(`${ownerOrigin}/api/chats/${chatId}`, {
      method: 'DELETE',
      headers,
    });
    expect(rolledBack.status).toBe(500);
    expect(tryPostRollbackWrite?.()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tryPostRollbackWrite?.()).toBe(true);
    await removeAuditFailure();
    removeAuditFailure = undefined;
    const wireWritesBeforeDelete = applicationWrites;

    vi.spyOn(owner.get(CancelSignals), 'publishDeletion').mockRejectedValueOnce(
      new Error('simulated Valkey deletion publication outage'),
    );
    const deleted = await fetch(`${ownerOrigin}/api/chats/${chatId}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleted.status).toBe(204);

    const revocationArrived = await Promise.race([
      revoked.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    if (!revocationArrived) expect(tryPostDeleteWrite?.()).toBe(false);
    expect(revocationArrived).toBe(true);
    expect(applicationWrites).toBe(wireWritesBeforeDelete);
    expect(tryPostDeleteWrite?.()).toBe(false);
    expect(postDeleteWritesOnWire).toBe(0);

    const closed = await Promise.race([
      (async () => {
        for (;;) {
          const { done } = await reader!.read();
          if (done) return true;
        }
      })(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(closed).toBe(true);
  } finally {
    await removeAuditFailure?.();
    await reader?.cancel().catch(() => {});
    await owner.close();
    await remote.close();
    await fixture.close();
  }
});

test('shared Valkey reader callbacks run in the verified identity scope of their owning subscriber', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const firstFacts = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    activeOrganizationId: randomUUID(),
    channel: 'cookie' as const,
    platformAdmin: false,
    mfaVerifiedAt: null,
    reauthenticatedAt: null,
  };
  const secondFacts = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    activeOrganizationId: randomUUID(),
    channel: 'cookie' as const,
    platformAdmin: false,
    mfaVerifiedAt: null,
    reauthenticatedAt: null,
  };
  const firstKey = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const secondKey = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const firstGenerationKey = firstKey.replace(/:events$/, ':generation');
  const secondGenerationKey = secondKey.replace(/:events$/, ':generation');
  let firstSubscription: Parameters<typeof reader.add>[0] | undefined;
  let firstCallbackObserved!: () => void;
  const firstCallback = new Promise<void>((resolve) => {
    firstCallbackObserved = resolve;
  });
  let secondCallbackObserved!: () => void;
  const secondCallback = new Promise<void>((resolve) => {
    secondCallbackObserved = resolve;
  });
  let secondIdentityVerified = false;
  let secondIdentityErrorCode: string | undefined;
  try {
    await redis.set(firstGenerationKey, '1');
    await redis.set(secondGenerationKey, '1');
    await withVerifiedIdentity(firstFacts, async (firstIdentity) => {
      firstSubscription = {
        key: firstKey,
        cursor: '0-0',
        receive: () => {
          assertVerifiedIdentity(firstIdentity);
          firstCallbackObserved();
        },
      };
      reader.add(firstSubscription);
      await redis.xadd(
        firstKey,
        '*',
        'event',
        JSON.stringify({ type: 'first' }),
        'generation',
        '1',
      );
      await firstCallback;
    });

    await withVerifiedIdentity(secondFacts, async (secondIdentity) => {
      const secondSubscription = {
        key: secondKey,
        cursor: '0-0',
        receive: () => {
          try {
            assertVerifiedIdentity(secondIdentity);
            secondIdentityVerified = true;
          } catch (error) {
            secondIdentityErrorCode =
              typeof error === 'object' && error !== null && 'code' in error
                ? String((error as { code: unknown }).code)
                : 'unknown';
          }
          secondCallbackObserved();
        },
      };
      reader.add(secondSubscription);
      if (firstSubscription) reader.remove(firstSubscription);
      await redis.xadd(
        secondKey,
        '*',
        'event',
        JSON.stringify({ type: 'second' }),
        'generation',
        '1',
      );
      await secondCallback;
      expect({ secondIdentityVerified, secondIdentityErrorCode }).toEqual({
        secondIdentityVerified: true,
        secondIdentityErrorCode: undefined,
      });
      reader.remove(secondSubscription);
    });
  } finally {
    if (firstSubscription) reader.remove(firstSubscription);
    await reader.close();
    redis.disconnect();
  }
});

test('an unauthenticated request to an existing run allocates no SSE reader or lease', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createSseAuthEnvironment(
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
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string } };
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
      await redis.keys(
        `${services.queuePrefix}:{sse-connections}:${identity.user.id}*`,
      ),
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
      createSseAuthEnvironment(
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
    const foreignId = (await identity(foreign)).user.id;
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
      (
        await Promise.all(
          [ownerId, peerId, foreignId].map((userId) =>
            redis.keys(`${services.queuePrefix}:{sse-connections}:${userId}*`),
          ),
        )
      ).flat(),
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
      createSseAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-peer-health.json',
      ),
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

test('same-session snapshot-only subscribers share the bounded authorized PG reload', async ({
  services,
}) => {
  const environment = createSseAuthEnvironment(
    services,
    '/tmp/lexon-chat-sse-snapshot-cache-health.json',
  );
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const controllers: AbortController[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const snapshotRead = vi.spyOn(
    AiRunRepository.prototype,
    'authorizedChatSnapshot',
  );
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
        text: 'Share authorized recovery reads across my live streams',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const open = async () => {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${origin}/api/runs/${runId}/events`, {
        headers,
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      if (!response.body) throw new Error('Run event stream body unavailable');
      const reader = response.body.getReader();
      readers.push(reader);
      await readUntilReader(reader, 'snapshot-end', false);
    };
    await open();
    await open();
    // Each connection reads once for its initial authorization and once after
    // the deletion revocation subscription is active.
    expect(snapshotRead).toHaveBeenCalledTimes(4);
    snapshotRead.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(snapshotRead).toHaveBeenCalledTimes(1);
  } finally {
    for (const controller of controllers) controller.abort();
    for (const reader of readers) await reader.cancel().catch(() => {});
    snapshotRead.mockRestore();
    await app.close();
  }
});

test('the seventh live SSE connection evicts only the oldest socket', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createSseAuthEnvironment(
        services,
        '/tmp/lexon-chat-sse-limit-health.json',
      ),
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
  const environment = createSseAuthEnvironment(
    services,
    '/tmp/lexon-chat-sse-revocation-health.json',
  );
  const app = await createTestApi(loadRuntimeConfig('api', environment));
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

test('expiring the request cookie session closes its existing run event stream', async ({
  services,
}) => {
  const environment = createSseAuthEnvironment(
    services,
    '/tmp/lexon-chat-sse-expiry-health.json',
  );
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const inspector = createSelectionInspector(services);
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
        text: 'Close the stream after cookie expiry',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    const response = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    await readUntilReader(reader, 'snapshot-end', false);

    const sessionsResponse = await fetch(`${origin}/api/identity/sessions`, {
      headers,
    });
    expect(sessionsResponse.status).toBe(200);
    const sessions = (await sessionsResponse.json()) as Array<{
      channel: string;
      current: boolean;
      id: string;
    }>;
    const currentSession = sessions.find((session) => session.current);
    expect(currentSession).toMatchObject({ channel: 'cookie', current: true });
    if (!currentSession)
      throw new Error('Current cookie session was not listed');

    await inspector.ageExpiry(currentSession.id, -1);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const eof = (async () => {
      for (;;) {
        const { done } = await reader!.read();
        if (done) return true;
      }
    })().catch(() => false);
    const closed = await Promise.race([
      eof,
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), 2_500);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    expect(closed).toBe(true);

    const rejected = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers,
      signal: AbortSignal.timeout(2_000),
    });
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get('content-type')).not.toContain(
      'text/event-stream',
    );
    const safeError = await rejected.text();
    expect(safeError).not.toContain('Close the stream after cookie expiry');
    expect(safeError).not.toContain(runId);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    try {
      await inspector.close();
    } finally {
      await app.close();
    }
  }
});

test('application shutdown closes active SSE sockets before releasing resources', async ({
  services,
}) => {
  const environment = createSseAuthEnvironment(
    services,
    '/tmp/lexon-chat-sse-shutdown-health.json',
  );
  const app = await createTestApi(loadRuntimeConfig('api', environment));
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
  const environment = createSseAuthEnvironment(
    services,
    '/tmp/lexon-chat-sse-selection-health.json',
  );
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
