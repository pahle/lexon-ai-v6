import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type CDPSession } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

// The indicator runs only with motion allowed.
test.use({ reducedMotion: 'no-preference' });

const TRACE_MS = 20_000;
const LONG_TASK_US = 50_000;
const CHUNKS = 800;
const expectedText = Array.from(
  { length: CHUNKS },
  (_, index) => `${String(index).padStart(4, '0')} `,
).join('');
const INDICATOR_PATTERN = /indicator|thinking-indicator|lexon-mark/i;

interface TraceEvent {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: {
    data?: {
      cpuProfile?: {
        nodes?: Array<{
          id: number;
          callFrame?: { url?: string; functionName?: string };
        }>;
        samples?: number[];
      };
      timeDeltas?: number[];
    };
  };
}

async function readStream(client: CDPSession, handle: string) {
  let data = '';
  for (;;) {
    const chunk = (await client.send('IO.read', { handle })) as {
      data: string;
      eof: boolean;
    };
    data += chunk.data;
    if (chunk.eof) break;
  }
  await client.send('IO.close', { handle });
  return data;
}

function analyse(events: TraceEvent[]) {
  // The renderer main thread is the thread that runs the most tasks.
  const tasks = events.filter(
    (event) => event.name === 'RunTask' && event.ph === 'X' && event.dur,
  );
  const perThread = new Map<string, number>();
  for (const task of tasks) {
    const key = `${task.pid}:${task.tid}`;
    perThread.set(key, (perThread.get(key) ?? 0) + 1);
  }
  const mainKey = [...perThread.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const longTasks = tasks
    .filter(
      (task) =>
        `${task.pid}:${task.tid}` === mainKey && task.dur! > LONG_TASK_US,
    )
    .sort((a, b) => a.ts! - b.ts!);
  // Sampled call frames (V8 CPU profile) give functions and URLs.
  const nodes = new Map<number, { url: string; fn: string }>();
  const samples: Array<{ ts: number; node: number }> = [];
  for (const event of events) {
    if (event.name === 'ProfileChunk') {
      const profile = event.args?.data?.cpuProfile;
      for (const node of profile?.nodes ?? [])
        nodes.set(node.id, {
          url: node.callFrame?.url ?? '',
          fn: node.callFrame?.functionName ?? '',
        });
      const deltas: number[] = event.args?.data?.timeDeltas ?? [];
      let ts = event.ts!;
      (profile?.samples ?? []).forEach((node: number, index: number) => {
        ts += deltas[index] ?? 0;
        samples.push({ ts, node });
      });
    }
  }
  let indicatorTasks = 0;
  for (const task of longTasks) {
    const end = task.ts! + task.dur!;
    const inside = events.filter(
      (event) =>
        event !== task &&
        `${event.pid}:${event.tid}` === mainKey &&
        event.ts! >= task.ts! &&
        event.ts! <= end,
    );
    const matchesEvent = inside.some((event) =>
      INDICATOR_PATTERN.test(JSON.stringify(event.args?.data ?? {})),
    );
    const matchesSample = samples.some((sample) => {
      if (sample.ts < task.ts! || sample.ts > end) return false;
      const node = nodes.get(sample.node);
      return node ? INDICATOR_PATTERN.test(node.url + ' ' + node.fn) : false;
    });
    if (matchesEvent || matchesSample) indicatorTasks += 1;
  }
  return {
    longTasks: longTasks.length,
    longestTaskMs: longTasks.length
      ? Math.max(...longTasks.map((task) => task.dur!)) / 1000
      : 0,
    indicatorTasks,
    frames: events.filter((event) => event.name === 'DrawFrame').length,
    hadProfile: samples.length > 0,
  };
}

test('records a Chromium trace of the thinking indicator during a long deterministic stream', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const stack = descriptor();
  const authHeaders = await authenticateApi(page.request, {
    name: 'Indicator trace identity',
  });
  const chatId = randomUUID();
  const created = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers: { ...authHeaders, 'content-type': 'application/json' },
    data: {
      chatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'trace seed prompt',
      effort: 'high',
    },
  });
  expect(created.status()).toBe(201);
  await page.goto(`${stack.publicUrl}/e2e/chat-runtime?chatId=${chatId}`);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(page.locator('[data-role="assistant"]').first()).toContainText(
    'Scripted answer: trace seed prompt',
  );
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();

  const client = await browser.newBrowserCDPSession();
  const complete = new Promise<{ stream?: string }>((resolve) =>
    client.on('Tracing.tracingComplete', resolve),
  );
  await client.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'disabled-by-default-v8.cpu_profiler',
        'v8.execute',
        'toplevel',
      ],
    },
  });
  const startedAt = Date.now();

  const sendButton = page.getByRole('button', { name: 'Send' });
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('long stream [indicator-trace:long]');
  await sendButton.click();
  const assistant = page.locator('[data-role="assistant"]').last();
  await expect(assistant).toContainText('0799', { timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
        );
        if (!response.ok()) return undefined;
        const tree = (await response.json()) as {
          messages: Array<{ role: string; status?: string; text: string }>;
        };
        const last = [...tree.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        return last ? { status: last.status, text: last.text } : undefined;
      },
      { timeout: 30_000 },
    )
    .toEqual({ status: 'completed', text: expectedText });
  const remaining = TRACE_MS - (Date.now() - startedAt);
  if (remaining > 0) await page.waitForTimeout(remaining);
  const durationMs = Date.now() - startedAt;
  await client.send('Tracing.end');
  const { stream } = await complete;
  expect(stream, 'the trace was captured').toBeTruthy();
  const raw = await readStream(client, stream!);
  await client.detach();
  const parsed = JSON.parse(raw) as
    { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  expect(events.length, 'the trace was captured').toBeGreaterThan(0);

  // The raw trace stays in the git-ignored test-results folder.
  await writeFile(testInfo.outputPath('indicator-trace.raw.json'), raw);
  const result = analyse(events);
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const target = path.resolve(
    process.cwd(),
    'docs/references/F4.1-indicator-trace.json',
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      {
        commit,
        durationMs,
        frames: result.frames,
        longTasksOver50ms: result.longTasks,
        longestTaskMs: result.longestTaskMs,
        streamedChars: expectedText.length,
        longTasksAttributedToIndicator: result.indicatorTasks,
        attribution: result.hadProfile
          ? 'RunTask over 50 ms on the renderer main thread, matched to the indicator by sampled V8 call frames and event URLs (indicator, thinking-indicator, lexon-mark); a production build can minify names, so a zero is a lower bound'
          : 'no CPU profile samples in the trace; event URLs only',
      },
      null,
      2,
    ) + '\n',
  );
  await expect(assistant).toContainText(expectedText.trim().slice(-9));
});
