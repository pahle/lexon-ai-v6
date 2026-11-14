import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';

async function workerControl(
  op:
    | 'status'
    | 'release-prefix'
    | 'release-answer'
    | 'release-second-answer'
    | 'release',
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
    answerBlocked?: boolean;
    secondAnswerBlocked?: boolean;
    released?: boolean;
  } | null;
}

async function latestRunId(
  page: Page,
  apiUrl: string,
  chatId: string,
  headers: Record<string, string>,
  previousRunIds: ReadonlySet<string> = new Set(),
) {
  let runId: string | undefined;
  await expect
    .poll(async () => {
      const response = await page.request.get(`${apiUrl}/api/chats/${chatId}`, {
        headers,
      });
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
      const latest = latestAssistant?.runId;
      runId =
        latest &&
        latestUser &&
        latestAssistant?.parentId === latestUser.id &&
        !previousRunIds.has(latest)
          ? latest
          : undefined;
      return runId;
    })
    .toBeTruthy();
  return runId!;
}

test('new chat accepts a prompt, navigates to a stable thread, and renders the scripted answer', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task 14 Preview',
    email: `task-14-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    {
      headers,
      data: {},
    },
  );
  expect(onboarded.status()).toBe(204);

  const remoteImageRequests: string[] = [];
  await page.route('https://remote.invalid/**', async (route) => {
    remoteImageRequests.push(route.request().url());
    await route.abort();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${stack.publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await expect(composer).toBeVisible();
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await expect(sendButton).toBeDisabled();
  await expect(composer).toHaveCSS('resize', 'none');
  await mkdir('test-results/f4-chat', { recursive: true });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-newchat-desktop-light.png',
    fullPage: true,
  });
  const initialHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await composer.fill(
    'First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\nSeventh line\nEighth line',
  );
  await expect
    .poll(() =>
      composer.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(initialHeight);
  await composer.fill('   ');
  await expect(sendButton).toBeDisabled();
  await composer.press('Enter');
  await expect(page).toHaveURL(`${stack.publicUrl}/workspace`);
  await composer.fill('');
  await new AxeBuilder({ page })
    .include('main')
    .analyze()
    .then((result) => {
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    });
  await page.emulateMedia({ colorScheme: 'dark' });
  await new AxeBuilder({ page })
    .include('main')
    .analyze()
    .then((result) => {
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-newchat-desktop-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('button', { name: 'Deep thinking' })).toHaveCSS(
    'white-space',
    'nowrap',
  );
  await expect(page.getByText(/bytes left/)).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-newchat-mobile-light.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-newchat-mobile-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const deepThinking = page.getByRole('button', { name: 'Deep thinking' });
  await deepThinking.click();
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
  await composer.fill(
    '[task14:preview] [runtime-proof:hold] Review this clause',
  );
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  const chatId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(
    page
      .getByRole('group', { name: 'Recent chats' })
      .locator(`a[href="/chats/${chatId}"]`),
  ).toBeVisible();
  const runId = await latestRunId(page, stack.apiUrl, chatId, headers);
  await expect
    .poll(() => workerControl('status', runId))
    .toMatchObject({ prefixBlocked: true });
  await expect(composer).toHaveAttribute('placeholder', 'Lexon is answering…');
  await expect(page.getByText('Thinking…')).toBeVisible();
  await expect(page.getByText('Thought for 2 seconds')).toHaveCount(0);
  const spinner = page.locator('.lucide-loader-circle').first();
  await expect(spinner).toBeVisible();
  await expect
    .poll(() =>
      spinner.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe('none');
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-streaming-desktop-light.png',
    fullPage: true,
  });
  await workerControl('release-prefix', runId);
  await expect
    .poll(() => workerControl('status', runId))
    .toMatchObject({ answerBlocked: true, blocked: false });
  const thought = page.getByRole('button', { name: 'Thought for 2 seconds' });
  await expect(thought).toBeVisible();
  const announcementRegion = page.locator(
    '[data-role="assistant"] p.sr-only[aria-live="polite"][aria-atomic="false"]',
  );
  await expect(announcementRegion).toHaveCount(1);
  await expect(announcementRegion).not.toBeEmpty();
  const firstAnnouncement = (await announcementRegion.textContent())?.trim();
  expect(firstAnnouncement?.length).toBeGreaterThan(0);
  expect(firstAnnouncement?.length).toBeLessThanOrEqual(160);
  await workerControl('release-answer', runId);
  await expect
    .poll(() => workerControl('status', runId))
    .toMatchObject({ secondAnswerBlocked: true, answerBlocked: false });
  await expect
    .poll(async () => (await announcementRegion.textContent())?.trim())
    .not.toBe(firstAnnouncement);
  const secondAnnouncement = (await announcementRegion.textContent())?.trim();
  expect(secondAnnouncement?.length).toBeGreaterThan(0);
  expect(secondAnnouncement?.length).toBeLessThanOrEqual(160);
  expect(secondAnnouncement).not.toBe(firstAnnouncement);
  await workerControl('release-second-answer', runId);
  await expect(page.locator('[data-role="assistant"] .aui-md')).toContainText(
    'See the contract text',
  );
  await expect(composer).toHaveAttribute(
    'placeholder',
    'Ask Lexon about a contract, a regulation, or a case...',
  );
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Stop generating' }),
  ).toHaveCount(0);
  const threadSend = page.getByRole('button', { name: 'Send message' });
  const messageCountBeforeWhitespace = await page.request
    .get(`${stack.apiUrl}/api/chats/${chatId}`, { headers })
    .then(async (response) => {
      const tree = (await response.json()) as { messages: unknown[] };
      return tree.messages.length;
    });
  await composer.fill('   ');
  await expect(threadSend).toBeDisabled();
  await composer.press('Enter');
  const messageCountAfterWhitespace = await page.request
    .get(`${stack.apiUrl}/api/chats/${chatId}`, { headers })
    .then(async (response) => {
      const tree = (await response.json()) as { messages: unknown[] };
      return tree.messages.length;
    });
  expect(messageCountAfterWhitespace).toBe(messageCountBeforeWhitespace);
  await thought.click();
  await expect(
    page.getByText(
      'The clause shifts open-ended responsibility to the supplier.',
    ),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-role="assistant"] [data-slot="collapsible-content"] img',
    ),
  ).toHaveCount(0);
  await expect(page.locator('[data-role="assistant"] img')).toHaveCount(0);
  await expect(page.locator('.aui-md a[href^="javascript:"]')).toHaveCount(0);
  expect(remoteImageRequests).toEqual([]);
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-reasoning-expanded-desktop-light.png',
    fullPage: true,
  });
  await thought.click();
  await expect(
    page.getByText(
      'The clause shifts open-ended responsibility to the supplier.',
    ),
  ).toBeHidden();
  await expect(
    page
      .locator('[data-role="assistant"] .aui-md')
      .getByText('uncapped direct liability'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Deep thinking' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page
      .locator('.aui-composer-root')
      .getByText(
        'Lexon can make mistakes. Verify important legal information.',
        {
          exact: true,
        },
      ),
  ).toHaveCount(1);

  await new AxeBuilder({ page })
    .include('main')
    .analyze()
    .then((result) => {
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    });
  await page.locator('[data-role="assistant"]').hover();
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-answer-desktop-light.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await new AxeBuilder({ page })
    .include('main')
    .analyze()
    .then((result) => {
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-answer-desktop-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-answer-mobile-light.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-answer-mobile-dark.png',
    fullPage: true,
  });
});

test('edits a user turn, regenerates an assistant sibling, and restores branch selection after reload', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task 14 Branch Preview',
    email: `task-14-branch-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${stack.publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await composer.fill('[runtime-proof:edit] review this clause');
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  await expect(
    page.locator('[data-role="assistant"] .aui-md').getByText('Edited answer.'),
  ).toBeVisible({ timeout: 20_000 });
  const originalUserId = await page
    .locator('[data-role="user"]')
    .getAttribute('data-message-id');
  const userMessage = page.locator('[data-role="user"]');
  const editButton = userMessage.getByRole('button', { name: 'Edit message' });
  await editButton.press('Enter');
  const edit = page.getByRole('textbox', { name: 'Edit message input' });
  await expect(edit).toBeFocused();
  await expect(edit).toHaveValue('[runtime-proof:edit] review this clause');
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await expect(editButton).toBeFocused();
  await editButton.click();
  await expect(edit).toBeFocused();
  await edit.fill('🧾'.repeat(4_097));
  await page.getByRole('button', { name: 'Send edit' }).click();
  await expect(edit).toBeVisible();
  await expect(
    page.locator('form').filter({ has: edit }).getByRole('alert'),
  ).toContainText('16,384 bytes');
  await expect(edit).toHaveValue('🧾'.repeat(4_097));
  await edit.fill('[runtime-proof:edit] revise this clause');
  await page.getByRole('button', { name: 'Send edit' }).click();
  await expect(
    page
      .locator('[data-role="user"]')
      .filter({ hasText: 'revise this clause' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('[data-role="user"]')
        .filter({ hasText: 'revise this clause' })
        .getAttribute('data-message-id'),
    )
    .not.toBe(originalUserId);
  await expect(
    page.locator('[data-role="assistant"] .aui-md').getByText('Edited answer.'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.aui-composer-root')).toContainText(
    'Lexon can make mistakes. Verify important legal information.',
  );
  await expect(
    page
      .locator('[data-role="user"]')
      .getByRole('button', { name: 'Edit message' }),
  ).toBeFocused();

  const assistantMessage = page.locator('[data-role="assistant"]').last();
  await expect(
    assistantMessage.getByRole('button', { name: 'Previous branch' }),
  ).toHaveCount(0);
  const originalAssistantId =
    await assistantMessage.getAttribute('data-message-id');
  let regenerateResponseStatus: number | undefined;
  let regenerateResponseBody:
    | Promise<{
        readonly chatId?: string;
        readonly userMessageId?: string;
        readonly assistantMessageId?: string;
        readonly runId?: string;
      }>
    | undefined;
  const captureRegenerateResponse = (
    response: import('@playwright/test').Response,
  ) => {
    if (
      response.request().method() === 'POST' &&
      response.url().endsWith(`/messages/${originalAssistantId}/regenerate`)
    ) {
      regenerateResponseStatus = response.status();
      regenerateResponseBody = response.json();
    }
  };
  page.on('response', captureRegenerateResponse);
  await page.getByRole('button', { name: 'Regenerate answer' }).click();
  await expect
    .poll(() => assistantMessage.getAttribute('data-message-id'))
    .not.toBe(originalAssistantId);
  page.off('response', captureRegenerateResponse);
  await expect(
    page.locator('[data-role="assistant"] .aui-md').getByText('Edited answer.'),
  ).toBeVisible({ timeout: 20_000 });
  const regenerateResult = await regenerateResponseBody;
  const chatId = new URL(page.url()).pathname.split('/').at(-1);
  const canonicalResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
    { headers },
  );
  const canonicalTree = (await canonicalResponse.json()) as {
    readonly viewedLeafId?: string | null;
    readonly messages?: readonly {
      readonly id: string;
      readonly role: string;
      readonly parentId: string | null;
      readonly status?: string;
      readonly runId?: string;
    }[];
  };
  const canonicalMessages = canonicalTree.messages ?? [];
  const visibleAssistantIds = await page
    .locator('[data-role="assistant"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-message-id'))
        .filter((id): id is string => id !== null),
    );
  console.log(
    `F4_BRANCH_DIAG ${JSON.stringify({
      regeneratePost: {
        status: regenerateResponseStatus ?? null,
        chatId: regenerateResult?.chatId ?? null,
        userMessageId: regenerateResult?.userMessageId ?? null,
        originalAssistantId,
        assistantMessageId: regenerateResult?.assistantMessageId ?? null,
        runId: regenerateResult?.runId ?? null,
      },
      canonicalGet: {
        status: canonicalResponse.status(),
        viewedLeafId: canonicalTree.viewedLeafId ?? null,
        messages: canonicalMessages.map((message) => ({
          id: message.id,
          role: message.role,
          parentId: message.parentId,
          status: message.status ?? null,
          runId: message.runId ?? null,
        })),
      },
      visibleAssistantIds,
      previousBranchButtonCount: await assistantMessage
        .getByRole('button', { name: 'Previous branch' })
        .count(),
    })}`,
  );
  await expect(
    assistantMessage.getByRole('button', { name: 'Previous branch' }),
  ).toBeVisible();
  await expect(
    assistantMessage.getByText('2 / 2', { exact: true }),
  ).toBeVisible();
  const threadUrl = page.url();
  await assistantMessage
    .getByRole('button', { name: 'Previous branch' })
    .click();
  await expect(
    page
      .locator('[data-role="assistant"]')
      .last()
      .getByText('1 / 2', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(threadUrl);
  await expect(page.getByText('Edited answer.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page
      .locator('[data-role="assistant"]')
      .last()
      .getByText('1 / 2', { exact: true }),
  ).toBeVisible();

  const deepThinking = page.getByRole('button', { name: 'Deep thinking' });
  await deepThinking.click();
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
  const byteBoundaryPrefix = '[task14:byte-boundary]';
  const exactBoundaryPrompt =
    byteBoundaryPrefix +
    'x'.repeat(
      16_384 - new TextEncoder().encode(byteBoundaryPrefix).byteLength,
    );
  const followup = page.getByRole('textbox', { name: 'Message input' });
  await followup.fill(exactBoundaryPrompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page
      .locator('[data-role="assistant"] .aui-md')
      .getByText('Accepted exact 16,384-byte prompt.'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'false');
  const chatId = new URL(page.url()).pathname.split('/').at(-1)!;
  const persistedTree = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
    { headers },
  );
  expect(persistedTree.status()).toBe(200);
  const tree = (await persistedTree.json()) as {
    messages: Array<{ role: string; text?: string; effort?: string }>;
  };
  const savedFollowup = tree.messages.find(
    (message) =>
      message.role === 'user' && message.text === exactBoundaryPrompt,
  );
  expect(savedFollowup?.effort).toBe('max');
  expect(new TextEncoder().encode(savedFollowup?.text ?? '').byteLength).toBe(
    16_384,
  );

  await deepThinking.click();
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
  const overLimitRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/messages'))
      overLimitRequests.push(request.url());
  });
  await followup.fill('x'.repeat(16_385));
  const requestsBeforeOverLimitSubmit = overLimitRequests.length;
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeDisabled();
  await expect(
    page.locator('form').filter({ has: followup }).getByRole('alert'),
  ).toContainText('16,384 bytes');
  await expect(followup).toHaveValue('x'.repeat(16_385));
  expect(overLimitRequests).toHaveLength(requestsBeforeOverLimitSubmit);
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
  await followup.fill('');

  await page.route('**/api/chats/*/messages', async (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'AI_CAPACITY_EXCEEDED' }),
    }),
  );
  await followup.fill(
    'This follow-up is rejected by the scripted browser route.',
  );
  const rejectedSend = page.waitForResponse(
    (response) =>
      response.url().includes('/messages') && response.status() === 503,
  );
  await followup.press('Enter');
  await rejectedSend;
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('[data-role="assistant"] [role="alert"]'),
  ).toBeVisible();
});

test('retains a measured private reasoning duration without exposing a summary', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task 14 Private Reasoning Timing',
    email: `task-14-timing-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);
  await page.goto(`${stack.publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await composer.fill('[task14:raw-duration] private reasoning only');
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  const chatId = new URL(page.url()).pathname.split('/').at(-1)!;
  const answer = page.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText('Scripted answer:', { timeout: 20_000 });
  await expect(answer).toContainText('Thought for 2 seconds');
  await expect(
    answer.getByRole('button', { name: 'Thought for 2 seconds' }),
  ).toHaveCount(0);
  const persisted = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
    { headers },
  );
  expect(persisted.status()).toBe(200);
  const tree = (await persisted.json()) as {
    messages: Array<{
      role: string;
      reasoningSummary?: string | null;
      reasoningDurationMs?: number | null;
    }>;
  };
  const savedAnswer = tree.messages.at(-1);
  expect(savedAnswer?.role).toBe('assistant');
  expect(savedAnswer?.reasoningSummary).toBeNull();
  expect(savedAnswer?.reasoningDurationMs).toBe(2_300);
  await page.reload();
  await expect(page.locator('[data-role="assistant"]').last()).toContainText(
    'Thought for 2 seconds',
  );
  await expect(
    page
      .locator('[data-role="assistant"]')
      .last()
      .getByRole('button', { name: 'Thought for 2 seconds' }),
  ).toHaveCount(0);
});

test('restores a failed answer with retry and a cancelled answer with stopped state', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task 14 Terminal Preview',
    email: `task-14-terminal-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${stack.publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await composer.fill('[runtime-proof:error] task14 persisted error');
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  const failedAnswer = page.locator('[data-role="assistant"] [role="alert"]');
  await expect(failedAnswer).toContainText(
    'The response could not be completed.',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.reload();
  await expect(failedAnswer).toContainText(
    'The response could not be completed.',
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page
      .locator('[data-role="assistant"] .aui-md')
      .getByText('Try again succeeded.'),
  ).toBeVisible({ timeout: 20_000 });

  const chatId = new URL(page.url()).pathname.split('/').at(-1)!;
  const beforeHold = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
    { headers },
  );
  expect(beforeHold.status()).toBe(200);
  const beforeHoldTree = (await beforeHold.json()) as {
    messages: Array<{ id: string; role: string; runId?: string }>;
  };
  const previousRunIds = new Set(
    beforeHoldTree.messages.flatMap((message) =>
      message.role === 'assistant' && message.runId ? [message.runId] : [],
    ),
  );
  await composer.fill('[runtime-proof:hold] task14 stop state');
  await composer.press('Enter');
  const runId = await latestRunId(
    page,
    stack.apiUrl,
    chatId,
    headers,
    previousRunIds,
  );
  let stoppedAssistantId: string | undefined;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
        { headers },
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ id: string; role: string; runId?: string }>;
      };
      stoppedAssistantId = tree.messages.find(
        (message) => message.role === 'assistant' && message.runId === runId,
      )?.id;
      return stoppedAssistantId;
    })
    .toBeTruthy();
  await expect
    .poll(() => workerControl('status', runId))
    .toMatchObject({ prefixBlocked: true });
  const viewportMeasurements = await page.evaluate(async () => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    );
    if (!viewport) throw new Error('Chat thread viewport is missing');
    const measurements: Array<{
      height: number;
      availableHeight: number;
    }> = [];
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const rect = viewport.getBoundingClientRect();
      measurements.push({
        height: viewport.clientHeight,
        availableHeight: Math.max(0, window.innerHeight - rect.top),
      });
    }
    return measurements;
  });
  expect(
    viewportMeasurements.every(
      ({ height, availableHeight }) => height <= availableHeight + 1,
    ),
    `Chat viewport exceeded the available height: ${JSON.stringify(viewportMeasurements)}`,
  ).toBe(true);
  const measuredHeights = viewportMeasurements.map(({ height }) => height);
  expect(
    Math.max(...measuredHeights) - Math.min(...measuredHeights),
    `Chat viewport height kept growing: ${JSON.stringify(viewportMeasurements)}`,
  ).toBeLessThanOrEqual(1);
  await workerControl('release-prefix', runId);
  await expect
    .poll(() => workerControl('status', runId))
    .toMatchObject({ blocked: true, prefixBlocked: false });
  const stoppedMessage = page.locator(
    `[data-role="assistant"][data-message-id="${stoppedAssistantId}"]`,
  );
  await expect(stoppedMessage.locator('.aui-md')).toContainText(
    'Answer prefix —',
  );
  const stop = page.getByRole('button', { name: 'Stop generating' });
  await expect(stop).toBeVisible({ timeout: 20_000 });
  const cancelResponsePromise = page.waitForResponse(
    (response) => {
      return new URL(response.url()).pathname === `/api/runs/${runId}/cancel`;
    },
    { timeout: 15_000 },
  );
  await stop.click({ timeout: 10_000 });
  const cancelResponse = await cancelResponsePromise;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
        { headers },
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{
          id: string;
          role: string;
          runId?: string;
          status?: string;
        }>;
      };
      return tree.messages.find(
        (message) => message.role === 'assistant' && message.runId === runId,
      )?.status;
    })
    .toBe('cancelled');
  expect(cancelResponse.ok()).toBe(true);
  await workerControl('release', runId);
  await expect(stoppedMessage).toContainText('Stopped');
  await page.reload();
  await expect(stoppedMessage).toContainText('Stopped');
  await expect(
    page.getByRole('textbox', { name: 'Message input' }),
  ).toHaveAttribute(
    'placeholder',
    'Ask Lexon about a contract, a regulation, or a case...',
  );
});
