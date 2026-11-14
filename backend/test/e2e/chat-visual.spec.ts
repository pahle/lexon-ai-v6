import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  ChatPageSchema,
  ChatSearchMatchSchema,
  ChatSearchPageSchema,
  ChatSnapshotFrameSchema,
  ChatTreeSchema,
  OrganizationSummarySchema,
  SwitchResultSchema,
} from '@lexon/contracts';
import type { ChatMessage, ChatTree } from '@lexon/contracts';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

const visualDirectory = resolve('docs/references/F4-visual');
const captureDirectory = resolve(visualDirectory, 'captures');
const indexPath = resolve(visualDirectory, 'index.json');
const manifestPath = resolve(visualDirectory, 'capture-manifest.json');
const fixedNow = '2026-11-14T04:00:00.000Z';
const chatId = '00000000-0000-4000-8000-000000000101';
const userMessageId = '00000000-0000-4000-8000-000000000102';
const assistantMessageId = '00000000-0000-4000-8000-000000000103';
const runId = '00000000-0000-4000-8000-000000000104';
const fileNames = {
  newChat: 'Syarat sah perjanjian (Pasal 1320)',
  acquisition: 'Due diligence checklist for PT acquisition',
  employment: 'PKWT vs PKWTT after the Job Creation Law',
  forceMajeure: 'Force majeure clause, supply agreement',
  default: 'Wanprestasi remedies and damages',
  data: 'Data transfer under UU PDP Article 56',
} as const;
const question =
  'Apa saja syarat sahnya perjanjian menurut KUHPerdata, dan apa akibatnya jika salah satu syarat tidak terpenuhi?';
const deepThinkingQuestion =
  'Bandingkan risiko PKWT dan PKWTT untuk karyawan proyek konstruksi 18 bulan, termasuk kompensasi saat kontrak berakhir.';
const answer = `Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:

1. **Kesepakatan** para pihak yang mengikatkan dirinya.
2. **Kecakapan** untuk membuat suatu perikatan.
3. **Suatu hal tertentu** sebagai objek perjanjian.
4. **Suatu sebab yang halal**.

### Akibat jika syarat tidak terpenuhi

- Syarat 1 dan 2 adalah **syarat subjektif**. Jika tidak terpenuhi, perjanjian **dapat dibatalkan** atas permintaan pihak yang dirugikan; selama belum dibatalkan, perjanjian tetap mengikat.
- Syarat 3 dan 4 adalah **syarat objektif**. Jika tidak terpenuhi, perjanjian **batal demi hukum**, dianggap tidak pernah ada sejak semula.`;
const reasoning =
  'The question asks for the four requirements in Article 1320. Distinguish subjective requirements from objective requirements, then explain the different legal consequences.';
const timestamp = '2026-11-14T03:30:00.000Z';

type VisualCapture = {
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

function userMessage(
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

function assistantMessage(
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
        : state === 'streaming-answer' || state === 'reconnecting'
          ? 'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian: kesepakatan dan kecakapan sebagai syarat subjektif'
          : state === 'stopped'
            ? 'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian: kesepakatan para pihak dan kecakapan untuk membuat perikatan.'
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
      state === 'stopped-before-answer'
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

function chatTree(state: string): ChatTree {
  if (state === 'edited-branch') {
    const firstUser = userMessage();
    const firstAssistant = assistantMessage(
      'answer-complete',
      assistantMessageId,
    );
    const editedUser = {
      ...userMessage('00000000-0000-4000-8000-000000000105'),
      text: 'Apa saja syarat sah perjanjian menurut KUHPerdata? Jawab singkat.',
    };
    const editedAssistant = assistantMessage(
      'answer-complete',
      '00000000-0000-4000-8000-000000000106',
      editedUser.id,
    );
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

function chatList(state: string) {
  const records = [
    [chatId, fileNames.newChat, timestamp],
    ['00000000-0000-4000-8000-000000000111', fileNames.acquisition, timestamp],
    [
      '00000000-0000-4000-8000-000000000112',
      fileNames.employment,
      '2026-11-13T03:30:00.000Z',
    ],
    [
      '00000000-0000-4000-8000-000000000113',
      fileNames.forceMajeure,
      '2026-11-10T03:30:00.000Z',
    ],
    [
      '00000000-0000-4000-8000-000000000114',
      fileNames.default,
      '2026-11-10T04:30:00.000Z',
    ],
    [
      '00000000-0000-4000-8000-000000000115',
      fileNames.data,
      '2026-11-09T03:30:00.000Z',
    ],
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

function searchPage(state: string, query: string) {
  const matches =
    state === 'chats-no-results' || query === 'hak tanggungan'
      ? []
      : [
          {
            chatId,
            title: fileNames.default,
            messageId: userMessageId,
            excerpt:
              'Upaya hukum atas wanprestasi meliputi pemenuhan perikatan, ganti rugi, atau pembatalan berdasarkan Pasal 1267 KUHPerdata.',
            matchStart: 17,
            matchEnd: 28,
            updatedAt: timestamp,
          },
          {
            chatId: '00000000-0000-4000-8000-000000000113',
            title: fileNames.forceMajeure,
            messageId: null,
            excerpt:
              'Keadaan memaksa dapat memengaruhi tanggung jawab atas wanprestasi dalam perjanjian pasokan.',
            matchStart: 54,
            matchEnd: 65,
            updatedAt: '2026-11-10T03:30:00.000Z',
          },
          {
            chatId: '00000000-0000-4000-8000-000000000116',
            title: fileNames.newChat,
            messageId: null,
            excerpt:
              'Cacat syarat subjektif berbeda dari wanprestasi dalam pelaksanaan perjanjian.',
            matchStart: 36,
            matchEnd: 47,
            updatedAt: '2026-11-13T03:30:00.000Z',
          },
        ];
  return ChatSearchPageSchema.parse({
    items: matches,
    pageInfo: { nextCursor: null },
  });
}

function activeRunFrames(state: string) {
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
            text: 'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian: kesepakatan dan kecakapan sebagai syarat subjektif',
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

function validateFixtures() {
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

async function installChatFixtures(
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

async function installRunStreamFixture(page: Page) {
  const frames = {
    thinking: activeRunFrames('thinking'),
    streaming: activeRunFrames('streaming-answer'),
  };
  await page.addInitScript(
    ({
      fixtureRunId,
      frames,
    }: {
      fixtureRunId: string;
      frames: { thinking: unknown[]; streaming: unknown[] };
    }) => {
      const nativeFetch = window.fetch.bind(window);
      let reconnectAttempts = 0;
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
        if (state === 'reconnecting') {
          reconnectAttempts += 1;
          if (reconnectAttempts === 1)
            throw new TypeError('Transient chat stream interruption');
          return await new Promise<Response>((_resolve, reject) => {
            const fail = () =>
              reject(new DOMException('Aborted', 'AbortError'));
            if (signal?.aborted) fail();
            else signal?.addEventListener('abort', fail, { once: true });
          });
        }

        const streamFrames =
          state === 'streaming-answer' ? frames.streaming : frames.thinking;
        const encoder = new TextEncoder();
        const frameSeparator = '\n\n';
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const frame of streamFrames)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(frame)}${frameSeparator}`,
                ),
              );
            if (signal?.aborted) controller.close();
            else
              signal?.addEventListener('abort', () => controller.close(), {
                once: true,
              });
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

async function openState(page: Page, baseUrl: string, state: string) {
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
        await page
          .getByRole('button', { name: new RegExp(fileNames.default) })
          .click();
        await expect(page).toHaveURL(`${baseUrl}/chats/${chatId}`);
        await expect(
          page.locator(`[data-message-id="${userMessageId}"]`),
        ).toHaveAttribute('data-search-highlight', 'true');
      } else if (state === 'chats-search') {
        await expect(page.getByText('3 chats', { exact: true })).toBeVisible();
      } else {
        await expect(
          page.getByRole('heading', { name: /No chats match/ }),
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
      await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
      await expect(page.getByText(/Pasal 1320 KUHPerdata/)).toHaveCount(0);
    }
    if (state === 'stopped')
      await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
    if (state === 'run-error')
      await expect(page.getByRole('alert')).toContainText(
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
  await page.goto(`${baseUrl}/workspace`);
  await expect(page.getByText('Welcome, Ayu Wardani')).toBeVisible();
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
      'Deep thinking: takes longer and uses more of your budget.',
    );
  }
  if (state === 'organization-switcher-open' || state === 'user-menu-open') {
    if (await page.getByRole('button', { name: 'Open navigation' }).count())
      await page.getByRole('button', { name: 'Open navigation' }).click();
    if (state === 'organization-switcher-open')
      await page.getByRole('button', { name: /^Organization:/ }).click();
    else await page.getByRole('button', { name: /Ayu Wardani/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
  }
  if (state === 'sidebar-expanded' && viewportWidth(page) === 390)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  if (state === 'sidebar-collapsed' && viewportWidth(page) === 1440)
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
}

function viewportWidth(page: Page) {
  return page.viewportSize()?.width ?? 1440;
}

test('captures the indexed F4 chat visual review set', async ({ page }) => {
  test.setTimeout(240_000);
  validateFixtures();
  const stack = descriptor();
  await page.clock.setFixedTime(new Date(fixedNow));
  const headers = await authenticateApi(page.request, {
    name: 'Ayu Wardani',
    email: 'ayu.wardani@hukum-nusantara.co.id',
  });
  const createdTeam = await page.request.post(
    `${stack.apiUrl}/api/organizations`,
    {
      headers,
      data: { name: 'Hukum Nusantara', slug: 'hukum-nusantara' },
    },
  );
  expect(createdTeam.status()).toBe(201);
  const team = OrganizationSummarySchema.parse(await createdTeam.json());
  expect(team).toMatchObject({
    name: 'Hukum Nusantara',
    kind: 'team',
    role: 'owner',
  });
  const activeTeam = await page.request.post(
    `${stack.apiUrl}/api/organizations/active`,
    { headers, data: { organizationId: team.id } },
  );
  expect(activeTeam.status()).toBe(200);
  expect(SwitchResultSchema.parse(await activeTeam.json())).toMatchObject({
    status: 'switched',
    organization: { id: team.id, name: 'Hukum Nusantara', role: 'owner' },
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);

  let state = '';
  let releasePendingTree: (() => void) | undefined;
  await installChatFixtures(
    page,
    () => state,
    (release) => {
      releasePendingTree = release;
    },
  );
  await installRunStreamFixture(page);
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
    status?: string;
    captures: VisualCapture[];
    navigationCoverage: Array<{ captureId: string }>;
  };
  expect(index.captures).toHaveLength(66);
  expect(index.navigationCoverage).toHaveLength(20);

  for (const capture of index.captures) {
    if (releasePendingTree) {
      releasePendingTree();
      releasePendingTree = undefined;
    }
    state = capture.state;
    const viewport =
      capture.viewport === 'mobile'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      colorScheme: capture.theme,
      reducedMotion: 'reduce',
    });
    await openState(page, stack.publicUrl, capture.state);
    await expect(page.locator('#main')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const target = resolve(visualDirectory, capture.filename);
    await mkdir(captureDirectory, { recursive: true });
    await page.screenshot({
      path: target,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  }
  if (releasePendingTree) releasePendingTree();

  const producerCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const files = [];
  for (const capture of index.captures) {
    const path = resolve(visualDirectory, capture.filename);
    const image = await readFile(path);
    const updated = {
      ...capture,
      producerCommit,
      sha256: createHash('sha256').update(image).digest('hex'),
    };
    Object.assign(capture, updated);
    files.push({
      id: capture.id,
      filename: capture.filename,
      state: capture.state,
      theme: capture.theme,
      viewport: capture.viewport,
      width: image.readUInt32BE(16),
      height: image.readUInt32BE(20),
      sha256: updated.sha256,
    });
  }
  index.status = 'captured';
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  Object.assign(manifest, {
    status: 'captured-not-reviewed',
    producerCommit,
    capturedAt: new Date().toISOString(),
    fixtureClock: fixedNow,
    files,
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
});
