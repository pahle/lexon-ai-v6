import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';

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
