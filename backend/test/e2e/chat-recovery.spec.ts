import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';

async function workerControl(
  op: 'status' | 'release-prefix' | 'release',
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
  } | null;
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
            .filter((message) => message.role === 'assistant')
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
    await expect
      .poll(async () => {
        const frames = await safeSseFrames(page);
        return frames.some(
          (frame) => frame.type === 'snapshot-start' && frame.reset === true,
        );
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await safeSseFrames(page)).some(
            (frame) => frame.type === 'snapshot-end',
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const replayFrames = await safeSseFrames(page);
    const snapshotStart = replayFrames.find(
      (frame) => frame.type === 'snapshot-start',
    );
    const snapshotEnd = replayFrames.find(
      (frame) => frame.type === 'snapshot-end',
    );
    expect(snapshotStart?.reset).toBe(true);
    expect(typeof snapshotStart?.partCount).toBe('number');
    expect(snapshotEnd?.partCount).toBe(snapshotStart?.partCount);
    const receivedPartIndices = [
      ...new Set(
        replayFrames
          .filter(
            (frame) =>
              frame.type === 'snapshot-part' &&
              typeof frame.partIndex === 'number',
          )
          .map((frame) => frame.partIndex!),
      ),
    ].sort((left, right) => left - right);
    expect(receivedPartIndices).toEqual(
      Array.from({ length: snapshotStart!.partCount! }, (_, index) => index),
    );
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
