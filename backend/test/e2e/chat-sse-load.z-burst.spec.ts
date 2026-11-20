// F4.2 item 27: S2 re-qualification. 500 distinct users, one session each,
// half on run streams and half on chat invalidation streams, in a 30 s ramp
// and in a simultaneous burst, with the API at its Compose limits
// (384 MiB, 0.5 CPU). Sorted after chat-sse-load.spec.ts on purpose: the
// F4.1 gate needs the larger load-test limits, this one lowers them.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';
import { buildBurstResult, parseBurstOptions } from '../load/burst-harness.mjs';

const controlPath = 'backend/test/e2e/chat-load-control.mjs';
const workerControlPath = 'backend/test/e2e/chat-worker-control.mjs';
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Client = { cookie: string; runId?: string };

async function control<T>(api: string, request: Record<string, unknown>) {
  const output = await docker([
    'exec',
    api,
    'node',
    controlPath,
    JSON.stringify(request),
  ]);
  return JSON.parse(output) as T;
}

async function workerStatus(worker: string, runId: string) {
  const output = await docker([
    'exec',
    worker,
    'node',
    workerControlPath,
    'status',
    runId,
  ]);
  return JSON.parse(output) as unknown;
}

async function provision(
  playwright: { request: { newContext(): Promise<APIRequestContext> } },
  apiUrl: string,
  index: number,
): Promise<Client & { origin: string }> {
  const context = await playwright.request.newContext();
  try {
    const headers = await authenticateApi(context, {
      name: `Burst client ${index + 1}`,
    });
    const host = new URL(apiUrl).hostname;
    const cookie = (await context.storageState()).cookies
      .filter((entry) => entry.domain.replace(/^\./u, '') === host)
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    expect(cookie.length).toBeGreaterThan(0);
    return { cookie, origin: headers.origin ?? '' };
  } finally {
    await context.dispose();
  }
}

async function eachLimited<T>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        await work(items[index]!, index);
      }
    }),
  );
}

test('S2 burst: 500 distinct users are all admitted at the Compose limits', async ({
  playwright,
}) => {
  test.setTimeout(1_200_000);
  const options = parseBurstOptions(process.env);
  const stack = descriptor();
  const api = await containerId('api');
  const worker = await containerId('ai-worker');
  await expect
    .poll(() => control(api, { op: 'ready' }).catch(() => null), {
      timeout: 30000,
    })
    .toEqual({ ready: true });

  // Provision while the API still has the load-test limits.
  const clients: Client[] = new Array(options.clients);
  await eachLimited(clients as unknown[], 8, async (_item, index) => {
    const { cookie } = await provision(playwright, stack.apiUrl, index);
    clients[index] = { cookie };
  });
  await eachLimited(clients.slice(0, options.runStreams), 6, async (client) => {
    const response = await fetch(`${stack.apiUrl}/api/chats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: client.cookie,
        origin: stack.publicUrl,
      },
      body: JSON.stringify({
        chatId: randomUUID(),
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Burst run.',
        effort: 'high',
      }),
    });
    expect(response.status).toBe(201);
    client.runId = ((await response.json()) as { runId: string }).runId;
  });
  for (const client of clients.slice(0, options.runStreams))
    await expect
      .poll(() => workerStatus(worker, client.runId!), { timeout: 60000 })
      .toBeNull();

  // The Compose limits of docker-compose.yml: 384 MiB, 0.5 CPU.
  await docker([
    'update',
    '--memory',
    '384m',
    '--memory-swap',
    '384m',
    '--cpus',
    '0.5',
    api,
  ]);
  const limits = (
    await docker([
      'inspect',
      '--format',
      '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}',
      api,
    ])
  ).split('|');
  expect(limits).toEqual([String(384 * 1024 * 1024), '500000000']);

  const results = [];
  for (const mode of options.modes) {
    await control(api, { op: 'burst-metrics', reset: true });
    const firstFrameMs: number[] = [];
    const controller = new AbortController();
    const settled: Promise<void>[] = [];
    clients.forEach((client, index) => {
      const url = client.runId
        ? `${stack.publicUrl}/api/runs/${client.runId}/events`
        : `${stack.publicUrl}/api/chats/events`;
      settled.push(
        (async () => {
          if (mode === 'ramp')
            await delay((index / options.clients) * options.rampSeconds * 1000);
          const begin = performance.now();
          try {
            const response = await fetch(url, {
              headers: {
                accept: 'text/event-stream',
                cookie: client.cookie,
                origin: stack.publicUrl,
              },
              signal: controller.signal,
            });
            if (response.status !== 200 || !response.body) return;
            const reader = response.body.getReader();
            const first = await reader.read();
            if (!first.done) firstFrameMs.push(performance.now() - begin);
            while (!(await reader.read()).done) {
              // Hold the stream until the run ends or the window aborts it.
            }
          } catch {
            // Aborted at the end of the window, or not admitted.
          }
        })(),
      );
    });
    // Hold window: admission plus at least one 5 s revalidation tick.
    const windowMs =
      (mode === 'ramp' ? options.rampSeconds * 1000 : 0) + 25_000;
    await delay(windowMs);
    controller.abort();
    await Promise.all(settled);
    const metrics = await control<{
      waitingMax: number | null;
      waitMs: number[];
      peakRssBytes: number;
    }>(api, { op: 'burst-metrics', reset: true });
    results.push(
      buildBurstResult({
        mode,
        clients: options.clients,
        firstFrameMs,
        rssBytes: [metrics.peakRssBytes],
        authPoolWaitMs: metrics.waitMs,
        poolWaitingMax: metrics.waitingMax,
      }),
    );
    await delay(3000);
  }

  const directory = resolve(
    process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR || 'test-results/f4-chat-load',
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    `${directory}/F4.2-burst.json`,
    `${JSON.stringify({ apiLimits: { memoryMiB: 384, cpus: 0.5 }, results }, null, 2)}\n`,
    { mode: 0o600 },
  );
  for (const result of results)
    expect(result.admitted, `${result.mode} admitted`).toBe(options.clients);
});
