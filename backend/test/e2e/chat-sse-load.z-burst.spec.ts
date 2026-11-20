// F4.2 item 27: S2 re-qualification. 500 distinct users, one session each:
// 24 live run streams (the global active-run cap, held open by the scripted
// worker's hold prompt for the whole measurement) and 476 chat invalidation
// streams, in a 30 s ramp and in a simultaneous burst, with the API at its
// Compose limits (384 MiB, 0.5 CPU). Primary evidence is the server-side
// count of open SSE connections at peak. Completed-run attach is measured as
// replay latency only and never counted as a concurrent connection.
// Sorted after chat-sse-load.spec.ts on purpose: the F4.1 gate needs the
// larger load-test limits, this one lowers them.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';
import {
  buildBurstResult,
  drainBoundMs,
  isCapacityRefusal,
  parseBurstOptions,
  percentile,
} from '../load/burst-harness.mjs';

const controlPath = 'backend/test/e2e/chat-load-control.mjs';
const workerControlPath = 'backend/test/e2e/chat-worker-control.mjs';
// Worker concurrency of ai-interactive (the held runs drain in waves of it).
const WORKER_CONCURRENCY = 4;
const RUN_ADMISSION_MS = 60_000;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Client = { cookie: string; runId?: string };

// The API runs at 0.5 CPU while the window closes; the control socket can miss
// its 6 s reply deadline then, so a read is retried (never a state change:
// only reads and the idempotent start-of-mode reset go through here).
async function control<T>(api: string, request: Record<string, unknown>) {
  let failure: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const output = await docker([
        'exec',
        api,
        'node',
        controlPath,
        JSON.stringify(request),
      ]);
      return JSON.parse(output) as T;
    } catch (error) {
      failure = error;
      await delay(2000);
    }
  }
  throw failure;
}

async function workerRelease(worker: string, runId: string) {
  for (const op of ['release-prefix', 'release'])
    await docker(['exec', worker, 'node', workerControlPath, op, runId]).catch(
      () => undefined,
    );
}

const ACTIVE = "('queued','running','awaiting_approval','cancelling')";

async function psql(postgres: string, sql: string) {
  return docker([
    'exec',
    postgres,
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
    '-At',
    '-c',
    sql,
  ]);
}

// Active runs as the capacity trigger counts them (ops.ai_run_slots).
async function activeRuns(postgres: string) {
  return Number(await psql(postgres, 'SELECT count(*) FROM ops.ai_run_slots'));
}

async function activeRunStatuses(postgres: string) {
  return psql(
    postgres,
    `SELECT status || ':' || count(*) FROM app.ai_runs WHERE status IN ${ACTIVE} GROUP BY status ORDER BY status`,
  );
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

type Sse = { open: number | null; peak: number | null };
type Metrics = {
  waitingMax: number | null;
  waitP95Ms: number | null;
  waitCount: number;
  peakRssBytes: number;
  sse: Sse;
};

test('S2 burst: 500 distinct users are all admitted at the Compose limits', async ({
  playwright,
}) => {
  test.setTimeout(1_200_000);
  const options = parseBurstOptions(process.env);
  const stack = descriptor();
  const api = await containerId('api');
  const worker = await containerId('ai-worker');
  const postgres = await containerId('postgres');
  await expect
    .poll(() => control(api, { op: 'ready' }).catch(() => null), {
      timeout: 30000,
    })
    .toEqual({ ready: true });

  // Diagnostic for the capacity wait below: what was already active when the
  // burst started (leftovers of the F4.1 load spec in the same stack).
  const activeAtStart = {
    slots: await activeRuns(postgres),
    statuses: await activeRunStatuses(postgres),
  };

  // Provision while the API still has the load-test limits.
  const clients: Client[] = new Array(options.clients);
  await eachLimited(clients as unknown[], 8, async (_item, index) => {
    const { cookie } = await provision(playwright, stack.apiUrl, index);
    clients[index] = { cookie };
  });

  // Live run streams: a run is created only while the active runs in the
  // database are below the cap; a 503 AI_CAPACITY_EXCEEDED waits and retries.
  // Every run carries the hold prompt, so it stays active until released.
  const capacity = 24;
  const setupDeadline = Date.now() + 240_000;
  let capacityRetries = 0;
  await eachLimited(
    clients.slice(0, options.heldRuns),
    4,
    async (client, i) => {
      const runDeadline = Date.now() + RUN_ADMISSION_MS;
      let backoffMs = 250;
      for (;;) {
        if (Date.now() > setupDeadline || Date.now() > runDeadline)
          throw new Error(
            `Held run ${i} was not admitted within ${RUN_ADMISSION_MS} ms (${capacityRetries} capacity retries)`,
          );
        if ((await activeRuns(postgres)) >= capacity) {
          await delay(500);
          continue;
        }
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
            text: `[runtime-proof:hold] Burst held run ${i + 1}.`,
            effort: 'high',
          }),
        });
        if (response.status === 201) {
          client.runId = ((await response.json()) as { runId: string }).runId;
          return;
        }
        const text = await response.text().catch(() => '');
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          // Not JSON: logged below and failed as a non-capacity refusal.
        }
        console.log(
          `Held run ${i} creation returned ${response.status}: ${text.slice(0, 500)}`,
        );
        // Only a capacity refusal is retried; any other status fails.
        if (isCapacityRefusal(response.status, body)) {
          capacityRetries += 1;
          await delay(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 2000);
          continue;
        }
        throw new Error(
          `Held run ${i} creation failed with ${response.status}: ${text.slice(0, 500)}`,
        );
      }
    },
  );
  const heldRunIds = clients.flatMap((client) =>
    client.runId ? [client.runId] : [],
  );
  expect(heldRunIds).toHaveLength(options.heldRuns);

  const previous = (
    await docker([
      'inspect',
      '--format',
      '{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.NanoCpus}}',
      api,
    ])
  ).split('|');
  try {
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

    const results: ReturnType<typeof buildBurstResult>[] = [];
    const activeRunsAtPeak: Record<string, number> = {};
    for (const mode of options.modes) {
      // The previous mode's connections have all been released server-side.
      await expect
        .poll(
          async () =>
            (await control<Metrics>(api, { op: 'burst-metrics' })).sse.open,
          { timeout: 60_000 },
        )
        .toBe(0);
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
              await delay(
                (index / options.clients) * options.rampSeconds * 1000,
              );
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
                // Hold the stream until the window aborts it (held runs do
                // not end; invalidation streams never end).
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
      // The held runs must still be active at the end of the window.
      activeRunsAtPeak[mode] = await activeRuns(postgres);
      controller.abort();
      await Promise.all(settled);
      // A read, not a reset: the next mode resets at its start, and a retried
      // reset would lose the window's peak.
      const metrics = await control<Metrics>(api, { op: 'burst-metrics' });
      results.push(
        buildBurstResult({
          mode,
          clients: options.clients,
          firstFrameMs,
          rssBytes: [metrics.peakRssBytes],
          authPoolWaitMs: metrics.waitP95Ms === null ? [] : [metrics.waitP95Ms],
          poolWaitingMax: metrics.waitingMax,
          serverPeakOpenSse: metrics.sse.peak,
        }),
      );
    }

    const directory = resolve(
      process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR || 'test-results/f4-chat-load',
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const evidence = {
      apiLimits: { memoryMiB: 384, cpus: 0.5 },
      composition: {
        heldRuns: options.heldRuns,
        invalidationStreams: options.invalidationStreams,
      },
      setup: { activeAtStart, capacityRetries },
      activeRunsAtPeak,
      replay: { attaches: 0, drainSeconds: null as number | null, note: '' },
      results,
    };
    const writeEvidence = () =>
      writeFile(
        `${directory}/F4.2-burst.json`,
        `${JSON.stringify(evidence, null, 2)}\n`,
        { mode: 0o600 },
      );
    // The measured numbers are final here; record them before the replay.
    await writeEvidence();
    for (const result of results) {
      expect(result.admitted, `${result.mode} admitted`).toBe(options.clients);
      expect(
        result.serverPeakOpenSse,
        `${result.mode} server-side peak open SSE`,
      ).toBeGreaterThanOrEqual(options.clients);
      expect(activeRunsAtPeak[result.mode], `${result.mode} live runs`).toBe(
        options.heldRuns,
      );
    }

    // Release the held runs. Every one must reach a terminal status within
    // the bound computed from the worker concurrency; a run that does not is a
    // capacity leak (a product bug), so this fails instead of continuing.
    const releaseStartedAt = Date.now();
    const quoted = heldRunIds.map((id) => `'${id}'`).join(',');
    const terminal = async () =>
      (
        await psql(
          postgres,
          `SELECT id FROM app.ai_runs WHERE id IN (${quoted}) AND status IN ('completed','failed','cancelled')`,
        )
      )
        .split('\n')
        .filter(Boolean);
    const boundMs = drainBoundMs(heldRunIds.length, WORKER_CONCURRENCY);
    let finished = (await terminal()).length;
    while (
      Date.now() - releaseStartedAt < boundMs &&
      finished < heldRunIds.length
    ) {
      await eachLimited(heldRunIds, 8, (runId) => workerRelease(worker, runId));
      await delay(500);
      finished = (await terminal()).length;
    }
    evidence.replay.drainSeconds =
      Math.round((Date.now() - releaseStartedAt) / 100) / 10;
    (evidence.replay as Record<string, unknown>).drainBoundSeconds =
      boundMs / 1000;
    if (finished < heldRunIds.length) {
      evidence.replay.note = `CAPACITY LEAK: ${finished}/${heldRunIds.length} held runs terminal after ${boundMs} ms`;
      await writeEvidence();
      throw new Error(
        `${evidence.replay.note}; active now: ${await activeRunStatuses(postgres)}`,
      );
    }
    try {
      const done = new Set(await terminal());
      const replayFirstFrameMs: number[] = [];
      await eachLimited(
        clients.filter((client) => client.runId && done.has(client.runId)),
        6,
        async (client) => {
          const begin = performance.now();
          const response = await fetch(
            `${stack.publicUrl}/api/runs/${client.runId}/events`,
            {
              headers: {
                accept: 'text/event-stream',
                cookie: client.cookie,
                origin: stack.publicUrl,
              },
              signal: AbortSignal.timeout(60_000),
            },
          );
          if (response.status !== 200 || !response.body) return;
          const reader = response.body.getReader();
          const first = await reader.read();
          if (!first.done) replayFirstFrameMs.push(performance.now() - begin);
          while (!(await reader.read()).done) {
            // The replay of a completed run ends with the terminal frame.
          }
        },
      );
      evidence.replay.attaches = replayFirstFrameMs.length;
      evidence.replay.note = `${done.size}/${heldRunIds.length} held runs reached a terminal status`;
      for (const result of results)
        result.replayP95FirstFrameMs = percentile(replayFirstFrameMs, 0.95);
    } catch (error) {
      evidence.replay.note = `replay skipped: ${error instanceof Error ? error.message : 'error'}`;
    }
    await writeEvidence();
  } finally {
    // Never leave held runs behind, and restore the limits read before
    // lowering them (0 means unlimited).
    await eachLimited(heldRunIds, 8, (runId) => workerRelease(worker, runId));
    const [memory, swap, nanoCpus] = previous;
    await docker([
      'update',
      '--memory',
      memory!,
      '--memory-swap',
      swap!,
      '--cpus',
      String(Number(nanoCpus) / 1e9),
      api,
    ]).catch(() => undefined);
  }
});
