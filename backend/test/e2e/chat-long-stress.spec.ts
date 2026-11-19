import { expect, test } from '@playwright/test';
import { ChatTreeSchema } from '@lexon/contracts';
import {
  assistantMessage,
  chatId,
  fileNames,
  setupAnsweredChat,
  timestamp,
  userMessage,
} from './chat-state-fixtures.js';

// G4 (F4.2): a long conversation with a fast 120-chunk stream under a 4x CPU
// throttle (R6b) must not loop renders, must settle, and must keep the
// scroll-to-latest and run-start behavior (G3). Chromium only.
const newUserId = '00000000-0000-4000-8000-000000000391';
const newAssistantId = '00000000-0000-4000-8000-000000000392';
const newRunId = '00000000-0000-4000-8000-000000000393';
const idFor = (kind: number, index: number) =>
  `00000000-0000-4000-8000-0000000002${kind}${index}`;

const paragraph = (seed: number) =>
  Array.from(
    { length: 6 },
    (_, sentence) =>
      `Pasal ${seed + sentence} menjelaskan ketentuan perjanjian, akibat hukumnya, dan upaya yang tersedia bagi pihak yang dirugikan.`,
  ).join(' ');

const chunks = Array.from({ length: 120 }, (_, index) => {
  const lead = index > 0 && index % 12 === 0 ? '\n\n' : '';
  return `${lead}Kalimat ${index} menguraikan syarat sah perjanjian dan akibat hukumnya. `;
});
const expectedText = chunks.join('').replace(/\s+/g, ' ').trim();

function exchanges() {
  const messages = [];
  let parentId: string | null = null;
  for (let index = 0; index < 8; index += 1) {
    const user = {
      ...userMessage(idFor(1, index)),
      parentId,
      text: `Pertanyaan ${index + 1}: jelaskan secara rinci ketentuan perjanjian dan akibat hukumnya.`,
    };
    const assistant = {
      ...assistantMessage('answer-complete', idFor(2, index), user.id),
      runId: idFor(3, index),
      text: Array.from({ length: 6 }, (_, p) => paragraph(index * 10 + p)).join(
        '\n\n',
      ),
      reasoningSummary: null,
      reasoningDurationMs: null,
    };
    messages.push(user, assistant);
    parentId = assistant.id;
  }
  return { messages, last: parentId as string };
}

test('long conversation, fast stream, 4x CPU: no render loop, settles, scrolls', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const stack = await setupAnsweredChat(page, 'hukum-nusantara-stress');
  const history = exchanges();
  let phase: 'idle' | 'sent' | 'done' = 'idle';
  let sentUserId = newUserId;
  const treeNow = () => {
    const messages: unknown[] = [...history.messages];
    if (phase !== 'idle') {
      messages.push(
        {
          ...userMessage(sentUserId),
          parentId: history.last,
          text: 'Pertanyaan baru: jelaskan lagi dengan contoh.',
        },
        {
          ...assistantMessage(
            phase === 'sent' ? 'streaming-answer' : 'answer-complete',
            newAssistantId,
            sentUserId,
          ),
          runId: newRunId,
          text: phase === 'sent' ? '' : expectedText,
          reasoningDurationMs: phase === 'sent' ? null : 14_000,
        },
      );
    }
    return ChatTreeSchema.parse({
      id: chatId,
      title: fileNames.newChat,
      messages,
      viewedLeafId: phase === 'idle' ? history.last : newAssistantId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };
  await page.exposeFunction('g4StreamDone', () => {
    phase = 'done';
  });
  await page.route(
    (url) => url.pathname.startsWith(`/api/chats/${chatId}`),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === `/api/chats/${chatId}`)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(treeNow()),
        });
      if (request.method() === 'POST' && path === `/api/chats/${chatId}/messages`) {
        sentUserId = (request.postDataJSON() as { userMessageId: string })
          .userMessageId;
        phase = 'sent';
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            chatId,
            userMessageId: sentUserId,
            assistantMessageId: newAssistantId,
            runId: newRunId,
          }),
        });
      }
      return route.fallback();
    },
  );
  await page.addInitScript(
    ({ runId, assistantId, parts }) => {
      const win = window as Window & {
        g4StreamDone?: () => void;
        __longTasks?: number[];
      };
      win.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          win.__longTasks!.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const raw =
          typeof input === 'string' || input instanceof URL
            ? String(input)
            : input.url;
        const url = new URL(raw, window.location.href);
        if (url.pathname !== `/api/runs/${runId}/events`)
          return nativeFetch(input, init);
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (frame: unknown) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
              );
            send({
              type: 'snapshot-start',
              version: 1,
              reset: true,
              snapshot: {
                runId,
                messageId: assistantId,
                attemptId: null,
                generation: null,
                revision: 0,
                eventId: null,
                status: 'running',
                errorCode: null,
                reasoningDurationMs: null,
              },
              partCount: 2,
              operationCount: 0,
            });
            send({
              type: 'snapshot-part',
              version: 1,
              partIndex: 0,
              chunkIndex: 0,
              partType: 'reasoning',
              id: 'stress-reasoning',
              text: 'Menimbang syarat sah perjanjian.',
              final: true,
            });
            let next = 0;
            const tick = () => {
              if (next < parts.length) {
                send({
                  type: 'snapshot-part',
                  version: 1,
                  partIndex: 1,
                  chunkIndex: next,
                  partType: 'text',
                  id: 'stress-answer',
                  text: parts[next],
                  final: next === parts.length - 1,
                });
                next += 1;
                setTimeout(tick, 15);
                return;
              }
              send({
                type: 'snapshot-end',
                version: 1,
                partCount: 2,
                operationCount: 0,
              });
              win.g4StreamDone?.();
              controller.close();
            };
            setTimeout(tick, 50);
          },
        });
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        });
      };
    },
    { runId: newRunId, assistantId: newAssistantId, parts: chunks },
  );

  const messages: string[] = [];
  const loop = /Maximum update depth|render loop|React error #185/i;
  const record = (text: string) => {
    messages.push(text);
    if (loop.test(text)) console.log(`G4 LOOP: ${text.slice(0, 160)}`);
  };
  page.on('console', (message) => record(message.text()));
  page.on('pageerror', (error) => record(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto(`${stack.publicUrl}/chats/${chatId}`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await expect(composer).toBeVisible();
  await expect(page.locator('[data-role="user"]')).toHaveCount(8);
  // Count long tasks from the send onward (page load is not what G4 tunes).
  await page.evaluate(() => {
    (window as Window & { __longTasks?: number[] }).__longTasks = [];
  });
  await composer.fill('Pertanyaan baru: jelaskan lagi dengan contoh.');
  await page.keyboard.press('Enter');

  // G3: the new user question lands near the top of the thread viewport.
  const viewport = page.locator('[data-slot="aui_thread-viewport"]');
  const asked = page
    .locator('[data-role="user"]')
    .filter({ hasText: 'Pertanyaan baru' });
  await expect(asked).toBeVisible();
  await expect
    .poll(
      async () => {
        const [m, v] = await Promise.all([
          asked.boundingBox(),
          viewport.boundingBox(),
        ]);
        return m && v ? m.y - v.y : 9999;
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(80);

  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({
    timeout: 120_000,
  });
  await expect(page.getByText(/Thought for/).last()).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await page.locator('[data-role="assistant"]').last().innerText()
        )
          .replace(/\s+/g, ' ')
          .trim(),
      { timeout: 30_000 },
    )
    .toContain(expectedText);

  await viewport.evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }),
  );
  await expect(page.locator('button.aui-thread-scroll-to-bottom')).toBeHidden();

  const longTasks = await page.evaluate(
    () => (window as Window & { __longTasks?: number[] }).__longTasks ?? [],
  );
  const over50 = longTasks.filter((duration) => duration > 50);
  test.info().annotations.push({
    type: 'long-tasks',
    description: `count=${longTasks.length} over50ms=${over50.length} max=${Math.max(0, ...longTasks).toFixed(0)}ms`,
  });
  console.log(
    `G4 long tasks (4x CPU): count=${longTasks.length} over50ms=${over50.length} max=${Math.max(0, ...longTasks).toFixed(0)}ms`,
  );
  // The stack serves a production build, where React reports the update-depth
  // failure as minified error 185.
  expect(messages.filter((text) => loop.test(text))).toEqual([]);
});
