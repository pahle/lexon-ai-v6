// Deterministic chat fixtures and state openers shared by the chat state
// specs and the visual capture sets. Moved unchanged from chat-visual.spec.ts.
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  ChatPageSchema,
  ChatSearchMatchSchema,
  ChatSearchPageSchema,
  ChatSnapshotFrameSchema,
  ChatTreeSchema,
} from '@lexon/contracts';
import type { ChatMessage, ChatTree } from '@lexon/contracts';
import { freezeMorningClock } from './greeting-clock.js';
import {
  answer as prototypeAnswer,
  chatTimes,
  chatTitles,
  prototypeNow,
  question as prototypeQuestion,
  reasoningSummary,
  searchResults,
} from './prototype-fixtures.js';

export const visualDirectory = resolve('docs/references/F4-visual');
export const captureDirectory = resolve(visualDirectory, 'captures');
export const indexPath = resolve(visualDirectory, 'index.json');
export const manifestPath = resolve(visualDirectory, 'capture-manifest.json');
export const fixedNow = prototypeNow;
export const chatId = '00000000-0000-4000-8000-000000000101';
export const userMessageId = '00000000-0000-4000-8000-000000000102';
export const assistantMessageId = '00000000-0000-4000-8000-000000000103';
export const runId = '00000000-0000-4000-8000-000000000104';
// Titles, question, answer and times are the prototype's (prototype-fixtures.ts).
export const fileNames = chatTitles;
export const question = prototypeQuestion;
export const deepThinkingQuestion =
  'Bandingkan risiko PKWT dan PKWTT untuk karyawan proyek konstruksi 18 bulan, termasuk kompensasi saat kontrak berakhir.';
export const answer = prototypeAnswer;
export const reasoning = reasoningSummary;
export const timestamp = chatTimes.newChat.at;
// The partial answer of the streaming, reconnecting and stopped states, as in
// the prototype (two list items, the second cut off).
// The reconnecting state shows only the first paragraph, as in the prototype.
export const reconnectingAnswer =
  'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:';
export const partialAnswer = `Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:

1. **Kesepakatan** para pihak yang mengikatkan dirinya.
2. **Kecakapan** untuk membuat suatu`;

export type VisualCapture = {
  status?: string;
  id: string;
  state: string;
  theme: 'light' | 'dark';
  viewport: 'desktop' | 'mobile';
  width: number;
  height: number;
  filename: string;
  producerCommit: string | null;
  sha256: string | null;
};

export function userMessage(
  id = userMessageId,
): Extract<ChatMessage, { role: 'user' }> {
  return {
    id,
    role: 'user',
    parentId: null,
    text: question,
    effort: 'high',
    createdAt: timestamp,
  };
}

export function assistantMessage(
  state: string,
  id = assistantMessageId,
  parentId = userMessageId,
): Extract<ChatMessage, { role: 'assistant' }> {
  const active =
    state === 'thinking' ||
    state === 'streaming-answer' ||
    state === 'reconnecting';
  const stoppedBeforeAnswer = state === 'stopped-before-answer';
  return {
    id,
    role: 'assistant',
    parentId,
    runId,
    text:
      state === 'thinking' || stoppedBeforeAnswer
        ? ''
        : state === 'reconnecting'
          ? reconnectingAnswer
          : state === 'streaming-answer'
            ? partialAnswer
            : state === 'stopped'
              ? partialAnswer
              : state === 'run-error'
                ? 'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:'
                : answer,
    createdAt: timestamp,
    status: active
      ? 'running'
      : stoppedBeforeAnswer || state === 'stopped'
        ? 'cancelled'
        : state === 'run-error'
          ? 'failed'
          : 'completed',
    reasoningSummary:
      state === 'no-signal-completion' ||
      state === 'measured-no-summary-completion' ||
      state === 'stopped-before-answer' ||
      // The prototype's failed answer shows the mark only, no label.
      state === 'run-error'
        ? null
        : reasoning,
    reasoningDurationMs:
      state === 'no-signal-completion' || state === 'stopped-before-answer'
        ? null
        : state === 'measured-no-summary-completion'
          ? 14_000
          : state === 'streaming-answer' || state === 'reconnecting'
            ? 8_000
            : state === 'stopped'
              ? 9_000
              : 14_000,
    feedback: null,
  };
}

export function chatTree(state: string): ChatTree {
  if (state === 'matching-message-highlight') {
    const matchedUser = {
      ...userMessage(),
      text: 'What remedies are available to a party when the other party commits wanprestasi under a supply agreement?',
    };
    const matchedAssistant = {
      ...assistantMessage('answer-complete'),
      text: 'Under Article 1267 of the Indonesian Civil Code, the injured party may seek performance, damages, or cancellation of the agreement, depending on the circumstances.',
    };
    return ChatTreeSchema.parse({
      id: chatId,
      title: fileNames.default,
      messages: [matchedUser, matchedAssistant],
      viewedLeafId: matchedAssistant.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  if (state === 'edited-branch') {
    const firstUser = userMessage();
    const firstAssistant = assistantMessage(
      'answer-complete',
      assistantMessageId,
    );
    const editedUser = {
      ...userMessage('00000000-0000-4000-8000-000000000105'),
      text: 'Apa saja syarat sahnya perjanjian menurut KUHPerdata? Jawab singkat.',
    };
    const editedAssistant = {
      ...assistantMessage(
        'answer-complete',
        '00000000-0000-4000-8000-000000000106',
        editedUser.id,
      ),
      text: 'Ada dua syarat subjektif (kesepakatan dan kecakapan) dan dua syarat objektif (hal tertentu dan sebab yang halal) dalam Pasal 1320 KUHPerdata.\n\nPelanggaran syarat subjektif membuat perjanjian dapat dibatalkan; pelanggaran syarat objektif membuatnya batal demi hukum.',
      reasoningDurationMs: 6_000,
    };
    return ChatTreeSchema.parse({
      id: chatId,
      title: fileNames.newChat,
      messages: [firstUser, firstAssistant, editedUser, editedAssistant],
      viewedLeafId: editedAssistant.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return ChatTreeSchema.parse({
    id: chatId,
    title: fileNames.newChat,
    messages: [userMessage(), assistantMessage(state)],
    viewedLeafId: assistantMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function chatList(state: string) {
  const records = [
    [chatId, fileNames.newChat, chatTimes.newChat.at],
    [
      '00000000-0000-4000-8000-000000000111',
      fileNames.acquisition,
      chatTimes.acquisition.at,
    ],
    [
      '00000000-0000-4000-8000-000000000112',
      fileNames.employment,
      chatTimes.employment.at,
    ],
    [
      '00000000-0000-4000-8000-000000000113',
      fileNames.forceMajeure,
      chatTimes.forceMajeure.at,
    ],
    [
      '00000000-0000-4000-8000-000000000114',
      fileNames.default,
      chatTimes.default.at,
    ],
    ['00000000-0000-4000-8000-000000000115', fileNames.data, chatTimes.data.at],
  ];
  return ChatPageSchema.parse({
    items:
      state === 'chats-empty'
        ? []
        : records.map(([id, title, updatedAt]) => ({
            id,
            title,
            updatedAt,
            lastMessageAt: updatedAt,
          })),
    pageInfo: { nextCursor: null },
  });
}

export function searchExcerpt(excerpt: string) {
  const matchStart = excerpt.indexOf('wanprestasi');
  return {
    excerpt,
    matchStart,
    matchEnd: matchStart + 'wanprestasi'.length,
  };
}

export function searchPage(state: string, query: string) {
  const [wanprestasi, forceMajeure, newChat] = searchResults;
  const matches =
    state === 'chats-no-results' || query === 'hak tanggungan'
      ? []
      : [
          {
            chatId,
            title: wanprestasi.title,
            messageId: userMessageId,
            ...searchExcerpt(wanprestasi.excerpt),
            updatedAt: chatTimes.default.at,
          },
          {
            chatId: '00000000-0000-4000-8000-000000000113',
            title: forceMajeure.title,
            messageId: null,
            ...searchExcerpt(forceMajeure.excerpt),
            // The prototype's search list prints Nov 5 for this chat.
            updatedAt: '2026-11-05T03:42:00.000Z',
          },
          {
            chatId: '00000000-0000-4000-8000-000000000116',
            title: newChat.title,
            messageId: null,
            ...searchExcerpt(newChat.excerpt),
            updatedAt: chatTimes.newChat.at,
          },
        ];
  return ChatSearchPageSchema.parse({
    items: matches,
    pageInfo: { nextCursor: null },
  });
}

export function activeRunFrames(state: string) {
  const parts =
    state === 'thinking'
      ? []
      : [
          {
            type: 'snapshot-part',
            version: 1,
            partIndex: 0,
            chunkIndex: 0,
            partType: 'reasoning',
            id: 'chat-visual-reasoning',
            text: reasoning,
            final: true,
          },
          {
            type: 'snapshot-part',
            version: 1,
            partIndex: 1,
            chunkIndex: 0,
            partType: 'text',
            id: 'chat-visual-answer',
            text: state === 'reconnecting' ? reconnectingAnswer : partialAnswer,
            final: true,
          },
        ];
  const frames = [
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantMessageId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        status: 'running',
        errorCode: null,
        reasoningDurationMs: state === 'thinking' ? null : 8_000,
      },
      partCount: parts.length,
      operationCount: 0,
    },
    ...parts,
    {
      type: 'snapshot-end',
      version: 1,
      partCount: parts.length,
      operationCount: 0,
    },
  ].map((frame) => ChatSnapshotFrameSchema.parse(frame));
  return frames;
}

export function validateFixtures() {
  for (const state of [
    'thinking',
    'streaming-answer',
    'reasoning-open',
    'answer-complete',
    'copied-and-feedback',
    'edited-branch',
    'stopped',
    'run-error',
    'reconnecting',
    'no-signal-completion',
    'measured-no-summary-completion',
    'stopped-before-answer',
  ])
    chatTree(state);
  for (const state of ['new-chat', 'chats-history', 'chat-actions-menu'])
    chatList(state);
  chatList('chats-empty');
  searchPage('chats-search', 'wanprestasi');
  searchPage('chats-no-results', 'hak tanggungan');
  ChatSearchMatchSchema.parse({
    leafId: assistantMessageId,
    messageId: userMessageId,
  });
  activeRunFrames('thinking');
  activeRunFrames('streaming-answer');
}

export async function installChatFixtures(
  page: Page,
  getState: () => string,
  setPendingTreeRelease: (release: (() => void) | undefined) => void,
) {
  await page.route(/\/api\/chats(?:\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const state = getState();
    if (url.pathname === '/api/chats/events') return route.abort('failed');
    if (request.method() === 'GET' && url.pathname === '/api/chats')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatList(state)),
      });
    if (request.method() === 'POST' && url.pathname === '/api/chats/search') {
      const input = request.postDataJSON() as { query?: string };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(searchPage(state, input.query ?? '')),
      });
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith(`/search-match/${userMessageId}`)
    )
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          ChatSearchMatchSchema.parse({
            leafId: assistantMessageId,
            messageId: userMessageId,
          }),
        ),
      });
    if (request.method() === 'GET' && url.pathname === `/api/chats/${chatId}`) {
      if (state === 'thread-loading') {
        await new Promise<void>((release) => setPendingTreeRelease(release));
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatTree(state)),
      });
    }
    if (request.method() === 'PUT' && url.pathname.endsWith('/feedback'))
      return route.fulfill({ status: 204 });
    return route.continue();
  });
}

export async function installRunStreamFixture(page: Page) {
  const frames = {
    thinking: activeRunFrames('thinking'),
    streaming: activeRunFrames('streaming-answer'),
    reconnecting: activeRunFrames('reconnecting'),
  };
  await page.addInitScript(
    ({
      fixtureRunId,
      frames,
    }: {
      fixtureRunId: string;
      frames: {
        thinking: unknown[];
        streaming: unknown[];
        reconnecting: unknown[];
      };
    }) => {
      const nativeFetch = window.fetch.bind(window);
      let reconnectAttempts = 0;
      let disconnectFirstStream: (() => void) | undefined;
      const fixtureWindow = window as Window & {
        __chatVisualDisconnectRun?: () => boolean;
      };
      fixtureWindow.__chatVisualDisconnectRun = () => {
        if (!disconnectFirstStream) return false;
        const disconnect = disconnectFirstStream;
        disconnectFirstStream = undefined;
        disconnect();
        return true;
      };
      window.fetch = async (input, init) => {
        const requestUrl =
          typeof input === 'string' || input instanceof URL
            ? String(input)
            : input.url;
        const url = new URL(requestUrl, window.location.href);
        if (url.pathname !== `/api/runs/${fixtureRunId}/events`)
          return nativeFetch(input, init);

        const signal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const state = new URL(window.location.href).searchParams.get(
          'capture_state',
        );
        if (state === 'reconnecting' && reconnectAttempts > 0) {
          return await new Promise<Response>((_resolve, reject) => {
            const fail = () =>
              reject(new DOMException('Aborted', 'AbortError'));
            if (signal?.aborted) fail();
            else signal?.addEventListener('abort', fail, { once: true });
          });
        }

        const disconnectAfterPartialAnswer = state === 'reconnecting';
        if (disconnectAfterPartialAnswer) reconnectAttempts += 1;
        const streamFrames = disconnectAfterPartialAnswer
          ? frames.reconnecting
          : state === 'streaming-answer'
            ? frames.streaming
            : frames.thinking;
        const encoder = new TextEncoder();
        const frameSeparator = '\n\n';
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let settled = false;
            const close = () => {
              if (settled) return;
              settled = true;
              controller.close();
            };
            for (const frame of streamFrames)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(frame)}${frameSeparator}`,
                ),
              );
            if (disconnectAfterPartialAnswer)
              disconnectFirstStream = () => {
                if (settled) return;
                settled = true;
                controller.error(
                  new TypeError('Transient chat stream interruption'),
                );
              };
            if (signal?.aborted) close();
            else signal?.addEventListener('abort', close, { once: true });
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
    { fixtureRunId: runId, frames },
  );
}

export async function openMobileSidebar(page: Page) {
  const sidebar = page.getByRole('dialog', { name: 'Sidebar' });
  if (!(await sidebar.isVisible()))
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(sidebar).toBeVisible();
  await expect(
    sidebar.getByRole('heading', { name: 'Sidebar' }),
  ).toBeAttached();
  const navigation = sidebar.getByRole('navigation', {
    name: 'Primary navigation',
  });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole('link', { name: 'New chat' }),
  ).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Chats' })).toBeVisible();
  return sidebar;
}

export async function expectRecentChatReady(sidebar: Locator) {
  const recent = sidebar.getByRole('group', { name: 'Recent chats' });
  for (const title of [
    fileNames.newChat,
    fileNames.acquisition,
    fileNames.employment,
    fileNames.forceMajeure,
    fileNames.default,
    fileNames.data,
  ])
    await expect(
      recent.getByRole('link', { name: title, exact: true }),
    ).toBeVisible();
  await expect(
    recent.getByRole('link', { name: 'View all chats', exact: true }),
  ).toBeVisible();
}

export async function expectSolidDestructiveButton(button: Locator) {
  const styles = await button.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--lexon-destructive-fill)';
    probe.style.color = '#ffffff';
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const actual = getComputedStyle(element);
    const result = {
      actualBackground: actual.backgroundColor,
      expectedBackground: expected.backgroundColor,
      actualForeground: actual.color,
      expectedForeground: expected.color,
    };
    probe.remove();
    return result;
  });
  expect(styles.actualBackground).toBe(styles.expectedBackground);
  expect(styles.actualForeground).toBe(styles.expectedForeground);
}

export async function openState(page: Page, baseUrl: string, state: string) {
  if (
    state === 'chat-actions-menu' ||
    state === 'rename-inline' ||
    state === 'delete-confirm'
  ) {
    await page.goto(`${baseUrl}/chats/${chatId}`);
    await expect(page.getByText(answer.slice(0, 50))).toBeVisible();
    await page
      .getByRole('button', {
        name: `Chat actions for ${fileNames.acquisition}`,
      })
      .click();
    await expect(page.getByRole('menu')).toBeVisible();
    if (state === 'rename-inline') {
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await expect(
        page.getByRole('textbox', { name: 'Chat title' }),
      ).toBeVisible();
    }
    if (state === 'delete-confirm') {
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      const deleteButton = page.getByRole('button', {
        name: 'Delete chat',
        exact: true,
      });
      await expect(deleteButton).toBeVisible();
      await expectSolidDestructiveButton(deleteButton);
      await deleteButton.hover();
      await deleteButton.evaluate(async (button) => {
        await Promise.all(
          button
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      await expectSolidDestructiveButton(deleteButton);
      await page.mouse.move(0, 0);
    }
    return;
  }
  if (
    state === 'chats-history' ||
    state === 'chats-search' ||
    state === 'chats-no-results' ||
    state === 'chats-empty' ||
    state === 'matching-message-highlight'
  ) {
    await page.goto(`${baseUrl}/chats`);
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    if (
      state === 'chats-search' ||
      state === 'chats-no-results' ||
      state === 'matching-message-highlight'
    ) {
      const query =
        state === 'chats-no-results' ? 'hak tanggungan' : 'wanprestasi';
      const search = page.getByRole('textbox', { name: 'Search chats' });
      await search.fill(query);
      await search.press('Enter');
      if (state === 'matching-message-highlight') {
        const main = page.locator('#main');
        await expect(main.getByText('3 chats', { exact: true })).toBeVisible();
        const escapedTitle = fileNames.default.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        await main
          .getByRole('button', {
            name: new RegExp(`^${escapedTitle}(?:\\s|$)`),
          })
          .click();
        await expect(page).toHaveURL(`${baseUrl}/chats/${chatId}`);
        await expect(
          page.locator(`[data-message-id="${userMessageId}"]`),
        ).toHaveAttribute('data-search-highlight', 'true');
      } else if (state === 'chats-search') {
        await expect(page.getByText('3 chats', { exact: true })).toBeVisible();
      } else {
        await expect(
          page.getByText('No chats match “hak tanggungan”', { exact: true }),
        ).toBeVisible();
      }
    }
    return;
  }
  if (
    state === 'thread-loading' ||
    state === 'thinking' ||
    state === 'streaming-answer' ||
    state === 'reasoning-open' ||
    state === 'answer-complete' ||
    state === 'copied-and-feedback' ||
    state === 'edit-user-message' ||
    state === 'edited-branch' ||
    state === 'stopped' ||
    state === 'run-error' ||
    state === 'reconnecting' ||
    state === 'no-signal-completion' ||
    state === 'measured-no-summary-completion' ||
    state === 'stopped-before-answer'
  ) {
    const captureState =
      state === 'thinking' ||
      state === 'streaming-answer' ||
      state === 'reconnecting'
        ? `?capture_state=${state}`
        : '';
    await page.goto(`${baseUrl}/chats/${chatId}${captureState}`);
    if (state === 'thread-loading') {
      await expect(page.locator('#main [role="status"]')).toBeVisible();
      return;
    }
    if (state === 'thinking')
      await expect(page.getByText('Thinking…', { exact: true })).toBeVisible();
    if (state === 'thinking' || state === 'streaming-answer') {
      await expect(
        page.getByRole('button', { name: 'Stop generating' }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Message input' }),
      ).toHaveAttribute('placeholder', 'Lexon is answering…');
    }
    if (state === 'streaming-answer') {
      await expect(page.getByText('Thought for 8 seconds')).toBeVisible();
      await expect(
        page.getByText(/Pasal 1320 KUHPerdata menetapkan/).first(),
      ).toBeVisible();
    }
    if (state === 'reconnecting') {
      await expect(
        page.getByRole('button', { name: 'Stop generating' }),
      ).toBeVisible();
      await expect(
        page.getByText(/Pasal 1320 KUHPerdata menetapkan/).first(),
      ).toBeVisible();
      await expect(page.getByText('Reconnecting…')).toHaveCount(0);
      const disconnected = await page.evaluate(() => {
        const fixtureWindow = window as Window & {
          __chatVisualDisconnectRun?: () => boolean;
        };
        return fixtureWindow.__chatVisualDisconnectRun?.() ?? false;
      });
      expect(disconnected).toBe(true);
      await expect(page.getByText('Reconnecting…')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Stop generating' }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Message input' }),
      ).toHaveAttribute('placeholder', 'Lexon is answering…');
    }
    if (state === 'reasoning-open')
      await page.locator(`[data-message-id="${assistantMessageId}"]`).hover();
    if (state === 'reasoning-open')
      await page
        .getByRole('button', { name: /Thought for 14 seconds/ })
        .click();
    if (
      state === 'answer-complete' ||
      state === 'copied-and-feedback' ||
      state === 'stopped' ||
      state === 'no-signal-completion' ||
      state === 'measured-no-summary-completion'
    )
      await page.locator(`[data-message-id="${assistantMessageId}"]`).hover();
    if (state === 'copied-and-feedback') {
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'], {
          origin: baseUrl,
        });
      await page.getByRole('button', { name: 'Copy answer' }).click();
      await page.getByRole('button', { name: 'Good answer' }).click();
      await expect(page.getByText('Thanks for your feedback.')).toBeVisible();
    }
    if (state === 'edit-user-message') {
      const message = page.locator(`[data-message-id="${userMessageId}"]`);
      await message.hover();
      await message.getByRole('button', { name: 'Edit message' }).click();
      await expect(
        page.getByRole('textbox', { name: 'Edit message input' }),
      ).toBeVisible();
    }
    if (state === 'edited-branch')
      await page
        .locator('[data-message-id="00000000-0000-4000-8000-000000000105"]')
        .hover();
    if (state === 'edited-branch')
      await expect(
        page.getByText('2 / 2', { exact: true }).first(),
      ).toBeVisible();
    if (state === 'stopped-before-answer') {
      await expect(
        page.getByText('You stopped this response.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Pasal 1320 KUHPerdata/)).toHaveCount(0);
    }
    if (state === 'stopped')
      await expect(
        page.getByText('You stopped this response.', { exact: true }),
      ).toBeVisible();
    if (state === 'run-error')
      await expect(page.locator('#main').getByRole('alert')).toContainText(
        'The response could not be completed.',
      );
    if (state === 'no-signal-completion') {
      await expect(page.getByText(answer.slice(0, 50))).toBeVisible();
      await expect(page.getByText(/Thought for/)).toHaveCount(0);
    }
    if (state === 'measured-no-summary-completion') {
      await expect(page.getByText('Thought for 14 seconds')).toBeVisible();
      await expect(page.getByText(reasoning)).toHaveCount(0);
    }
    return;
  }
  await freezeMorningClock(page);
  await page.goto(`${baseUrl}/workspace`);
  await expect(
    page.getByText('Good morning, Ayu', { exact: true }),
  ).toBeVisible();
  if (state === 'deep-thinking-on') {
    await page
      .getByRole('textbox', { name: 'Message input' })
      .fill(deepThinkingQuestion);
    const toggle = page.getByRole('button', { name: 'Deep thinking' });
    await toggle.hover();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);
    await toggle.hover();
    const tooltip = page.locator('[data-slot="tooltip-content"][data-open]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(
      'Takes longer and uses more of your budget',
    );
  }
  if (state === 'organization-switcher-open' || state === 'user-menu-open') {
    if (viewportWidth(page) === 390) {
      const sidebar = await openMobileSidebar(page);
      await expectRecentChatReady(sidebar);
    } else {
      const sidebar = page.getByRole('complementary', {
        name: 'Workspace navigation',
      });
      await expect(sidebar).toBeVisible();
      const collapsed = await page
        .getByRole('button', { name: 'Expand sidebar' })
        .isVisible();
      if (!collapsed) await expectRecentChatReady(sidebar);
    }
    if (state === 'organization-switcher-open')
      await page.getByRole('button', { name: /^Organization:/ }).click();
    else await page.getByRole('button', { name: /Ayu Wardani/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    if (state === 'organization-switcher-open') {
      await expect(
        page.getByRole('menuitem', { name: 'Personal', exact: true }),
      ).toBeVisible();
      const activeOrganization = page.getByRole('menuitem', {
        name: 'Hukum Nusantara',
        exact: true,
      });
      await expect(activeOrganization).toBeVisible();
      await expect(activeOrganization).toHaveAttribute('aria-current', 'true');
    }
  }
  if (state === 'sidebar-expanded' && viewportWidth(page) === 390) {
    const sidebar = await openMobileSidebar(page);
    await expectRecentChatReady(sidebar);
  }
  if (state === 'sidebar-collapsed' && viewportWidth(page) === 1440) {
    const collapseSidebar = page.getByRole('button', {
      name: 'Collapse sidebar',
    });
    if (await collapseSidebar.isVisible()) await collapseSidebar.click();
    await expect(
      page.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeVisible();
  }
}

export function viewportWidth(page: Page) {
  return page.viewportSize()?.width ?? 1440;
}
