import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { containerId, descriptor, docker } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';

test('public API path reaches the backend with its original path', async () => {
  const response = await fetch(
    descriptor().publicUrl + '/api/e2e/chat-routing/probe?source=caddy',
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('x-lexon-test-backend')).toBe('api');
  expect(await response.json()).toEqual({
    path: '/api/e2e/chat-routing/probe?source=caddy',
  });
});

test('Caddy flushes a finite SSE frame while the backend end barrier remains closed', async () => {
  const { publicUrl } = descriptor();
  const probeId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let releaseUrl: string | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decode = new TextDecoder();
  try {
    const response = await fetch(
      `${publicUrl}/api/e2e/chat-routing/events/${probeId}`,
      {
        headers: {
          'last-event-id': 'frame-before-reconnect',
          cookie: 'routing=probe',
        },
        signal: controller.signal,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    reader = response.body!.getReader();
    const firstFrame = await reader.read();
    expect(decode.decode(firstFrame.value)).toContain('data: frame A');

    const controlUrl = `${publicUrl}/api/e2e/chat-routing/control/${probeId}`;
    releaseUrl = `${publicUrl}/api/e2e/chat-routing/release/${probeId}`;
    const held = await (await fetch(controlUrl)).json();
    expect(held).toEqual({
      started: true,
      released: false,
      ended: false,
      lastEventId: 'frame-before-reconnect',
      cookiePresent: true,
    });

    expect((await fetch(releaseUrl, { method: 'POST' })).status).toBe(204);
    const remainder: string[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remainder.push(decode.decode(chunk.value));
    }
    expect(remainder.join('')).toContain('data: frame B');
    expect((await (await fetch(controlUrl)).json()).ended).toBe(true);
  } finally {
    clearTimeout(timer);
    if (releaseUrl) await fetch(releaseUrl, { method: 'POST' }).catch(() => {});
    await reader?.cancel().catch(() => {});
    controller.abort();
  }
});

test('Caddy replays an authorized run from Last-Event-ID and flushes a later live frame', async ({
  request,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(request);
  const workerId = await containerId('ai-worker');
  const postgresId = await containerId('postgres');
  const valkeyId = await containerId('valkey');
  const queuePrefix = process.env.QUEUE_PREFIX ?? 'bull';
  let runId: string | undefined;
  let streamKey: string | undefined;
  let orgId: string | undefined;
  let userId: string | undefined;
  let paused = false;
  const valkey = (...args: string[]) =>
    docker([
      'exec',
      valkeyId,
      'sh',
      '-c',
      'export REDISCLI_AUTH="$VALKEY_PASSWORD"; exec valkey-cli "$@"',
      'valkey-cli',
      ...args,
    ]);
  const psql = (sql: string) =>
    docker([
      'exec',
      postgresId,
      'sh',
      '-c',
      'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql "$@"',
      'psql',
      '-U',
      'postgres',
      '-d',
      'lexon',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ]);
  try {
    await docker(['pause', workerId]);
    paused = true;
    const created = await request.post(`${stack.apiUrl}/api/chats`, {
      headers: { ...headers, 'content-type': 'application/json' },
      data: {
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Verify the authorized event stream through Caddy',
        effort: 'high',
      },
    });
    expect(created.status()).toBe(201);
    ({ runId } = (await created.json()) as { runId: string });
    streamKey = `${queuePrefix}:{run-streams}:${runId}:events`;
    const identityResponse = await request.get(`${stack.apiUrl}/api/identity`);
    expect(identityResponse.status()).toBe(200);
    const identity = (await identityResponse.json()) as {
      user: { id: string };
      organization: { id: string };
    };
    orgId = identity.organization.id;
    userId = identity.user.id;
    const seedRun = await psql(
      `BEGIN; SET LOCAL ROLE lexon_migrator; SELECT set_config('app.org_id','${orgId}',true),set_config('app.user_id','${userId}',true); UPDATE app.ai_runs SET stream_generation=1 WHERE id='${runId}' AND org_id='${orgId}' AND initiating_user_id='${userId}' AND status='queued' AND stream_generation=0; COMMIT;`,
    );
    expect(seedRun).toContain('UPDATE 1');
    await valkey('SET', streamKey.replace(/:events$/, ':generation'), '1');
    const prefixId = await valkey(
      'XADD',
      streamKey,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'caddy replay prefix' }),
      'generation',
      '1',
    );
    const suffixId = await valkey(
      'XADD',
      streamKey,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'caddy replay suffix' }),
      'generation',
      '1',
    );
    expect(prefixId).toMatch(/^\d+-\d+$/);
    expect(suffixId).toMatch(/^\d+-\d+$/);

    const state = await request.storageState();
    const apiHost = new URL(stack.apiUrl).hostname;
    const cookie = state.cookies
      .filter((entry) => entry.domain.replace(/^\./, '') === apiHost)
      .map((entry) => `${entry.name}=${entry.value}`)
      .join('; ');
    expect(cookie).not.toBe('');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(
        `${stack.publicUrl}/api/runs/${runId}/events`,
        {
          headers: {
            cookie,
            origin: stack.frontendUrl,
            'last-event-id': `1:${prefixId}`,
          },
          signal: controller.signal,
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      bodyReader = response.body?.getReader();
      if (!bodyReader) throw new Error('Caddy SSE body unavailable');
      let replay = '';
      while (!replay.includes('caddy replay suffix')) {
        const { value, done } = await bodyReader.read();
        if (done) throw new Error('Caddy SSE ended before the replay suffix');
        replay += new TextDecoder().decode(value, { stream: true });
      }
      expect(replay).toContain(`id: 1:${suffixId}`);
      expect(replay).not.toContain('caddy replay prefix');
      const liveId = await valkey(
        'XADD',
        streamKey,
        '*',
        'event',
        JSON.stringify({ type: 'text-delta', delta: 'caddy live suffix' }),
        'generation',
        '1',
      );
      let liveFrames = replay;
      while (!liveFrames.includes('caddy live suffix')) {
        const { value, done } = await bodyReader.read();
        if (done)
          throw new Error(
            `Caddy SSE ended before the live suffix (${liveFrames})`,
          );
        liveFrames += new TextDecoder().decode(value, { stream: true });
      }
      expect(liveFrames).toContain(`id: 1:${liveId}`);
      expect(liveFrames).not.toContain('caddy replay prefix');
    } finally {
      clearTimeout(timer);
      await bodyReader?.cancel().catch(() => {});
      controller.abort();
    }
  } finally {
    if (runId && streamKey && orgId && userId) {
      await valkey(
        'DEL',
        streamKey,
        streamKey.replace(/:events$/, ':generation'),
      ).catch(() => {});
      await psql(
        `BEGIN; SET LOCAL ROLE lexon_migrator; SELECT set_config('app.org_id','${orgId}',true),set_config('app.user_id','${userId}',true); UPDATE app.ai_runs SET stream_generation=0 WHERE id='${runId}' AND org_id='${orgId}' AND initiating_user_id='${userId}' AND status='queued' AND stream_generation=1; COMMIT;`,
      ).catch(() => {});
    }
    if (paused) await docker(['unpause', workerId]).catch(() => {});
  }
});

test('F1 origin and client-address spoof rejection remains in force through Caddy', async () => {
  const { publicUrl } = descriptor();
  const rejected = await fetch(`${publicUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://spoofed.example.test',
      'x-forwarded-for': '198.51.100.77',
      'x-real-ip': '198.51.100.77',
    },
    body: '{}',
  });
  expect(rejected.status).toBe(403);

  const ordinary = await fetch(
    `${publicUrl}/api/e2e/chat-routing/client-address`,
  );
  const forged = await fetch(
    `${publicUrl}/api/e2e/chat-routing/client-address`,
    {
      headers: {
        'x-forwarded-for': '198.51.100.77',
        'x-real-ip': '198.51.100.77',
      },
    },
  );
  expect(ordinary.status).toBe(200);
  expect(forged.status).toBe(200);
  expect(await forged.json()).toEqual(await ordinary.json());
});
