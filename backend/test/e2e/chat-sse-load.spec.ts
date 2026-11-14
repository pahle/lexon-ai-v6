import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { readContainerImages } from '../../../scripts/container-images.mjs';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const controlPath = 'backend/test/e2e/chat-load-control.mjs';
const workerControlPath = 'backend/test/e2e/chat-worker-control.mjs';
const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

type Owner = {
  context: APIRequestContext;
  userId: string;
  organizationId: string;
  cookie: string;
  origin: string;
};

type PlaywrightRequestFactory = {
  request: { newContext(): Promise<APIRequestContext> };
};

type ControlSnapshot = {
  apiContainerPid: number;
  activeSubscriptions: number;
  activeSubscriptionsByOwner: number[];
  activeLeases: number;
  activeLeasesByOwner: number[];
  readerSubscriptions: number;
  readerSubscriptionsByOwner: number[];
  readerConnections: number;
  valkeyClientsByPurpose: Record<string, number>;
  apiMemoryBytes: number;
  apiCpuMicros: number;
  config: {
    perUserSseLimit: number;
    globalRunCap: number;
    perOrganizationRunCap: number;
  };
  closeReasons: {
    evicted: number;
    revoked: number;
    slowClient: number;
    shutdown: number;
    normal: number;
  };
  causeCounters: Array<{
    renewal: { succeeded: number; missing: number; rejected: number };
    revalidation: {
      succeeded: number;
      authRequired: number;
      auth2faRequired: number;
      authUnavailable: number;
      other: number;
    };
    connect: { entered: number; errors: Record<string, number> };
    ownership: { present: number; missing: number; errors: number };
    snapshot: { present: number; missing: number; errors: number };
    tenantTransaction: { timeouts: number; otherErrors: number };
  }>;
  preServiceGetEvents: {
    total: number;
    byFailure: Record<string, number>;
  };
};

async function dockerWithTimeout(
  args: string[],
  timeout = 15000,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = await execFileAsync('docker', args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env,
  });
  return result.stdout.trim();
}

async function apiControl<T>(api: string, request: Record<string, unknown>) {
  const output = await docker([
    'exec',
    api,
    'node',
    controlPath,
    JSON.stringify(request),
  ]);
  return JSON.parse(output) as T;
}

async function workerControl<T>(worker: string, op: string, runId: string) {
  const output = await docker([
    'exec',
    worker,
    'node',
    workerControlPath,
    op,
    runId,
  ]);
  return JSON.parse(output) as T;
}

async function makeOwner(
  playwright: PlaywrightRequestFactory,
  apiUrl: string,
  index: number,
): Promise<Owner> {
  const context = await playwright.request.newContext();
  try {
    const headers = await authenticateApi(context, {
      name: `Chat load owner ${index + 1}`,
    });
    const identityResponse = await context.get(`${apiUrl}/api/identity`);
    expect(identityResponse.ok()).toBe(true);
    const identity = (await identityResponse.json()) as {
      user: { id: string };
      organization: { id: string };
    };
    const host = new URL(apiUrl).hostname;
    const cookies = (await context.storageState()).cookies.filter(
      (cookie) => cookie.domain.replace(/^\./u, '') === host,
    );
    const cookie = cookies
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    expect(cookie.length).toBeGreaterThan(0);
    if (!headers.origin)
      throw new Error('Authenticated owner origin is missing');
    return {
      context,
      userId: identity.user.id,
      organizationId: identity.organization.id,
      cookie,
      origin: headers.origin,
    };
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

async function createRun(
  owner: Owner,
  apiUrl: string,
  text: string,
): Promise<{ chatId: string; runId: string }> {
  const chatId = randomUUID();
  const response = await owner.context.post(`${apiUrl}/api/chats`, {
    headers: { 'content-type': 'application/json', origin: owner.origin },
    data: {
      chatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text,
      effort: 'high',
    },
  });
  expect(response.status()).toBe(201);
  const value = (await response.json()) as { chatId: string; runId: string };
  expect(value.chatId).toBe(chatId);
  expect(value.runId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  return { chatId, runId: value.runId };
}

async function firstTextFrameMs(
  owner: Owner,
  stack: ReturnType<typeof descriptor>,
  runId: string,
  startedAt: number,
): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decoder = new TextDecoder();
  try {
    const response = await fetch(
      `${stack.publicUrl}/api/runs/${runId}/events`,
      {
        headers: {
          accept: 'text/event-stream',
          cookie: owner.cookie,
          origin: stack.publicUrl,
        },
        signal: controller.signal,
      },
    );
    if (response.status !== 200 || !response.body)
      throw new Error('Authenticated SSE request did not open');
    reader = response.body.getReader();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/u)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const liveText =
          event.type === 'text-delta' &&
          typeof event.delta === 'string' &&
          event.delta.length > 0;
        const snapshotText =
          event.type === 'snapshot-part' &&
          event.partType === 'text' &&
          typeof event.text === 'string' &&
          event.text.length > 0;
        if (liveText || snapshotText) return performance.now() - startedAt;
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
  throw new Error('SSE stream ended before its first text frame');
}

async function hostPid(container: string, marker: string): Promise<number> {
  // `docker top` reports the Docker Engine host PID; the control socket reports
  // the separate namespace PID only for API process identity.
  const output = await docker(['top', container, '-eo', 'pid,args']);
  const line = output
    .split('\n')
    .find((candidate) => candidate.includes(marker));
  const pid = Number(line?.trim().split(/\s+/u)[0]);
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error('Could not identify the measured container process');
  return pid;
}

async function resourceLimits(container: string) {
  const output = await docker([
    'inspect',
    '--format',
    '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}',
    container,
  ]);
  const [memory, nanoCpus] = output.split('|').map(Number);
  if (
    memory === undefined ||
    nanoCpus === undefined ||
    !Number.isSafeInteger(memory) ||
    !Number.isSafeInteger(nanoCpus)
  )
    throw new Error('Could not inspect measured container resource limits');
  return { memoryBytes: memory, cpuCount: nanoCpus / 1_000_000_000 };
}

async function imageReference(container: string) {
  const output = await docker([
    'inspect',
    '--format',
    '{{.Config.Image}}|{{.Image}}',
    container,
  ]);
  const [configuredImage, imageId] = output.split('|');
  if (!configuredImage) throw new Error('Could not identify measured image');
  if (configuredImage.includes('@sha256:')) return configuredImage;
  const imageDigest = /^sha256:[a-f0-9]{64}$/u.exec(imageId ?? '')?.[0];
  if (!imageDigest) throw new Error('Could not identify measured image digest');
  const slash = configuredImage.lastIndexOf('/');
  const tagSeparator = configuredImage.lastIndexOf(':');
  const taggedImage =
    tagSeparator > slash ? configuredImage : `${configuredImage}:latest`;
  return `${taggedImage}@${imageDigest}`;
}

async function loadToolResources(container: string) {
  const output = await docker([
    'exec',
    container,
    'sh',
    '-c',
    'cat /sys/fs/cgroup/cpu.stat; printf "\\n--MEMORY--\\n"; cat /sys/fs/cgroup/memory.current',
  ]);
  const cpu = /^usage_usec\s+(\d+)$/mu.exec(output)?.[1];
  const memory = /--MEMORY--\s*(\d+)/u.exec(output)?.[1];
  if (!cpu || !memory)
    throw new Error('Could not read load-tool cgroup resource counters');
  return { cpuMicros: Number(cpu), memoryBytes: Number(memory) };
}

async function streamLengths(api: string, runIds: string[]) {
  return apiControl<number[]>(api, { op: 'stream-lengths', runIds });
}

async function stopLoadToolForDiagnostics(
  container: string,
  summaryPath: string,
) {
  await dockerWithTimeout(['stop', '--time', '5', container], 8000).catch(
    () => undefined,
  );
  await dockerWithTimeout(['wait', container], 15000).catch(() => undefined);
  try {
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as {
      diagnostics?: unknown;
    };
    return summary.diagnostics ?? { available: false };
  } catch {
    return { available: false };
  }
}

async function dockerState(container: string) {
  try {
    const output = await docker([
      'inspect',
      '--format',
      '{{.State.Running}}|{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.RestartCount}}',
      container,
    ]);
    const [running, oomKilled, exitCode, restartCount] = output.split('|');
    if (
      (running !== 'true' && running !== 'false') ||
      (oomKilled !== 'true' && oomKilled !== 'false') ||
      exitCode === undefined ||
      restartCount === undefined ||
      !Number.isSafeInteger(Number(exitCode)) ||
      !Number.isSafeInteger(Number(restartCount))
    )
      return { available: false };
    return {
      running: running === 'true',
      oomKilled: oomKilled === 'true',
      exitCode: Number(exitCode),
      restartCount: Number(restartCount),
    };
  } catch {
    return { available: false };
  }
}

async function writeAdmissionDiagnostic(
  api: string,
  loadTool: string,
  summaryPath: string,
  lastSnapshot: ControlSnapshot | undefined,
) {
  const snapshot = await apiControl<ControlSnapshot>(api, {
    op: 'snapshot',
  }).catch(() => lastSnapshot);
  const caddy = await containerId('caddy').catch(() => undefined);
  const [apiState, caddyState, loadToolState] = await Promise.all([
    dockerState(api),
    caddy ? dockerState(caddy) : Promise.resolve({ available: false }),
    dockerState(loadTool),
  ]);
  const k6 = await stopLoadToolForDiagnostics(loadTool, summaryPath);
  const evidenceDirectory = resolve(
    process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR ||
      join(repositoryRoot, 'test-results/f4-chat-load'),
  );
  const diagnostic = {
    phase: 'admission-startup',
    api: snapshot
      ? {
          perUserSseLimit: snapshot.config.perUserSseLimit,
          activeSubscriptions: snapshot.activeSubscriptions,
          activeLeases: snapshot.activeLeases,
          readerSubscriptions: snapshot.readerSubscriptions,
          activeSubscriptionsByOwner: snapshot.activeSubscriptionsByOwner,
          activeLeasesByOwner: snapshot.activeLeasesByOwner,
          readerSubscriptionsByOwner: snapshot.readerSubscriptionsByOwner,
          readerConnections: snapshot.readerConnections,
          valkeyClientsByPurpose: snapshot.valkeyClientsByPurpose,
          closeReasons: snapshot.closeReasons,
          causeCounters: snapshot.causeCounters,
          preServiceGetEvents: snapshot.preServiceGetEvents,
          apiMemoryBytes: snapshot.apiMemoryBytes,
          apiCpuMicros: snapshot.apiCpuMicros,
        }
      : { available: false },
    containers: { api: apiState, caddy: caddyState, loadTool: loadToolState },
    k6,
  };
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(evidenceDirectory, 'diagnostic.json'),
    `${JSON.stringify(diagnostic)}\n`,
    { mode: 0o600 },
  );
}

test('500 authenticated Caddy SSE clients hold a bounded API stream hub', async ({
  playwright,
}) => {
  test.setTimeout(180_000);
  const stack = descriptor();
  const api = await containerId('api');
  const worker = await containerId('ai-worker');
  await expect
    .poll(() => apiControl(api, { op: 'ready' }).catch(() => null), {
      timeout: 15000,
      intervals: [250],
    })
    .toEqual({ ready: true });
  const apiHostPid = await hostPid(api, 'chat-load-api-main.mjs');
  const images = readContainerImages(
    join(repositoryRoot, 'config/container-images.env'),
  ) as ReturnType<typeof readContainerImages> & { caddy: string; k6: string };
  await dockerWithTimeout(['pull', images.k6], 60_000);
  const apiLimits = await resourceLimits(api);
  expect(apiLimits).toEqual({ memoryBytes: 1536 * 1024 * 1024, cpuCount: 1 });
  const owners: Owner[] = [];
  const runIds: string[] = [];
  const openReaders: Array<{
    controller: AbortController;
    reader: ReadableStreamDefaultReader<Uint8Array>;
  }> = [];
  let k6Container: string | undefined;
  let privateDirectory: string | undefined;
  let ownersRegistered = false;
  let warmHealthPeak = 0;

  const observe = async () => {
    const value = await apiControl<ControlSnapshot>(api, { op: 'snapshot' });
    warmHealthPeak = Math.max(
      warmHealthPeak,
      value.valkeyClientsByPurpose.health ?? 0,
    );
    return value;
  };

  try {
    owners.push(await makeOwner(playwright, stack.apiUrl, 0));
    owners.push(await makeOwner(playwright, stack.apiUrl, 1));
    expect(owners[0]!.organizationId).not.toBe(owners[1]!.organizationId);
    await apiControl(api, {
      op: 'set-owners',
      userIds: owners.map((owner) => owner.userId),
    });
    ownersRegistered = true;

    const coldStartedAt = performance.now();
    const coldRun = await createRun(
      owners[0]!,
      stack.apiUrl,
      'Measure a cold synthetic chat response.',
    );
    runIds.push(coldRun.runId);
    const coldSample = await firstTextFrameMs(
      owners[0]!,
      stack,
      coldRun.runId,
      coldStartedAt,
    );
    await expect
      .poll(() => workerControl(worker, 'status', coldRun.runId), {
        timeout: 15000,
      })
      .toBeNull();

    const warmSamples: number[] = [];
    for (const owner of [owners[1]!, owners[0]!, owners[1]!]) {
      const warmStartedAt = performance.now();
      const run = await createRun(
        owner,
        stack.apiUrl,
        'Measure a warm synthetic chat response.',
      );
      runIds.push(run.runId);
      warmSamples.push(
        await firstTextFrameMs(owner, stack, run.runId, warmStartedAt),
      );
      await expect
        .poll(() => workerControl(worker, 'status', run.runId), {
          timeout: 15000,
        })
        .toBeNull();
    }

    const warmRun = await createRun(
      owners[0]!,
      stack.apiUrl,
      '[runtime-proof:hold] warm baseline stream',
    );
    runIds.push(warmRun.runId);
    await expect
      .poll(() => workerControl(worker, 'status', warmRun.runId), {
        timeout: 10000,
      })
      .toMatchObject({ prefixBlocked: true });
    const warmController = new AbortController();
    const warmResponse = await fetch(
      `${stack.publicUrl}/api/runs/${warmRun.runId}/events`,
      {
        headers: {
          accept: 'text/event-stream',
          cookie: owners[0]!.cookie,
          origin: stack.publicUrl,
        },
        signal: warmController.signal,
      },
    );
    if (warmResponse.status !== 200 || !warmResponse.body)
      throw new Error('Warm baseline SSE request did not open');
    const warmReader = warmResponse.body.getReader();
    openReaders.push({ controller: warmController, reader: warmReader });
    await expect
      .poll(
        async () => {
          const current = await observe();
          return current.activeSubscriptions === 1 &&
            current.activeLeases === 1 &&
            current.readerSubscriptions === 1 &&
            current.readerConnections === 2
            ? current
            : null;
        },
        { timeout: 10000 },
      )
      .not.toBeNull();
    const warmHealthWindowStartedAt = Date.now();
    while (Date.now() - warmHealthWindowStartedAt < 6000) {
      await observe();
      await delay(1000);
    }
    const oneSubscriberSnapshot = await observe();
    const oneSubscriberBaseline = {
      apiPid: apiHostPid,
      readerConnections: oneSubscriberSnapshot.readerConnections,
    };
    warmController.abort();
    await warmReader.cancel().catch(() => undefined);
    openReaders.splice(
      openReaders.findIndex((entry) => entry.reader === warmReader),
      1,
    );
    await expect
      .poll(
        async () => {
          const current = await observe();
          return [
            current.activeSubscriptions,
            current.activeLeases,
            current.readerSubscriptions,
            current.readerConnections,
          ];
        },
        { timeout: 10000 },
      )
      .toEqual([0, 0, 0, 1]);
    const warmBaselineSnapshot = await observe();
    const warmBaseline = {
      apiPid: apiHostPid,
      activeSubscriptions: warmBaselineSnapshot.activeSubscriptions,
      activeLeases: warmBaselineSnapshot.activeLeases,
      readerSubscriptions: warmBaselineSnapshot.readerSubscriptions,
      readerConnections: warmBaselineSnapshot.readerConnections,
      valkeyClientsByPurpose: {
        ...warmBaselineSnapshot.valkeyClientsByPurpose,
        health: warmHealthPeak,
      },
    };
    await workerControl(worker, 'release-prefix', warmRun.runId);
    await workerControl(worker, 'release', warmRun.runId);
    await expect
      .poll(() => workerControl(worker, 'status', warmRun.runId), {
        timeout: 10000,
      })
      .toBeNull();

    const heldRuns = [] as Array<{ chatId: string; runId: string }>;
    for (const [index, owner] of owners.entries()) {
      const run = await createRun(
        owner,
        stack.apiUrl,
        `[runtime-proof:hold] load owner ${index + 1}`,
      );
      heldRuns.push(run);
      runIds.push(run.runId);
    }
    await apiControl(api, {
      op: 'set-load-runs',
      runIds: heldRuns.map((run) => run.runId),
    });
    for (const run of heldRuns)
      await expect
        .poll(() => workerControl(worker, 'status', run.runId), {
          timeout: 12000,
        })
        .toMatchObject({ prefixBlocked: true });

    const sequenceBefore = await streamLengths(
      api,
      heldRuns.map((run) => run.runId),
    );
    expect(sequenceBefore).toHaveLength(2);
    const apiRuntimeConfig = await observe();
    expect(apiRuntimeConfig.apiContainerPid).toBeGreaterThan(0);
    const loadDirectory = await mkdtemp(join(tmpdir(), 'lexon-chat-load-'));
    privateDirectory = loadDirectory;
    await chmod(loadDirectory, 0o700);
    const cookiePath = join(loadDirectory, 'cookies.json');
    const summaryPath = join(loadDirectory, 'summary.json');
    await writeFile(
      cookiePath,
      JSON.stringify(
        owners.map((owner, index) => ({
          cookie: owner.cookie,
          runId: heldRuns[index]!.runId,
        })),
      ),
      { mode: 0o444 },
    );
    await writeFile(summaryPath, '', { mode: 0o666 });
    await chmod(summaryPath, 0o666);

    const composeFiles = [
      join(repositoryRoot, 'docker-compose.yml'),
      join(repositoryRoot, 'backend/test/e2e/compose.egress-probe.yml'),
      join(repositoryRoot, 'backend/test/e2e/compose.identity.yml'),
      join(repositoryRoot, 'backend/test/e2e/compose.chat-runtime-proof.yml'),
      join(repositoryRoot, 'backend/test/e2e/compose.chat-load.yml'),
    ];
    const k6Name = `${stack.project}-k6`;
    k6Container = k6Name;
    const operatorEnvironment = JSON.parse(
      await readFile(stack.operatorEnvironmentPath, 'utf8'),
    ) as Record<string, string>;
    await dockerWithTimeout(
      [
        'compose',
        '--profile',
        'chat-load',
        '--project-name',
        stack.project,
        ...composeFiles.flatMap((file) => ['--file', file]),
        'run',
        '--detach',
        '--no-deps',
        '--name',
        k6Name,
        '--volume',
        `${cookiePath}:/run/load/cookies.json:ro`,
        '--volume',
        `${summaryPath}:/run/load/summary.json:rw`,
        '--env',
        'COOKIE_FILE=/run/load/cookies.json',
        '--env',
        'SUMMARY_FILE=/run/load/summary.json',
        '--env',
        'API_BASE_URL=http://caddy:8080',
        '--env',
        `PUBLIC_ORIGIN=${stack.publicUrl}`,
        'load-tool',
        'run',
        '/scripts/chat-sse.js',
      ],
      15000,
      {
        ...process.env,
        ...operatorEnvironment,
        COMPOSE_DISABLE_ENV_FILE: 'true',
      },
    );
    const loadToolLimits = await resourceLimits(k6Name);
    expect(loadToolLimits).toEqual({
      memoryBytes: 2048 * 1024 * 1024,
      cpuCount: 2,
    });
    const loadToolPid = await hostPid(k6Name, '/scripts/chat-sse.js');

    let lastAdmissionSnapshot: ControlSnapshot | undefined;
    try {
      await expect
        .poll(
          async () => {
            lastAdmissionSnapshot = await observe();
            return lastAdmissionSnapshot.activeSubscriptions;
          },
          {
            timeout: 15000,
            intervals: [500],
          },
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () => {
            lastAdmissionSnapshot = await observe();
            return Math.min(
              lastAdmissionSnapshot.activeSubscriptions,
              lastAdmissionSnapshot.activeLeases,
              lastAdmissionSnapshot.readerSubscriptions,
            );
          },
          {
            timeout: 20000,
            intervals: [500],
          },
        )
        .toBe(500);
    } catch (error) {
      await writeAdmissionDiagnostic(
        api,
        k6Name,
        summaryPath,
        lastAdmissionSnapshot,
      ).catch(() => undefined);
      throw error;
    }

    const plateauStart = Date.now();
    const plateauSamples: Array<Record<string, unknown>> = [];
    const appendSample = async () => {
      const current = await observe();
      const loadResources = await loadToolResources(k6Name);
      plateauSamples.push({
        elapsedMs: Date.now() - plateauStart,
        activeSubscriptions: current.activeSubscriptions,
        activeLeases: current.activeLeases,
        readerSubscriptions: current.readerSubscriptions,
        readerConnections: current.readerConnections,
        apiPid: apiHostPid,
        apiMemoryBytes: current.apiMemoryBytes,
        apiCpuMicros: current.apiCpuMicros,
        loadToolPid,
        loadToolMemoryBytes: loadResources.memoryBytes,
        loadToolCpuMicros: loadResources.cpuMicros,
        valkeyClientsByPurpose: current.valkeyClientsByPurpose,
      });
    };
    await appendSample();
    await delay(1000);
    await appendSample();
    for (const run of heldRuns)
      await workerControl(worker, 'release-prefix', run.runId);
    for (const run of heldRuns)
      await expect
        .poll(() => workerControl(worker, 'status', run.runId), {
          timeout: 10000,
        })
        .toMatchObject({ blocked: true, released: false });
    const sequenceAfter = await streamLengths(
      api,
      heldRuns.map((run) => run.runId),
    );
    expect(sequenceAfter).toHaveLength(2);
    expect(sequenceAfter[0]).toBeGreaterThan(sequenceBefore[0]!);
    expect(sequenceAfter[1]).toBeGreaterThan(sequenceBefore[1]!);

    while (Date.now() - plateauStart < 32_000) {
      await delay(1000);
      await appendSample();
    }
    await apiControl(api, {
      op: 'close-runs',
      runIds: heldRuns.map((run) => run.runId),
    });
    const status = Number(await dockerWithTimeout(['wait', k6Name], 90000));
    expect(status).toBe(0);

    const parsedK6 = JSON.parse(await readFile(summaryPath, 'utf8')) as {
      vus: number;
      requestsStarted: number;
      requestsCompleted: number;
      http200: number;
      errors: number;
      minRequestDurationMs: number;
      maxRequestsPerVu: number;
      reconnects: number;
      diagnostics: unknown;
    };
    const k6 = {
      vus: parsedK6.vus,
      requestsStarted: parsedK6.requestsStarted,
      requestsCompleted: parsedK6.requestsCompleted,
      http200: parsedK6.http200,
      errors: parsedK6.errors,
      minRequestDurationMs: parsedK6.minRequestDurationMs,
      maxRequestsPerVu: parsedK6.maxRequestsPerVu,
      reconnects: parsedK6.reconnects,
    };
    expect(k6).toEqual({
      vus: 500,
      requestsStarted: 500,
      requestsCompleted: 500,
      http200: 500,
      errors: 0,
      minRequestDurationMs: expect.any(Number),
      maxRequestsPerVu: 1,
      reconnects: 0,
    });
    expect(k6.minRequestDurationMs).toBeGreaterThanOrEqual(30000);
    await expect
      .poll(
        async () => {
          const current = await observe();
          return [
            current.activeSubscriptions,
            current.activeLeases,
            current.readerSubscriptions,
            current.readerConnections,
          ];
        },
        { timeout: 12000 },
      )
      .toEqual([
        warmBaseline.activeSubscriptions,
        warmBaseline.activeLeases,
        warmBaseline.readerSubscriptions,
        warmBaseline.readerConnections,
      ]);
    const teardownSnapshot = await observe();
    const teardown = {
      apiPid: apiHostPid,
      activeSubscriptions: teardownSnapshot.activeSubscriptions,
      activeLeases: teardownSnapshot.activeLeases,
      readerSubscriptions: teardownSnapshot.readerSubscriptions,
      readerConnections: teardownSnapshot.readerConnections,
      valkeyClientsByPurpose: teardownSnapshot.valkeyClientsByPurpose,
    };

    const [apiImage, caddyImage, valkeyImage, loadImage] = await Promise.all([
      imageReference(api),
      imageReference(await containerId('caddy')),
      imageReference(await containerId('valkey')),
      imageReference(k6Name),
    ]);
    const runnerImage = process.env.ImageOS
      ? `${process.env.ImageOS}/${process.env.ImageVersion ?? 'unknown'}`
      : `${process.platform}-${process.arch}`;
    const gitHead = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })
    ).stdout.trim();
    const gitStatus = await execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: repositoryRoot },
    );
    const observations = {
      provenance: {
        sourceHead: gitHead,
        sourceDirty: gitStatus.stdout.length > 0,
        runnerImage,
        apiPid: apiHostPid,
        loadToolPid,
        images: {
          api: apiImage,
          caddy: caddyImage,
          valkey: valkeyImage,
          k6: loadImage,
        },
      },
      config: {
        perUserSseLimit: apiRuntimeConfig.config.perUserSseLimit,
        owners: 2,
        separateOrganizations: 2,
        subscribersPerOwner: 250,
        activeMockRuns: 2,
        apiMemoryLimitMiB: apiLimits.memoryBytes / (1024 * 1024),
        apiCpuLimit: apiLimits.cpuCount,
        loadToolMemoryLimitMiB: loadToolLimits.memoryBytes / (1024 * 1024),
        loadToolCpuLimit: loadToolLimits.cpuCount,
        testTimeoutSeconds: 180,
        runCaps: {
          global: apiRuntimeConfig.config.globalRunCap,
          perOrganization: apiRuntimeConfig.config.perOrganizationRunCap,
        },
      },
      defaultSixQualification: {
        perUserLimit: 6,
        seventhConnectionEvictedOldest:
          process.env.LEXON_CHAT_DEFAULT_SIX_QUALIFIED === '1',
      },
      warmBaseline,
      oneSubscriberBaseline,
      plateauSamples,
      k6,
      worker: {
        activeRuns: 2,
        sequenceBefore,
        sequenceAfter,
      },
      teardown,
      latency: {
        measurement: 'mock-send-to-first-frame',
        coldSamplesMs: [coldSample],
        warmSamplesMs: warmSamples,
      },
    };
    const observationsPath = join(
      dirname(stack.operatorEnvironmentPath),
      'chat-load-observations.json',
    );
    await writeFile(observationsPath, JSON.stringify(observations), {
      mode: 0o600,
    });
    expect(caddyImage).toBe(images.caddy);
    expect(valkeyImage).toBe(images.valkey);
    expect(loadImage).toBe(images.k6);
  } finally {
    if (k6Container)
      await docker(['rm', '--force', k6Container]).catch(() => undefined);
    for (const entry of openReaders) {
      entry.controller.abort();
      await entry.reader.cancel().catch(() => undefined);
    }
    if (ownersRegistered) {
      await apiControl(api, {
        op: 'close-runs',
        runIds: runIds.slice(-2),
      }).catch(() => undefined);
    }
    for (const runId of runIds) {
      await workerControl(worker, 'release-prefix', runId).catch(
        () => undefined,
      );
      await workerControl(worker, 'release', runId).catch(() => undefined);
    }
    for (const owner of owners) await owner.context.dispose();
    if (privateDirectory)
      await rm(privateDirectory, { recursive: true, force: true });
  }
});
