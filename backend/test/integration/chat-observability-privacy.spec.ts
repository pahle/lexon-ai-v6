import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { trace } from '@opentelemetry/api';
import { RunStreamEventSchema, type RunStreamEvent } from '@lexon/contracts';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAiHarness } from '../setup/ai-harness.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  AiRunRepository,
  parseJobEnvelope,
} from '../../src/infrastructure/db/index.js';
import {
  createRealModelGateway,
  ModelAllowlistSchema,
  registerAiSdkTelemetry,
} from '../../src/infrastructure/ai/index.js';
import { RunStreams } from '../../src/infrastructure/queue/index.js';
import {
  CHAT_HISTORY_CONTEXT_ID,
  CHAT_PROFILES,
  RunRegistry,
} from '../../src/modules/chat/index.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { startAiTelemetry } from '../../src/infrastructure/telemetry/index.js';

test('chat content and search terms stay out of HTTP logs and validation errors', async ({
  services,
}) => {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown,
    ...args: unknown[]
  ) => {
    const value = String(chunk);
    if (value.startsWith('{')) {
      lines.push(value);
      const callback = args.find((x) => typeof x === 'function') as
        (() => void) | undefined;
      callback?.();
      return true;
    }
    return original(chunk as string);
  }) as typeof process.stdout.write);
  let app: Awaited<ReturnType<typeof createTestApi>> | undefined;

  try {
    app = await createTestApi(
      loadRuntimeConfig(
        'api',
        createAuthEnvironment(
          services,
          '/tmp/lexon-chat-observability-privacy-health.json',
        ),
      ),
    );
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const createRequestId = randomUUID();
    const readRequestId = randomUUID();
    const searchRequestId = randomUUID();
    const invalidRequestId = randomUUID();
    const chatContentCanary = `privatechat${randomUUID().replaceAll('-', '')}`;
    const searchTermCanary = `privatesearch${randomUUID().replaceAll('-', '')}`;

    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': createRequestId,
      },
      body: JSON.stringify({
        chatId,
        userMessageId,
        requestId: createRequestId,
        text: `${chatContentCanary} ${searchTermCanary} privacy fixture`,
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);

    const read = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: { ...headers, 'x-request-id': readRequestId },
    });
    expect(read.status).toBe(200);
    const readBody = await read.text();
    expect(readBody).toContain(chatContentCanary);
    expect(readBody).toContain(searchTermCanary);

    const searched = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': searchRequestId,
      },
      body: JSON.stringify({ query: searchTermCanary, limit: 10 }),
    });
    expect(searched.status).toBe(200);
    const searchBody = await searched.text();
    expect(searchBody).toContain(searchTermCanary);

    const invalid = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': invalidRequestId,
      },
      body: JSON.stringify({
        query: searchTermCanary,
        limit: 10,
        unknown: chatContentCanary,
      }),
    });
    expect(invalid.status).toBe(400);
    const errorBody = await invalid.text();
    expect(errorBody).not.toContain(chatContentCanary);
    expect(errorBody).not.toContain(searchTermCanary);

    await expect.poll(() => lines.join('')).toContain(searchRequestId);
    await expect.poll(() => lines.join('')).toContain(invalidRequestId);
    const logs = lines.join('');
    expect(logs).not.toContain(chatContentCanary);
    expect(logs).not.toContain(searchTermCanary);
  } finally {
    try {
      await app?.close();
    } finally {
      spy.mockRestore();
    }
  }
});

test('raw provider errors stay out of API logs, live SSE and production OTLP export', async ({
  services,
}) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const capture = (chunks: string[]) =>
    ((chunk: unknown, ...args: unknown[]) => {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk),
      );
      const callback = args.find((value) => typeof value === 'function') as
        (() => void) | undefined;
      callback?.();
      return true;
    }) as typeof process.stdout.write;
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(capture(stdout));
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(capture(stderr));
  const otlpBodies: Buffer[] = [];
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      let body = Buffer.concat(chunks);
      if (request.headers['content-encoding'] === 'gzip')
        body = gunzipSync(body);
      otlpBodies.push(body);
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
  });

  const privatePromptCanary = `private-prompt-${randomUUID()}`;
  const fakeKeyCanary = `fake-provider-key-${randomUUID()}`;
  const providerErrorCanary = `raw-provider-error-${randomUUID()}`;
  const createRequestId = randomUUID();
  const streamRequestId = randomUUID();
  const streamController = new AbortController();
  let collectorListening = false;
  let telemetry: Awaited<ReturnType<typeof startAiTelemetry>> | undefined;
  let fixture: Awaited<ReturnType<typeof createChatFixture>> | undefined;
  let app: Awaited<ReturnType<typeof createTestApi>> | undefined;
  let worker: Awaited<ReturnType<typeof createAiHarness>> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let readerTask: Promise<void> | undefined;

  trace.disable();
  try {
    await new Promise<void>((resolve, reject) => {
      collector.once('error', reject);
      collector.listen(0, '127.0.0.1', () => {
        collectorListening = true;
        collector.off('error', reject);
        resolve();
      });
    });
    const collectorAddress = collector.address();
    if (!collectorAddress || typeof collectorAddress === 'string')
      throw new Error('Loopback OTLP collector did not bind');
    telemetry = await startAiTelemetry({
      collectorUrl: `http://127.0.0.1:${collectorAddress.port}/v1/traces`,
      serviceName: 'lexon-chat-privacy-test',
    });
    registerAiSdkTelemetry();

    fixture = await createChatFixture(services);
    app = await createTestApi(
      loadRuntimeConfig(
        'api',
        createAuthEnvironment(
          services,
          '/tmp/lexon-chat-provider-error-privacy-health.json',
        ),
      ),
    );
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const identityResponse = await fetch(`${origin}/api/identity`, { headers });
    expect(identityResponse.status).toBe(200);
    const identity = (await identityResponse.json()) as {
      organization: { id: string };
      user: { id: string };
    };
    const tenant = {
      orgId: identity.organization.id,
      userId: identity.user.id,
    };
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-request-id': createRequestId,
      },
      body: JSON.stringify({
        chatId,
        userMessageId,
        requestId: createRequestId,
        text: privatePromptCanary,
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as { runId: string };
    const runId = mutation.runId;

    const allowlist = ModelAllowlistSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../config/model-allowlist.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    let providerRequests = 0;
    const gateway = createRealModelGateway({
      allowlist,
      key: fakeKeyCanary,
      attestation: new Date().toISOString().slice(0, 10),
      fetch: async () => {
        providerRequests++;
        return Response.json(
          { error: { message: providerErrorCanary } },
          { status: 400 },
        );
      },
    });
    const history = app.get(RunRegistry).context(CHAT_HISTORY_CONTEXT_ID);
    expect(history).toBeDefined();
    worker = await createAiHarness(
      {
        database: fixture.database,
        capacity: fixture.capacity,
        capacityConfig: fixture.capacityConfig,
        allowlist,
        authorization: new RunAuthorizationService(),
        close: async () => {},
      },
      {
        profiles: [CHAT_PROFILES.chat],
        contexts: [history!],
        tools: [],
      },
      gateway,
      undefined,
      { streams: app.get(RunStreams) },
    );

    const outbox = await fixture.inspect.query(
      'SELECT id,type,org_id,user_id,payload FROM ops.outbox WHERE id=$1',
      [stepJobId(runId, 1)],
    );
    expect(outbox.rows).toHaveLength(1);
    const jobRow = outbox.rows[0] as {
      id: string;
      type: string;
      org_id: string;
      user_id: string;
      payload: unknown;
    };
    const job = parseJobEnvelope({
      outboxId: jobRow.id,
      type: jobRow.type,
      ctx: { orgId: jobRow.org_id, userId: jobRow.user_id },
      payload: jobRow.payload,
    });

    const streamResponse = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: { ...headers, 'x-request-id': streamRequestId },
      signal: streamController.signal,
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain(
      'text/event-stream',
    );
    reader = streamResponse.body!.getReader();
    const observedFrames: Array<Record<string, unknown>> = [];
    const observedRunEvents: RunStreamEvent[] = [];
    let resolveSnapshot!: () => void;
    let resolveTerminal!: () => void;
    let rejectStream!: (error: unknown) => void;
    let sawSnapshot = false;
    let sawError = false;
    let sawFinish = false;
    const eventTypeCounts: Record<string, number> = {
      'snapshot-start': 0,
      'snapshot-part': 0,
      'snapshot-end': 0,
      status: 0,
      error: 0,
      finish: 0,
      reset: 0,
    };
    const snapshotSeen = new Promise<void>((resolve) => {
      resolveSnapshot = resolve;
    });
    const terminalSeen = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    const streamFailed = new Promise<never>((_resolve, reject) => {
      rejectStream = reject;
    });
    readerTask = (async () => {
      const decoder = new TextDecoder();
      let buffered = '';
      try {
        for (;;) {
          const { value, done } = await reader!.read();
          if (done) return;
          buffered += decoder.decode(value, { stream: true });
          for (;;) {
            const boundary = buffered.indexOf('\n\n');
            if (boundary < 0) break;
            const frame = buffered.slice(0, boundary).replace(/\r/g, '');
            buffered = buffered.slice(boundary + 2);
            const dataLine = frame
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (!dataLine) continue;
            const parsed = JSON.parse(dataLine.slice(6)) as Record<
              string,
              unknown
            >;
            observedFrames.push(parsed);
            if (
              typeof parsed.type === 'string' &&
              Object.hasOwn(eventTypeCounts, parsed.type)
            ) {
              eventTypeCounts[parsed.type] =
                (eventTypeCounts[parsed.type] ?? 0) + 1;
            }
            if (parsed.type === 'snapshot-end' && !sawSnapshot) {
              sawSnapshot = true;
              resolveSnapshot();
            }
            if (
              parsed.runId === runId &&
              (parsed.type === 'error' || parsed.type === 'finish')
            ) {
              const event = RunStreamEventSchema.parse(parsed);
              observedRunEvents.push(event);
              if (event.type === 'error') sawError = true;
              if (event.type === 'finish') sawFinish = true;
              if (sawError && sawFinish) resolveTerminal();
            }
          }
        }
      } catch (error) {
        rejectStream(error);
      }
    })();

    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      snapshotSeen,
      streamFailed,
      new Promise<void>((_resolve, reject) => {
        snapshotTimer = setTimeout(
          () => reject(new Error('SSE snapshot did not finish in time')),
          10_000,
        );
      }),
    ]).finally(() => {
      if (snapshotTimer) clearTimeout(snapshotTimer);
    });

    const execution = await worker.execute(job, {
      signal: new AbortController().signal,
    });
    expect(providerRequests).toBeGreaterThan(0);
    const terminalRun = await fixture.database.withTenant(tenant, (tx) =>
      new AiRunRepository().find(tx, runId),
    );
    expect(terminalRun).toMatchObject({
      status: 'failed',
      errorCode: 'AI_PROVIDER_UNAVAILABLE',
    });
    let terminalTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        terminalSeen,
        streamFailed,
        new Promise<void>((_resolve, reject) => {
          terminalTimer = setTimeout(
            () =>
              reject(new Error('SSE provider failure did not finish in time')),
            10_000,
          );
        }),
      ]);
    } catch {
      const executionKind = execution.kind;
      const runStatus = terminalRun?.status ?? 'missing';
      const safeErrorCode = terminalRun?.errorCode ?? 'missing';
      const eventCounts = Object.fromEntries(
        Object.entries(eventTypeCounts).filter(([, count]) => count > 0),
      );
      throw new Error(
        `SSE terminal observation failed; execution=${executionKind}; runStatus=${runStatus}; safeErrorCode=${safeErrorCode}; eventTypeCounts=${JSON.stringify(eventCounts)}`,
      );
    } finally {
      if (terminalTimer) clearTimeout(terminalTimer);
    }

    const runEventsJson = JSON.stringify(observedRunEvents);
    expect(observedRunEvents).toContainEqual({
      version: 1,
      runId,
      type: 'error',
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    expect(observedRunEvents).toContainEqual({
      version: 1,
      runId,
      type: 'finish',
    });
    streamController.abort();
    await reader.cancel().catch(() => {});
    await readerTask?.catch(() => {});
    await expect
      .poll(() => `${stdout.join('')}${stderr.join('')}`)
      .toContain(createRequestId);
    await expect
      .poll(() => `${stdout.join('')}${stderr.join('')}`)
      .toContain(streamRequestId);

    await worker.close();
    worker = undefined;
    await app.close();
    app = undefined;
    await fixture.close();
    fixture = undefined;
    await telemetry.close();
    telemetry = undefined;
    trace.disable();

    const otlp = Buffer.concat(otlpBodies);
    expect(otlp.length).toBeGreaterThan(0);
    expect(otlp.includes(Buffer.from(runId))).toBe(true);
    expect(otlp.includes(Buffer.from('openai/gpt-6-luna'))).toBe(true);

    const serializedLogs = `${stdout.join('')}${stderr.join('')}`;
    const serializedSse = JSON.stringify(observedFrames);
    for (const canary of [
      privatePromptCanary,
      fakeKeyCanary,
      providerErrorCanary,
    ]) {
      expect(serializedLogs).not.toContain(canary);
      expect(serializedSse).not.toContain(canary);
      expect(otlp.includes(Buffer.from(canary))).toBe(false);
    }
    expect(runEventsJson).not.toContain(providerErrorCanary);
  } finally {
    streamController.abort();
    await reader?.cancel().catch(() => {});
    await readerTask?.catch(() => {});
    try {
      await worker?.close();
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          await fixture?.close();
        } finally {
          try {
            await telemetry?.close();
          } finally {
            trace.disable();
            if (collectorListening) {
              collector.closeAllConnections();
              await new Promise<void>((resolve) =>
                collector.close(() => resolve()),
              );
            }
            stdoutSpy.mockRestore();
            stderrSpy.mockRestore();
          }
        }
      }
    }
  }
});
