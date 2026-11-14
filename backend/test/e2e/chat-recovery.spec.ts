import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';

async function workerControl(
  op: 'status' | 'release-prefix' | 'release' | 'expire',
  runId: string,
) {
  const worker = await containerId('ai-worker');
  const output = await docker([
    'exec',
    worker,
    'node',
    'backend/test/e2e/chat-worker-control.mjs',
    op,
    runId,
  ]);
  return JSON.parse(output) as {
    blocked?: boolean;
    prefixBlocked?: boolean;
    released?: boolean;
    before?: number;
    armed?: number;
    hadPositiveTtl?: boolean;
    remaining?: number;
  } | null;
}

async function publicApiHealthStatus(publicUrl: string): Promise<number> {
  try {
    const response = await fetch(`${publicUrl}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function safeSseFrames(page: Page) {
  return page.evaluate(() => {
    const recoveryWindow = window as Window & {
      __task11RecoveryFrames?: Array<{
        type?: string;
        id?: string;
        runId?: string;
        reset?: boolean;
        partCount?: number;
        partIndex?: number;
      }>;
    };
    return recoveryWindow.__task11RecoveryFrames ?? [];
  });
}

async function observeRunEvents(page: Page) {
  const eventRequests: Array<{
    runId: string;
    lastEventId?: string;
    recovery?: string;
  }> = [];
  const eventResponses: Array<{
    runId: string;
    status: number;
    recoveryResult?: string;
  }> = [];
  page.on('request', (request) => {
    const match = /\/api\/runs\/([^/]+)\/events$/.exec(
      new URL(request.url()).pathname,
    );
    if (!match?.[1]) return;
    const headers = request.headers();
    eventRequests.push({
      runId: match[1],
      ...(headers['last-event-id']
        ? { lastEventId: headers['last-event-id'] }
        : {}),
      ...(headers['x-lexon-stream-recovery']
        ? { recovery: headers['x-lexon-stream-recovery'] }
        : {}),
    });
  });
  page.on('response', (response) => {
    const match = /\/api\/runs\/([^/]+)\/events$/.exec(
      new URL(response.url()).pathname,
    );
    if (!match?.[1]) return;
    void response.allHeaders().then((headers) =>
      eventResponses.push({
        runId: match[1]!,
        status: response.status(),
        ...(headers['x-lexon-stream-recovery-result']
          ? { recoveryResult: headers['x-lexon-stream-recovery-result'] }
          : {}),
      }),
    );
  });
  await page.addInitScript(() => {
    type SafeFrame = {
      type?: string;
      id?: string;
      runId?: string;
      reset?: boolean;
      partCount?: number;
      partIndex?: number;
    };
    const recoveryWindow = window as Window & {
      __task11RecoveryFrames?: SafeFrame[];
    };
    recoveryWindow.__task11RecoveryFrames = [];
    const browserFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await browserFetch(input, init);
      const requestUrl = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        window.location.href,
      );
      if (!/\/api\/runs\/[^/]+\/events$/.test(requestUrl.pathname))
        return response;
      const reader = response.clone().body?.getReader();
      if (!reader) return response;
      void (async () => {
        const decoder = new TextDecoder();
        let buffer = '';
        const record = (raw: string) => {
          let id: string | undefined;
          let data: string | undefined;
          for (const line of raw.split('\n')) {
            if (line.startsWith('id: ')) id = line.slice(4);
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) return false;
          try {
            const value = JSON.parse(data) as Record<string, unknown>;
            const summary: SafeFrame = {
              ...(typeof value.type === 'string' ? { type: value.type } : {}),
              ...(id ? { id } : {}),
              ...(typeof value.runId === 'string'
                ? { runId: value.runId }
                : {}),
              ...(value.reset === true ? { reset: true } : {}),
              ...(typeof value.partCount === 'number'
                ? { partCount: value.partCount }
                : {}),
              ...(typeof value.partIndex === 'number'
                ? { partIndex: value.partIndex }
                : {}),
            };
            recoveryWindow.__task11RecoveryFrames?.push(summary);
            return summary.type === 'finish';
          } catch {
            return false;
          }
        };
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder
              .decode(value, { stream: true })
              .replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const terminal = record(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
              if (terminal) {
                await reader.cancel();
                return;
              }
              boundary = buffer.indexOf('\n\n');
            }
          }
          buffer += decoder.decode();
          if (buffer) record(buffer);
        } catch {
          recoveryWindow.__task11RecoveryFrames?.push({
            type: 'observer-read-failed',
          });
        }
      })();
      return response;
    };
  });
  return { eventRequests, eventResponses };
}

async function expectCompleteResetSnapshot(page: Page) {
  await expect
    .poll(
      async () =>
        (await safeSseFrames(page)).some(
          (frame) => frame.type === 'snapshot-end',
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  const frames = await safeSseFrames(page);
  const snapshotStart = frames.find((frame) => frame.type === 'snapshot-start');
  const snapshotEnd = frames.find((frame) => frame.type === 'snapshot-end');
  expect(snapshotStart?.reset).toBe(true);
  expect(typeof snapshotStart?.partCount).toBe('number');
  expect(snapshotEnd?.partCount).toBe(snapshotStart?.partCount);
  const partIndices = [
    ...new Set(
      frames
        .filter(
          (frame) =>
            frame.type === 'snapshot-part' &&
            typeof frame.partIndex === 'number',
        )
        .map((frame) => frame.partIndex!),
    ),
  ].sort((left, right) => left - right);
  expect(partIndices).toEqual(
    Array.from({ length: snapshotStart!.partCount! }, (_, index) => index),
  );
}

test('recovers a held answer after SIGKILL and restart of ai-worker', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stack = descriptor();
  const authHeaders = await authenticateApi(page.request, {
    name: 'Compose SIGKILL recovery identity',
  });
  const chatId = randomUUID();
  const seedUserMessageId = randomUUID();
  const seed = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers: { ...authHeaders, 'content-type': 'application/json' },
    data: {
      chatId,
      userMessageId: seedUserMessageId,
      requestId: randomUUID(),
      text: 'Compose worker recovery seed',
      effort: 'high',
    },
  });
  expect(seed.status()).toBe(201);
  const seedMutation = (await seed.json()) as { runId: string };
  expect(seedMutation.runId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
          { headers: authHeaders },
        );
        if (!response.ok()) return undefined;
        const tree = (await response.json()) as {
          messages: Array<{ role: string; status?: string }>;
        };
        return tree.messages
          .filter((message) => message.role === 'assistant')
          .at(-1)?.status;
      },
      { timeout: 60_000 },
    )
    .toBe('completed');

  const { eventRequests, eventResponses } = await observeRunEvents(page);

  let workerContainerId: string | undefined;
  try {
    await page.goto(`${stack.publicUrl}/e2e/chat-runtime?chatId=${chatId}`);
    await expect(
      page.getByRole('heading', { name: 'Runtime proof' }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill('[runtime-proof:hold]');
    await page.getByRole('button', { name: 'Send' }).click();

    let activeRunId: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${stack.apiUrl}/api/chats/${chatId}`,
            { headers: authHeaders },
          );
          if (!response.ok()) return undefined;
          const tree = (await response.json()) as {
            messages: Array<{
              id: string;
              parentId: string | null;
              role: string;
              runId?: string;
            }>;
          };
          const latestUser = tree.messages
            .filter((message) => message.role === 'user')
            .at(-1);
          const latestAssistant = tree.messages
            .filter(
              (message) =>
                message.role === 'assistant' &&
                message.runId !== seedMutation.runId,
            )
            .at(-1);
          activeRunId =
            latestUser && latestAssistant?.parentId === latestUser.id
              ? latestAssistant.runId
              : undefined;
          return activeRunId;
        },
        { timeout: 60_000 },
      )
      .toBeTruthy();
    if (!activeRunId) throw new Error('The held run has no server run ID');

    await expect
      .poll(() => workerControl('status', activeRunId!), {
        timeout: 60_000,
      })
      .toMatchObject({ prefixBlocked: true });
    await expect
      .poll(() =>
        eventResponses.some(
          (event) => event.runId === activeRunId && event.status === 200,
        ),
      )
      .toBe(true);
    await workerControl('release-prefix', activeRunId);
    const assistant = page.locator('[data-role="assistant"]').last();
    await expect(assistant).toHaveAttribute(
      'data-text-content',
      'Answer prefix — ',
    );
    await expect
      .poll(() => workerControl('status', activeRunId!))
      .toMatchObject({ blocked: true, released: false });

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${stack.apiUrl}/api/chats/${chatId}`,
            { headers: authHeaders },
          );
          if (!response.ok()) return undefined;
          const tree = (await response.json()) as {
            messages: Array<{
              role: string;
              runId?: string;
              text: string;
            }>;
          };
          const persistedPrefix = tree.messages
            .filter((message) => message.role === 'assistant')
            .at(-1);
          return persistedPrefix
            ? { runId: persistedPrefix.runId, text: persistedPrefix.text }
            : undefined;
        },
        { timeout: 30_000 },
      )
      .toEqual({ runId: activeRunId, text: 'Answer prefix — ' });

    const actorScope = await page
      .getByTestId('seed-inspection')
      .getAttribute('data-actor-scope');
    if (!actorScope)
      throw new Error('The proof page did not expose its actor scope');
    const recoveryKey = `lexon-chat-recovery:${actorScope}:${chatId}`;
    const firstCursor = await page.evaluate((key) => {
      const stored = sessionStorage.getItem(key);
      return stored
        ? (JSON.parse(stored) as { cursor?: string }).cursor
        : undefined;
    }, recoveryKey);
    expect(firstCursor).toMatch(/^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/);

    workerContainerId = await containerId('ai-worker');
    await docker(['kill', '--signal=SIGKILL', workerContainerId]);
    expect(
      await docker([
        'inspect',
        '--format',
        '{{.State.ExitCode}}',
        workerContainerId,
      ]),
    ).toBe('137');
    const runningAfterKill = await docker([
      'inspect',
      '--format',
      '{{.State.Running}}',
      workerContainerId,
    ]);
    if (runningAfterKill !== 'true') await docker(['start', workerContainerId]);

    await expect
      .poll(
        () =>
          docker([
            'inspect',
            '--format',
            '{{.State.Health.Status}}',
            workerContainerId!,
          ]),
        { timeout: 180_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe('healthy');
    await expect
      .poll(() => workerControl('status', activeRunId!), {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .toMatchObject({ prefixBlocked: true });

    const recoveryCursor = await page.evaluate((key) => {
      const stored = sessionStorage.getItem(key);
      return stored
        ? (JSON.parse(stored) as { cursor?: string }).cursor
        : undefined;
    }, recoveryKey);
    expect(recoveryCursor).toMatch(/^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/);
    const recoveryCheckpointResponse = await page.request.get(
      `${stack.apiUrl}/api/chats/${chatId}`,
      { headers: authHeaders },
    );
    expect(recoveryCheckpointResponse.status()).toBe(200);
    const recoveryCheckpointTree =
      (await recoveryCheckpointResponse.json()) as {
        messages: Array<{
          role: string;
          runId?: string;
          text: string;
        }>;
      };
    const recoveryCheckpoint = recoveryCheckpointTree.messages
      .filter((message) => message.role === 'assistant')
      .at(-1);
    expect(recoveryCheckpoint?.runId).toBe(activeRunId);
    if (typeof recoveryCheckpoint?.text !== 'string')
      throw new Error('Recovered assistant checkpoint is not text');
    const authoritativeCheckpointText = recoveryCheckpoint.text;

    const replayRequestCount = eventRequests.length;
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Runtime proof' }),
    ).toBeVisible();
    await expect
      .poll(() => eventRequests.length, { timeout: 30_000 })
      .toBeGreaterThan(replayRequestCount);
    const replayRequest = eventRequests
      .filter((event) => event.runId === activeRunId)
      .at(-1);
    expect(replayRequest?.lastEventId).toBe(recoveryCursor);
    expect(replayRequest?.recovery).toBe('snapshot');
    await expect
      .poll(() =>
        eventResponses.some(
          (event) =>
            event.runId === activeRunId &&
            event.status === 200 &&
            event.recoveryResult === 'snapshot',
        ),
      )
      .toBe(true);
    await expectCompleteResetSnapshot(page);
    await expect(assistant).toHaveAttribute(
      'data-text-content',
      authoritativeCheckpointText,
    );

    await workerControl('release-prefix', activeRunId);
    await expect(assistant).toHaveAttribute(
      'data-text-content',
      'Answer prefix — ',
    );
    await expect
      .poll(() => workerControl('status', activeRunId!))
      .toMatchObject({ blocked: true, released: false });
    const releaseState = await workerControl('release', activeRunId);
    expect(releaseState?.released).toBe(true);

    let completedText: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${stack.apiUrl}/api/chats/${chatId}`,
            { headers: authHeaders },
          );
          if (!response.ok()) return undefined;
          const tree = (await response.json()) as {
            messages: Array<{
              role: string;
              status?: string;
              text: string;
            }>;
          };
          const assistantMessages = tree.messages.filter(
            (message) => message.role === 'assistant',
          );
          const completed = assistantMessages.filter(
            (message) =>
              message.status === 'completed' &&
              message.text === 'Answer prefix — answer suffix.',
          );
          completedText = completed[0]?.text;
          return completed.length;
        },
        { timeout: 120_000 },
      )
      .toBe(1);
    await expect(assistant).toHaveAttribute(
      'data-text-content',
      'Answer prefix — answer suffix.',
    );
    expect(completedText).toBe('Answer prefix — answer suffix.');

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Runtime proof' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toHaveAttribute('data-text-content', 'Answer prefix — answer suffix.');
  } finally {
    if (workerContainerId) {
      const running = await docker([
        'inspect',
        '--format',
        '{{.State.Running}}',
        workerContainerId,
      ]).catch(() => 'false');
      if (running !== 'true') await docker(['start', workerContainerId]);
    }
  }
});

test('recovers a held answer through Caddy after Backend API restart', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stack = descriptor();
  const authHeaders = await authenticateApi(page.request, {
    name: 'Backend restart recovery identity',
  });
  const chatId = randomUUID();
  const seed = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers: { ...authHeaders, 'content-type': 'application/json' },
    data: {
      chatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Backend restart recovery seed',
      effort: 'high',
    },
  });
  expect(seed.status()).toBe(201);
  const seedMutation = (await seed.json()) as { runId: string };
  expect(seedMutation.runId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
          { headers: authHeaders },
        );
        if (!response.ok()) return undefined;
        const tree = (await response.json()) as {
          messages: Array<{ role: string; status?: string }>;
        };
        return tree.messages
          .filter((message) => message.role === 'assistant')
          .at(-1)?.status;
      },
      { timeout: 60_000 },
    )
    .toBe('completed');

  const { eventRequests, eventResponses } = await observeRunEvents(page);
  const workerContainerId = await containerId('ai-worker');
  expect(
    await docker([
      'inspect',
      '--format',
      '{{.State.Running}}',
      workerContainerId,
    ]),
  ).toBe('true');
  let apiContainerId: string | undefined;
  let activeRunId: string | undefined;
  try {
    await page.goto(`${stack.publicUrl}/e2e/chat-runtime?chatId=${chatId}`);
    await expect(
      page.getByRole('heading', { name: 'Runtime proof' }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill('[runtime-proof:hold]');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${stack.apiUrl}/api/chats/${chatId}`,
            { headers: authHeaders },
          );
          if (!response.ok()) return undefined;
          const tree = (await response.json()) as {
            messages: Array<{
              id: string;
              parentId: string | null;
              role: string;
              runId?: string;
            }>;
          };
          const latestUser = tree.messages
            .filter((message) => message.role === 'user')
            .at(-1);
          const latestAssistant = tree.messages
            .filter(
              (message) =>
                message.role === 'assistant' &&
                message.runId !== seedMutation.runId,
            )
            .at(-1);
          activeRunId =
            latestUser && latestAssistant?.parentId === latestUser.id
              ? latestAssistant.runId
              : undefined;
          return activeRunId;
        },
        { timeout: 60_000 },
      )
      .toBeTruthy();
    if (!activeRunId) throw new Error('The held run has no server run ID');

    await expect
      .poll(() => workerControl('status', activeRunId!), {
        timeout: 60_000,
      })
      .toMatchObject({ prefixBlocked: true });
    await expect
      .poll(() =>
        eventResponses.some(
          (event) => event.runId === activeRunId && event.status === 200,
        ),
      )
      .toBe(true);
    await workerControl('release-prefix', activeRunId);
    const assistant = page.locator('[data-role="assistant"]').last();
    await expect(assistant).toHaveAttribute(
      'data-text-content',
      'Answer prefix — ',
    );
    await expect
      .poll(() => workerControl('status', activeRunId!))
      .toMatchObject({ blocked: true, released: false });

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${stack.apiUrl}/api/chats/${chatId}`,
            { headers: authHeaders },
          );
          if (!response.ok()) return undefined;
          const tree = (await response.json()) as {
            messages: Array<{ role: string; runId?: string; text: string }>;
          };
          const latestAssistant = tree.messages
            .filter((message) => message.role === 'assistant')
            .at(-1);
          return latestAssistant
            ? { runId: latestAssistant.runId, text: latestAssistant.text }
            : undefined;
        },
        { timeout: 30_000 },
      )
      .toEqual({ runId: activeRunId, text: 'Answer prefix — ' });

    const actorScope = await page
      .getByTestId('seed-inspection')
      .getAttribute('data-actor-scope');
    if (!actorScope)
      throw new Error('The proof page did not expose its actor scope');
    const recoveryKey = `lexon-chat-recovery:${actorScope}:${chatId}`;
    const recoveryCursor = await page.evaluate((key) => {
      const stored = sessionStorage.getItem(key);
      return stored
        ? (JSON.parse(stored) as { cursor?: string }).cursor
        : undefined;
    }, recoveryKey);
    expect(recoveryCursor).toMatch(/^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/);

    apiContainerId = await containerId('api');
    const apiStartedAtBefore = await docker([
      'inspect',
      '--format',
      '{{.State.StartedAt}}',
      apiContainerId,
    ]);
    const hotReconnectCount = eventRequests.filter(
      (event) => event.runId === activeRunId,
    ).length;
    await docker(['restart', apiContainerId]);
    await expect
      .poll(
        () =>
          docker([
            'inspect',
            '--format',
            '{{.State.StartedAt}}',
            apiContainerId!,
          ]),
        { timeout: 60_000 },
      )
      .not.toBe(apiStartedAtBefore);
    await expect
      .poll(() => publicApiHealthStatus(stack.publicUrl), {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .toBe(200);
    await expect
      .poll(
        () =>
          eventRequests.filter((event) => event.runId === activeRunId).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(hotReconnectCount);
    await expect
      .poll(() =>
        eventResponses.some(
          (event) =>
            event.runId === activeRunId &&
            event.status === 200 &&
            event.recoveryResult === 'incremental',
        ),
      )
      .toBe(true);
    const hotReconnectRequest = eventRequests
      .filter(
        (event) =>
          event.runId === activeRunId &&
          event.lastEventId === recoveryCursor &&
          event.recovery === 'incremental',
      )
      .at(-1);
    expect(hotReconnectRequest).toMatchObject({
      runId: activeRunId,
      lastEventId: recoveryCursor,
      recovery: 'incremental',
    });
    expect(await containerId('ai-worker')).toBe(workerContainerId);
    expect(
      await docker([
        'inspect',
        '--format',
        '{{.State.Running}}',
        workerContainerId,
      ]),
    ).toBe('true');
    await expect
      .poll(() => workerControl('status', activeRunId!))
      .toMatchObject({ blocked: true, released: false });

    const checkpointResponse = await page.request.get(
      `${stack.apiUrl}/api/chats/${chatId}`,
      { headers: authHeaders },
    );
    expect(checkpointResponse.status()).toBe(200);
    const checkpointTree = (await checkpointResponse.json()) as {
      messages: Array<{ role: string; runId?: string; text: string }>;
    };
    const checkpoint = checkpointTree.messages
      .filter((message) => message.role === 'assistant')
      .at(-1);
    expect(checkpoint?.runId).toBe(activeRunId);
    expect(checkpoint?.text).toBe('Answer prefix — ');
    const checkpointText = checkpoint!.text;

    const reconnectRequestCount = eventRequests.length;
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Runtime proof' }),
    ).toBeVisible();
    await expect
      .poll(() => eventRequests.length, { timeout: 30_000 })
      .toBeGreaterThan(reconnectRequestCount);
    const reconnectRequest = eventRequests
      .filter((event) => event.runId === activeRunId)
      .at(-1);
    expect(reconnectRequest?.lastEventId).toBe(recoveryCursor);
    expect(reconnectRequest?.recovery).toBe('snapshot');
    await expect
      .poll(() =>
        eventResponses.some(
          (event) =>
            event.runId === activeRunId &&
            event.status === 200 &&
            event.recoveryResult === 'snapshot',
        ),
      )
      .toBe(true);
    await expectCompleteResetSnapshot(page);
    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toHaveAttribute('data-text-content', checkpointText);

    expect(await containerId('ai-worker')).toBe(workerContainerId);
    await expect
      .poll(() => workerControl('status', activeRunId!))
      .toMatchObject({ blocked: true, released: false });
    const releaseState = await workerControl('release', activeRunId);
    expect(releaseState?.released).toBe(true);

    let completedText: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${stack.apiUrl}/api/chats/${chatId}`,
            { headers: authHeaders },
          );
          if (!response.ok()) return undefined;
          const tree = (await response.json()) as {
            messages: Array<{
              role: string;
              status?: string;
              text: string;
            }>;
          };
          const completed = tree.messages.filter(
            (message) =>
              message.role === 'assistant' &&
              message.status === 'completed' &&
              message.text === 'Answer prefix — answer suffix.',
          );
          completedText = completed[0]?.text;
          return completed.length;
        },
        { timeout: 120_000 },
      )
      .toBe(1);
    const assistantAfterRestart = page
      .locator('[data-role="assistant"]')
      .last();
    await expect(assistantAfterRestart).toHaveAttribute(
      'data-text-content',
      'Answer prefix — answer suffix.',
    );
    expect(completedText).toBe('Answer prefix — answer suffix.');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Runtime proof' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toHaveAttribute('data-text-content', 'Answer prefix — answer suffix.');
  } finally {
    try {
      if (activeRunId) {
        const state = await workerControl('status', activeRunId);
        if (state?.prefixBlocked)
          await workerControl('release-prefix', activeRunId);
        const afterPrefix = state?.prefixBlocked
          ? await workerControl('status', activeRunId)
          : state;
        if (afterPrefix?.blocked && !afterPrefix.released)
          await workerControl('release', activeRunId);
      }
    } finally {
      if (apiContainerId) {
        const apiState = await docker([
          'inspect',
          '--format',
          '{{.State.Status}}',
          apiContainerId,
        ]).catch(() => 'unknown');
        if (apiState === 'exited' || apiState === 'created')
          await docker(['start', apiContainerId]);
        await expect
          .poll(() => publicApiHealthStatus(stack.publicUrl), {
            timeout: 120_000,
            intervals: [1_000, 2_000, 5_000],
          })
          .toBe(200);
      }
    }
  }
});

test('recovers a completed answer from PostgreSQL after terminal stream expiry', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = descriptor();
  const authHeaders = await authenticateApi(page.request, {
    name: 'Completed stream expiry identity',
  });
  const onboarding = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers: authHeaders, data: {} },
  );
  expect(onboarding.status()).toBe(204);
  const identityResponse = await page.request.get(
    `${stack.apiUrl}/api/identity`,
    { headers: authHeaders },
  );
  expect(identityResponse.status()).toBe(200);
  const identity = (await identityResponse.json()) as {
    organization: { id: string };
    user: { id: string };
  };
  const actorScope = `${identity.organization.id}:${identity.user.id}`;
  const { eventRequests, eventResponses } = await observeRunEvents(page);

  await page.goto(`${stack.publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await composer.fill(
    '[runtime-proof:hold] [task14:raw-duration] Summarize the limitation-of-liability clause and propose a balanced cap.',
  );
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  const chatId = new URL(page.url()).pathname.split('/').at(-1)!;
  let activeRunId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
          { headers: authHeaders },
        );
        if (!response.ok()) return undefined;
        const tree = (await response.json()) as {
          messages: Array<{
            id: string;
            parentId: string | null;
            role: string;
            runId?: string;
          }>;
        };
        const latestUser = tree.messages
          .filter((message) => message.role === 'user')
          .at(-1);
        const latestAssistant = tree.messages
          .filter((message) => message.role === 'assistant')
          .at(-1);
        activeRunId =
          latestUser && latestAssistant?.parentId === latestUser.id
            ? latestAssistant.runId
            : undefined;
        return activeRunId;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  if (!activeRunId) throw new Error('The live answer has no server run ID');
  await expect
    .poll(() => workerControl('status', activeRunId!), { timeout: 30_000 })
    .toMatchObject({ prefixBlocked: true });
  await expect
    .poll(() =>
      eventResponses.some(
        (event) => event.runId === activeRunId && event.status === 200,
      ),
    )
    .toBe(true);
  await workerControl('release-prefix', activeRunId);
  const assistant = page.locator('[data-role="assistant"]').last();
  await expect(assistant.locator('.aui-md')).toContainText('Answer prefix — ');
  const prefixState = await workerControl('status', activeRunId);
  expect(prefixState).toMatchObject({ blocked: true, released: false });
  const recoveryKey = `lexon-chat-recovery:${actorScope}:${chatId}`;
  const retainedCursor = await page.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    return stored
      ? (JSON.parse(stored) as { cursor?: string }).cursor
      : undefined;
  }, recoveryKey);
  expect(retainedCursor).toMatch(/^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/);

  const releaseState = await workerControl('release', activeRunId);
  expect(releaseState?.released).toBe(true);
  let completedAssistant:
    | {
        id: string;
        text: string;
        reasoningSummary?: string | null;
        reasoningDurationMs?: number | null;
        status?: string;
      }
    | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
          { headers: authHeaders },
        );
        if (!response.ok()) return undefined;
        const tree = (await response.json()) as {
          messages: Array<{
            id: string;
            role: string;
            text: string;
            status?: string;
            reasoningSummary?: string | null;
            reasoningDurationMs?: number | null;
          }>;
        };
        const completed = tree.messages.filter(
          (message) =>
            message.role === 'assistant' && message.status === 'completed',
        );
        completedAssistant = completed.at(-1);
        return completed.length;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  expect(completedAssistant).toMatchObject({
    status: 'completed',
    reasoningSummary: null,
    reasoningDurationMs: 2_300,
  });
  if (!completedAssistant) throw new Error('Expected a completed assistant');
  expect(completedAssistant.text.length).toBeGreaterThan(0);
  await expect(assistant.locator('.aui-md')).toHaveText(
    completedAssistant.text,
  );
  await expect(assistant).toContainText('Thought for 2 seconds');
  await expect(
    assistant.getByRole('button', { name: 'Thought for 2 seconds' }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      safeSseFrames(page).then((frames) =>
        frames.some(
          (frame) => frame.runId === activeRunId && frame.type === 'finish',
        ),
      ),
    )
    .toBe(true);

  const expiry = await workerControl('expire', activeRunId);
  expect(expiry).toMatchObject({
    before: 3,
    armed: 3,
    hadPositiveTtl: true,
    remaining: 0,
  });

  const expiredTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
    { headers: authHeaders },
  );
  expect(expiredTreeResponse.status()).toBe(200);
  const expiredTree = (await expiredTreeResponse.json()) as {
    messages: Array<{
      id: string;
      role: string;
      runId?: string;
      status?: string;
      text: string;
      reasoningSummary?: string | null;
      reasoningDurationMs?: number | null;
    }>;
  };
  expect(
    expiredTree.messages.filter((message) => message.role === 'assistant'),
  ).toEqual([
    expect.objectContaining({
      id: completedAssistant.id,
      runId: activeRunId,
      status: 'completed',
      text: completedAssistant.text,
      reasoningSummary: null,
      reasoningDurationMs: 2_300,
    }),
  ]);

  const snapshotResponse = await page.evaluate(
    async ({ runId, lastEventId }) => {
      const response = await fetch(`/api/runs/${runId}/events`, {
        headers: {
          'last-event-id': lastEventId,
          'x-lexon-stream-recovery': 'incremental',
        },
        signal: AbortSignal.timeout(15_000),
      });
      return {
        status: response.status,
        recoveryResult: response.headers.get('x-lexon-stream-recovery-result'),
        body: await response.text(),
      };
    },
    { runId: activeRunId, lastEventId: retainedCursor! },
  );
  expect(snapshotResponse.status).toBe(200);
  expect(snapshotResponse.recoveryResult).toBe('snapshot');
  const snapshotFrames = snapshotResponse.body
    .split(/\r?\n\r?\n/)
    .flatMap((block) => {
      const data = block
        .split(/\r?\n/)
        .find((line) => line.startsWith('data: '))
        ?.slice(6);
      if (!data) return [];
      try {
        return [JSON.parse(data) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  const snapshotStart = snapshotFrames.find(
    (frame) => frame.type === 'snapshot-start',
  );
  expect(snapshotStart).toMatchObject({
    reset: true,
    snapshot: {
      runId: activeRunId,
      status: 'completed',
      reasoningDurationMs: 2_300,
    },
  });
  const snapshotEnd = snapshotFrames.find(
    (frame) => frame.type === 'snapshot-end',
  );
  expect(snapshotEnd).toBeDefined();
  const textSnapshot = snapshotFrames
    .filter(
      (frame) => frame.type === 'snapshot-part' && frame.partType === 'text',
    )
    .map((frame) => frame.text)
    .join('');
  const reasoningSnapshot = snapshotFrames.filter(
    (frame) => frame.type === 'snapshot-part' && frame.partType === 'reasoning',
  );
  expect(textSnapshot).toBe(completedAssistant.text);
  expect(reasoningSnapshot).toHaveLength(0);
  expect(snapshotFrames.some((frame) => frame.type === 'finish')).toBe(true);

  const expiryAfterReplay = await workerControl('expire', activeRunId);
  expect(expiryAfterReplay).toMatchObject({
    before: 0,
    armed: 0,
    remaining: 0,
  });

  await page.reload();
  const reloadedAssistant = page.locator('[data-role="assistant"]');
  await expect(reloadedAssistant).toHaveCount(1);
  await expect(reloadedAssistant.locator('.aui-md')).toHaveText(
    completedAssistant.text,
  );
  await expect(reloadedAssistant).toContainText('Thought for 2 seconds');
  await expect(
    reloadedAssistant.getByRole('button', { name: 'Thought for 2 seconds' }),
  ).toHaveCount(0);
  const afterReload = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
    { headers: authHeaders },
  );
  expect(afterReload.status()).toBe(200);
  const afterReloadTree = (await afterReload.json()) as {
    messages: Array<{ role: string; id: string; runId?: string }>;
  };
  const assistantMessages = afterReloadTree.messages.filter(
    (message) => message.role === 'assistant',
  );
  expect(assistantMessages).toHaveLength(1);
  expect(assistantMessages[0]).toMatchObject({
    id: completedAssistant.id,
    runId: activeRunId,
  });
  expect(
    eventRequests.some(
      (request) =>
        request.runId === activeRunId && request.lastEventId === retainedCursor,
    ),
  ).toBe(true);
});
