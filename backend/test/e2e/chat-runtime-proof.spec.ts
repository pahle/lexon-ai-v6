import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';

async function workerControl(
  op:
    | 'status'
    | 'release-prefix'
    | 'release'
    | 'cursor'
    | 'trim'
    | 'shape'
    | 'database-tree',
  runId: string,
  cursor?: string,
) {
  const worker = await containerId('ai-worker');
  const output = await docker([
    'exec',
    worker,
    'node',
    'backend/test/e2e/chat-worker-control.mjs',
    op,
    runId,
    ...(cursor ? [cursor] : []),
  ]);
  return JSON.parse(output) as {
    blocked?: boolean;
    prefixBlocked?: boolean;
    released?: boolean;
    exists?: boolean;
    removed?: number;
    viewedLeafId?: string | null;
    messages?: Array<{
      id: string;
      parentId: string | null;
      role: string;
      status: string | null;
      textMatches: boolean;
    }>;
    [key: string]: unknown;
  } | null;
}

async function expectVisibleAssistantPath(
  page: Page,
  apiUrl: string,
  chatId: string,
) {
  const response = await page.request.get(`${apiUrl}/api/chats/${chatId}`);
  expect(response.ok()).toBe(true);
  const tree = (await response.json()) as {
    viewedLeafId: string;
    messages: Array<{
      id: string;
      role: string;
      parentId: string | null;
    }>;
  };
  const byId = new Map(tree.messages.map((message) => [message.id, message]));
  const path = [];
  let current = byId.get(tree.viewedLeafId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const expectedIds = path.map((message) => message.id);
  const visibleIds = await page
    .locator('[data-message-id][data-role]')
    .evaluateAll((articles) =>
      articles.map((article) => article.getAttribute('data-message-id')),
    );
  expect(visibleIds).toEqual(expectedIds);
  return { tree, expectedIds };
}

async function readSafeClientSseFrames(page: Page) {
  return page.evaluate(() => {
    const proofWindow = window as Window & {
      __task10SseFrames?: Array<Record<string, unknown>>;
    };
    return proofWindow.__task10SseFrames ?? [];
  });
}

test('the public assistant runtime sends through the Caddy API to the scripted real worker', async ({
  page,
}) => {
  const stack = descriptor();
  const runResponses: Array<{
    path: string;
    status: number;
    recoveryMode?: string;
  }> = [];
  const mutationResponses: Array<{ path: string; status: number }> = [];
  const mutationRequests: Array<{
    path: string;
    method: string;
    body?: Record<string, unknown>;
  }> = [];
  const runRequestFailures: Array<{
    path: string;
    method: string;
    failure?: string;
  }> = [];
  const browserErrors: string[] = [];
  page.on('pageerror', (error) =>
    browserErrors.push(error.message.slice(0, 240)),
  );
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname;
    if (path.includes('/chats/') && path.includes('/messages'))
      mutationResponses.push({ path, status: response.status() });
    if (!path.includes('/runs/') || !path.endsWith('/events')) return;
    const headers = await response.allHeaders();
    runResponses.push({
      path,
      status: response.status(),
      ...(headers['x-lexon-stream-recovery-result']
        ? { recoveryMode: headers['x-lexon-stream-recovery-result'] }
        : {}),
    });
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'POST' || !path.includes('/messages')) return;
    try {
      const body = JSON.parse(request.postData() ?? '{}') as Record<
        string,
        unknown
      >;
      mutationRequests.push({ path, method: request.method(), body });
    } catch {
      mutationRequests.push({ path, method: request.method() });
    }
  });
  page.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.includes('/runs/')) return;
    runRequestFailures.push({
      path,
      method: request.method(),
      ...(request.failure()?.errorText
        ? { failure: request.failure()!.errorText }
        : {}),
    });
  });
  const authHeaders = await authenticateApi(page.request, {
    name: 'Runtime proof identity',
  });
  const chatId = randomUUID();
  const userMessageId = randomUUID();
  const created = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers: { ...authHeaders, 'content-type': 'application/json' },
    data: {
      chatId,
      userMessageId,
      requestId: randomUUID(),
      text: 'baseline runtime proof prompt',
      effort: 'high',
    },
  });
  expect(created.status()).toBe(201);
  const mutation = (await created.json()) as {
    chatId: string;
    userMessageId: string;
    assistantMessageId: string;
    runId: string;
  };
  expect(mutation.chatId).toBe(chatId);
  expect(mutation.userMessageId).toBe(userMessageId);
  await page.addInitScript(() => {
    type SafeFrame = {
      type?: string;
      id?: string;
      runId?: string;
      messageId?: string;
      status?: string;
      durationMs?: number;
      code?: string;
      textLength?: number;
      deltaLength?: number;
      partType?: string;
      final?: boolean;
      snapshot?: {
        status?: string;
        generation?: number | null;
        revision?: number;
        eventId?: string | null;
      };
    };
    const proofWindow = window as Window & {
      __task10SseFrames?: SafeFrame[];
    };
    proofWindow.__task10SseFrames = [];
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
              ...(typeof value.messageId === 'string'
                ? { messageId: value.messageId }
                : {}),
              ...(typeof value.status === 'string'
                ? { status: value.status }
                : {}),
              ...(typeof value.durationMs === 'number'
                ? { durationMs: value.durationMs }
                : {}),
              ...(typeof value.code === 'string' ? { code: value.code } : {}),
              ...(typeof value.text === 'string'
                ? { textLength: value.text.length }
                : {}),
              ...(typeof value.delta === 'string'
                ? { deltaLength: value.delta.length }
                : {}),
              ...(typeof value.partType === 'string'
                ? { partType: value.partType }
                : {}),
              ...(typeof value.final === 'boolean'
                ? { final: value.final }
                : {}),
            };
            if (value.snapshot && typeof value.snapshot === 'object') {
              const snapshot = value.snapshot as Record<string, unknown>;
              summary.snapshot = {
                ...(typeof snapshot.status === 'string'
                  ? { status: snapshot.status }
                  : {}),
                ...(typeof snapshot.generation === 'number' ||
                snapshot.generation === null
                  ? { generation: snapshot.generation }
                  : {}),
                ...(typeof snapshot.revision === 'number'
                  ? { revision: snapshot.revision }
                  : {}),
                ...(typeof snapshot.eventId === 'string' ||
                snapshot.eventId === null
                  ? { eventId: snapshot.eventId }
                  : {}),
              };
            }
            proofWindow.__task10SseFrames?.push(summary);
            return summary.type === 'finish';
          } catch {
            proofWindow.__task10SseFrames?.push({ type: 'invalid-json-frame' });
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
          if (buffer && record(buffer)) await reader.cancel();
        } catch {
          proofWindow.__task10SseFrames?.push({ type: 'observer-read-failed' });
        }
      })();
      return response;
    };
  });
  const prePageTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  expect(prePageTreeResponse.status()).toBe(200);
  const prePageTree = (await prePageTreeResponse.json()) as {
    viewedLeafId: string;
    messages: Array<{
      id: string;
      role: string;
      status?: string;
      text: string;
    }>;
  };
  const prePageAssistant = prePageTree.messages.find(
    (message) => message.id === mutation.assistantMessageId,
  );
  expect(prePageTree.viewedLeafId).toBe(mutation.assistantMessageId);
  expect(prePageAssistant).toMatchObject({ role: 'assistant' });

  await page.goto(`${stack.publicUrl}/e2e/chat-runtime?chatId=${chatId}`);
  await expect(
    page.getByRole('heading', { name: 'Runtime proof' }),
  ).toBeVisible();
  const seedInspection = page.getByTestId('seed-inspection');
  await expect(seedInspection).toHaveAttribute(
    'data-viewed-leaf-id',
    prePageTree.viewedLeafId,
  );
  await expect(seedInspection).toHaveAttribute(
    'data-assistant-id',
    mutation.assistantMessageId,
  );
  await expect(
    page.locator(`[data-message-id="${mutation.assistantMessageId}"]`),
  ).toHaveAttribute('data-reasoning-duration-ms', '');
  await expect(
    page
      .locator(`[data-message-id="${mutation.assistantMessageId}"]`)
      .getByTestId('reasoning-duration-label'),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ id: string; status?: string; text: string }>;
      };
      const assistant = tree.messages.find(
        (message) => message.id === mutation.assistantMessageId,
      );
      return assistant
        ? { status: assistant.status, text: assistant.text }
        : undefined;
    })
    .toEqual({
      status: 'completed',
      text: 'Scripted answer: baseline runtime proof prompt',
    });
  try {
    await expect(
      page.locator(`[data-message-id="${mutation.assistantMessageId}"]`),
    ).toContainText('Scripted answer: baseline runtime proof prompt');
  } catch (failure) {
    const streamResponse = await page.request
      .get(`${stack.apiUrl}/api/runs/${mutation.runId}/events`, {
        headers: { 'x-lexon-stream-recovery': 'snapshot' },
        timeout: 5000,
      })
      .catch(() => undefined);
    const diagnosticSseHeaders = streamResponse
      ? {
          status: streamResponse.status(),
          recoveryMode:
            streamResponse.headers()['x-lexon-stream-recovery-result'],
        }
      : undefined;
    await streamResponse?.dispose();
    const partState = await page
      .locator(`[data-message-id="${mutation.assistantMessageId}"]`)
      .getAttribute('data-part-state');
    const clientSseFrames = await readSafeClientSseFrames(page);
    throw new Error(
      `${failure instanceof Error ? failure.message : 'Seeded answer assertion failed'}\nRuntime diagnostics: ${JSON.stringify({ prePageAssistant: { status: prePageAssistant?.status, textLength: prePageAssistant?.text.length }, clientSeedStatus: await seedInspection.getAttribute('data-assistant-status'), partState, runResponses, clientSseFrames, runRequestFailures, browserErrors, diagnosticSseHeaders })}`,
      { cause: failure },
    );
  }
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ id: string; status?: string }>;
      };
      return tree.messages.find(
        (message) => message.id === mutation.assistantMessageId,
      )?.status;
    })
    .toBe('completed');

  const sendButton = page.getByRole('button', { name: 'Send' });
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('browser branch [runtime-proof:regenerate]');
  try {
    await expect(sendButton).toBeEnabled({ timeout: 7000 });
  } catch (failure) {
    const treeResponse = await page.request.get(
      `${stack.apiUrl}/api/chats/${chatId}`,
    );
    const currentTree = treeResponse.ok()
      ? ((await treeResponse.json()) as {
          messages: Array<{ role: string; status?: string; text: string }>;
        })
      : undefined;
    throw new Error(
      `${failure instanceof Error ? failure.message : 'Send remained disabled after terminal persistence'}\nRuntime diagnostics: ${JSON.stringify({ threadIsRunning: await page.getByTestId('runtime-is-running').textContent(), sendDisabled: await sendButton.isDisabled(), persistedMessages: currentTree?.messages.map(({ role, status, text }) => ({ role, status, textLength: text.length })), runResponses, clientSseFrames: await readSafeClientSseFrames(page), runRequestFailures, browserErrors })}`,
      { cause: failure },
    );
  }

  await sendButton.click();
  try {
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
        );
        if (!response.ok()) return undefined;
        const tree = (await response.json()) as {
          messages: Array<{ role: string; status?: string; text: string }>;
        };
        const assistant = [...tree.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        return assistant
          ? { status: assistant.status, text: assistant.text }
          : undefined;
      })
      .toEqual({ status: 'completed', text: 'Sibling answer 1.' });
    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toHaveAttribute('data-reasoning-duration-ms', '');
    await expect(
      page
        .locator('[data-role="assistant"]')
        .last()
        .getByTestId('reasoning-duration-label'),
    ).toHaveCount(0);
  } catch (failure) {
    const response = await page.request.get(
      `${stack.apiUrl}/api/chats/${chatId}`,
    );
    const tree = response.ok()
      ? ((await response.json()) as {
          messages: Array<{
            role: string;
            status?: string;
            text: string;
            runId?: string;
          }>;
        })
      : undefined;
    const assistant = tree?.messages
      .filter((message) => message.role === 'assistant')
      .at(-1);
    const streamResponse = assistant?.runId
      ? await page.request
          .get(`${stack.apiUrl}/api/runs/${assistant.runId}/events`, {
            headers: { 'x-lexon-stream-recovery': 'snapshot' },
            timeout: 5000,
          })
          .catch(() => undefined)
      : undefined;
    const diagnosticSseHeaders = streamResponse
      ? {
          status: streamResponse.status(),
          recoveryMode:
            streamResponse.headers()['x-lexon-stream-recovery-result'],
        }
      : undefined;
    await streamResponse?.dispose();
    const details = {
      messages: tree?.messages.map(({ role, status, text, runId }) => ({
        role,
        status,
        textLength: text.length,
        runId,
      })),
      runResponses,
      clientSseFrames: await readSafeClientSseFrames(page),
      diagnosticSseHeaders,
    };
    throw new Error(
      `${failure instanceof Error ? failure.message : 'Stream assertion failed'}\nRuntime diagnostics: ${JSON.stringify(details)}`,
      { cause: failure },
    );
  }
  try {
    await expect(page.locator('[data-role="assistant"]').last()).toContainText(
      'Sibling answer 1.',
    );
  } catch (failure) {
    const response = await page.request.get(
      `${stack.apiUrl}/api/chats/${chatId}`,
    );
    const currentTree = response.ok()
      ? ((await response.json()) as {
          viewedLeafId: string;
          messages: Array<{
            id: string;
            role: string;
            status?: string;
            parentId: string | null;
            text: string;
            runId?: string;
          }>;
        })
      : undefined;
    const uiMessages = await page
      .locator('[data-role="assistant"]')
      .evaluateAll((articles) =>
        articles.map((article) => ({
          id: article.getAttribute('data-message-id'),
          partState: article.getAttribute('data-part-state'),
        })),
      );
    const assistant = currentTree?.messages
      .filter((message) => message.role === 'assistant')
      .at(-1);
    const workerInputShape = assistant?.runId
      ? await workerControl('shape', assistant.runId)
      : null;
    const currentUser = currentTree?.messages
      .filter((message) => message.role === 'user')
      .at(-1);
    throw new Error(
      `${failure instanceof Error ? failure.message : 'Rendered answer assertion failed'}\nRuntime diagnostics: ${JSON.stringify({ runResponses, clientSseFrames: await readSafeClientSseFrames(page), mutationResponses, runRequestFailures, browserErrors, uiMessages, selectedLeafId: currentTree?.viewedLeafId, currentUserTextLength: currentUser?.text.length, workerInputShape, persistedMessages: currentTree?.messages.map(({ id, role, status, parentId, text }) => ({ id, role, status, parentId, textLength: text.length, expectedSyntheticAnswer: role === 'assistant' && text === 'Sibling answer 1.' })) })}`,
      { cause: failure },
    );
  }

  const treeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  expect(treeResponse.status()).toBe(200);
  const tree = (await treeResponse.json()) as {
    id: string;
    viewedLeafId: string;
    messages: Array<{
      id: string;
      role: string;
      parentId: string | null;
      text: string;
      status?: string;
    }>;
  };
  expect(tree.id).toBe(chatId);
  expect(tree.viewedLeafId).not.toBe(mutation.assistantMessageId);
  expect(tree.messages).toHaveLength(4);
  expect(tree.messages).toEqual([
    expect.objectContaining({
      id: userMessageId,
      role: 'user',
      parentId: null,
    }),
    expect.objectContaining({
      id: mutation.assistantMessageId,
      role: 'assistant',
      parentId: userMessageId,
      text: 'Scripted answer: baseline runtime proof prompt',
      status: 'completed',
    }),
    expect.objectContaining({
      role: 'user',
      parentId: mutation.assistantMessageId,
      text: 'browser branch [runtime-proof:regenerate]',
    }),
    expect.objectContaining({
      role: 'assistant',
      parentId: tree.messages[2]?.id,
      text: 'Sibling answer 1.',
      status: 'completed',
    }),
  ]);

  await page.getByTestId('proof-regenerate').click();
  try {
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
        );
        if (!response.ok()) return undefined;
        const current = (await response.json()) as {
          messages: Array<{
            role: string;
            parentId: string | null;
            status?: string;
            text: string;
          }>;
        };
        const siblings = current.messages.filter(
          (message) =>
            message.role === 'assistant' &&
            message.parentId === tree.messages[2]?.id,
        );
        return siblings.map(({ status, text }) => ({ status, text }));
      })
      .toEqual([
        { status: 'completed', text: 'Sibling answer 1.' },
        { status: 'completed', text: 'Sibling answer 2.' },
      ]);
  } catch (failure) {
    const response = await page.request.get(
      `${stack.apiUrl}/api/chats/${chatId}`,
    );
    const current = response.ok()
      ? ((await response.json()) as {
          viewedLeafId: string;
          messages: Array<{
            id: string;
            role: string;
            parentId: string | null;
            status?: string;
            text: string;
          }>;
        })
      : undefined;
    const selectedAssistant = current?.messages.find(
      (message) => message.id === current.viewedLeafId,
    );
    throw new Error(
      `${failure instanceof Error ? failure.message : 'Regeneration assertion failed'}\nRegeneration diagnostics: ${JSON.stringify(
        {
          selectedAssistant: selectedAssistant && {
            id: selectedAssistant.id,
            status: selectedAssistant.status,
            parentId: selectedAssistant.parentId,
            textLength: selectedAssistant.text.length,
          },
          requests: mutationRequests.map(({ path, body }) => ({
            path,
            messageId: body?.messageId,
            parentMessageId: body?.parentMessageId,
          })),
          responses: mutationResponses,
          runResponses,
          runRequestFailures,
          browserErrors,
          siblings: current?.messages
            .filter(
              (message) =>
                message.role === 'assistant' &&
                message.parentId === tree.messages[2]?.id,
            )
            .map(({ id, status, text }) => ({
              id,
              status,
              textLength: text.length,
            })),
        },
      )}`,
      { cause: failure },
    );
  }
  const regeneratedTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const regeneratedTree = (await regeneratedTreeResponse.json()) as {
    viewedLeafId: string;
    messages: Array<{
      id: string;
      role: string;
      parentId: string | null;
      text: string;
    }>;
  };
  const branchAnswers = regeneratedTree.messages.filter(
    (message) =>
      message.role === 'assistant' && message.parentId === tree.messages[2]?.id,
  );
  expect(branchAnswers).toHaveLength(2);
  const selectedBranchBeforeSwitch = regeneratedTree.viewedLeafId;
  const previousBranch = branchAnswers.find(
    (message) => message.id !== selectedBranchBeforeSwitch,
  );
  if (!previousBranch) throw new Error('Regenerated sibling branch is missing');
  const selectedAssistantArticle = page
    .locator('[data-role="assistant"]')
    .last();
  await expect(selectedAssistantArticle).toHaveAttribute(
    'data-message-id',
    selectedBranchBeforeSwitch,
  );
  await expect(selectedAssistantArticle).toHaveAttribute(
    'data-branch-count',
    '2',
  );
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  const selectedBranchNumber = Number(
    await selectedAssistantArticle.getAttribute('data-branch-number'),
  );
  expect([1, 2]).toContain(selectedBranchNumber);

  await test.step('switch to the other server branch live', async () => {
    try {
      const previousButton = page
        .getByRole('button', { name: 'Previous answer' })
        .last();
      const nextButton = page
        .getByRole('button', { name: 'Next answer' })
        .last();
      if (
        selectedBranchNumber === 2 &&
        (await previousButton.isVisible()) &&
        (await previousButton.isEnabled())
      ) {
        await previousButton.click({ timeout: 2500 });
      } else if (
        selectedBranchNumber === 1 &&
        (await nextButton.isVisible()) &&
        (await nextButton.isEnabled())
      ) {
        await nextButton.click({ timeout: 2500 });
      } else {
        throw new Error(
          'Neither branch direction is available for the selected branch.',
        );
      }
    } catch (failure) {
      const current = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      const currentTree = current.ok()
        ? ((await current.json()) as {
            viewedLeafId: string;
            messages: Array<{
              id: string;
              role: string;
              status?: string;
              parentId: string | null;
              text: string;
              runId?: string;
            }>;
          })
        : undefined;
      const uiMessages = await page
        .locator('[data-role="assistant"]')
        .evaluateAll((articles) =>
          articles.map((article) => ({
            id: article.getAttribute('data-message-id'),
            branchNumber: article.getAttribute('data-branch-number'),
            branchCount: article.getAttribute('data-branch-count'),
            partState: article.getAttribute('data-part-state'),
          })),
        );
      const branchControls = await page
        .locator('[aria-label="Previous answer"], [aria-label="Next answer"]')
        .evaluateAll((buttons) =>
          buttons.map((button) => ({
            label: button.getAttribute('aria-label'),
            disabled: (button as HTMLButtonElement).disabled,
            ariaDisabled: button.getAttribute('aria-disabled'),
            hidden: (button as HTMLButtonElement).hidden,
            display: getComputedStyle(button).display,
            visibility: getComputedStyle(button).visibility,
            hasLayoutBox: button.getClientRects().length > 0,
          })),
        );
      throw new Error(
        `${failure instanceof Error ? failure.message : 'Live branch picker failed'}\nLive branch diagnostics: ${JSON.stringify(
          {
            runResponses,
            clientSseFrames: await readSafeClientSseFrames(page),
            mutationRequests: mutationRequests.map(({ path, body }) => ({
              path,
              messageId: body?.messageId,
              parentMessageId: body?.parentMessageId,
            })),
            mutationResponses,
            runRequestFailures,
            browserErrors,
            threadIsRunning: await page
              .getByTestId('runtime-is-running')
              .textContent(),
            uiMessages,
            branchControls,
            selectedLeafId: currentTree?.viewedLeafId,
            messages: currentTree?.messages.map(
              ({ id, role, status, parentId, text, runId }) => ({
                id,
                role,
                status,
                parentId,
                runId,
                textLength: text.length,
                equalsExpectedSibling: text === 'Sibling answer 1.',
              }),
            ),
          },
        )}`,
        { cause: failure },
      );
    }
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
        );
        return response.ok()
          ? ((await response.json()) as { viewedLeafId: string }).viewedLeafId
          : undefined;
      })
      .toBe(previousBranch.id);
    const { tree: selectedTree } = await expectVisibleAssistantPath(
      page,
      stack.apiUrl,
      chatId,
    );
    expect(selectedTree.viewedLeafId).toBe(previousBranch.id);
  });
  await test.step('reload restores the persisted viewed branch', async () => {
    await page.reload();
    await expect(page.getByTestId('seed-inspection')).toHaveAttribute(
      'data-viewed-leaf-id',
      previousBranch.id,
    );
    await expect(
      page.locator(`[data-message-id="${previousBranch.id}"]`),
    ).toContainText(previousBranch.text);
    const { tree: reloadedTree } = await expectVisibleAssistantPath(
      page,
      stack.apiUrl,
      chatId,
    );
    expect(reloadedTree.viewedLeafId).toBe(previousBranch.id);
  });

  await page
    .getByRole('textbox', { name: 'Proof edit prompt' })
    .fill('[runtime-proof:edit] revised nonroot prompt');
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  await page.getByTestId('proof-edit').click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const current = (await response.json()) as {
        viewedLeafId: string;
        messages: Array<{
          id: string;
          role: string;
          parentId: string | null;
          text: string;
          status?: string;
        }>;
      };
      const answer = current.messages.find(
        (message) => message.id === current.viewedLeafId,
      );
      const request = mutationRequests
        .filter(({ path }) => path.endsWith('/edit'))
        .at(-1);
      const editedUser = current.messages.find(
        (message) => message.id === request?.body?.newMessageId,
      );
      return answer && editedUser
        ? {
            assistantParentId: answer.parentId,
            editedUserId: editedUser.id,
            userParentId: editedUser.parentId,
            text: answer.text,
            status: answer.status,
          }
        : undefined;
    })
    .toEqual({
      assistantParentId: expect.any(String),
      editedUserId: expect.any(String),
      userParentId: tree.messages[1]?.id,
      text: 'Edited answer.',
      status: 'completed',
    });
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  const editRequests = mutationRequests.filter(({ path }) =>
    path.endsWith('/edit'),
  );
  expect(editRequests.at(-1)?.body?.messageId).toBe(tree.messages[2]?.id);
  const nonrootEditedTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const nonrootEditedTree = (await nonrootEditedTreeResponse.json()) as {
    viewedLeafId: string;
    messages: Array<{ id: string; role: string; parentId: string | null }>;
  };
  const nonrootEditedUser = nonrootEditedTree.messages.find(
    (message) => message.id === editRequests.at(-1)?.body?.newMessageId,
  );
  const nonrootEditedAssistant = nonrootEditedTree.messages.find(
    (message) => message.id === nonrootEditedTree.viewedLeafId,
  );
  expect(nonrootEditedUser).toMatchObject({
    role: 'user',
    parentId: tree.messages[1]?.id,
  });
  expect(nonrootEditedAssistant?.parentId).toBe(nonrootEditedUser?.id);
  expect(editRequests.at(-1)?.body).toMatchObject({
    text: '[runtime-proof:edit] revised nonroot prompt',
    effort: 'high',
  });
  expect(typeof editRequests.at(-1)?.body?.messageId).toBe('string');
  expect(typeof editRequests.at(-1)?.body?.newMessageId).toBe('string');

  await page
    .getByRole('textbox', { name: 'Proof edit prompt' })
    .fill('[runtime-proof:edit] revised root prompt');
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  await page.getByTestId('proof-edit-root').click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const current = (await response.json()) as {
        viewedLeafId: string;
        messages: Array<{
          id: string;
          role: string;
          parentId: string | null;
          text: string;
          status?: string;
        }>;
      };
      const answer = current.messages.find(
        (message) => message.id === current.viewedLeafId,
      );
      const request = mutationRequests
        .filter(({ path }) => path.endsWith('/edit'))
        .at(-1);
      const editedUser = current.messages.find(
        (message) => message.id === request?.body?.newMessageId,
      );
      return answer && editedUser
        ? {
            assistantParentId: answer.parentId,
            editedUserId: editedUser.id,
            userParentId: editedUser.parentId,
            text: answer.text,
            status: answer.status,
            count: current.messages.length,
          }
        : undefined;
    })
    .toEqual({
      assistantParentId: expect.any(String),
      editedUserId: expect.any(String),
      userParentId: null,
      text: 'Edited answer.',
      status: 'completed',
      count: 9,
    });
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  const rootEditRequest = mutationRequests
    .filter(({ path }) => path.endsWith('/edit'))
    .at(-1);
  expect(rootEditRequest?.body).toMatchObject({
    text: '[runtime-proof:edit] revised root prompt',
    effort: 'high',
  });

  const finalTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const finalTree = (await finalTreeResponse.json()) as {
    messages: Array<{ id: string; role: string; parentId: string | null }>;
  };
  const lastEdit = mutationRequests
    .filter(({ path }) => path.endsWith('/edit'))
    .at(-1)?.body;
  const rootEditedUser = finalTree.messages.find(
    (message) => message.id === lastEdit?.newMessageId,
  );
  expect(rootEditedUser).toMatchObject({ role: 'user', parentId: null });
  expect(
    finalTree.messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.id !== tree.messages[1]?.id &&
        message.parentId === rootEditedUser?.id,
    ),
  ).toBeTruthy();
  expect(finalTree.messages).toHaveLength(9);

  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('[runtime-proof:reasoning]');
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const current = (await response.json()) as {
        messages: Array<{
          id: string;
          role: string;
          status?: string;
          text: string;
          reasoningSummary?: string | null;
          reasoningDurationMs?: number | null;
        }>;
      };
      const answer = current.messages
        .filter((message) => message.role === 'assistant')
        .at(-1);
      return answer
        ? {
            status: answer.status,
            text: answer.text,
            reasoningSummary: answer.reasoningSummary,
            reasoningDurationMs: answer.reasoningDurationMs,
          }
        : undefined;
    })
    .toEqual({
      status: 'completed',
      text: 'Reasoned synthetic answer.',
      reasoningSummary: 'Synthetic reasoning summary.',
      reasoningDurationMs: 17,
    });
  await expect(page.getByTestId('runtime-is-running')).toHaveText('false');
  const reasoningTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const reasoningTree = (await reasoningTreeResponse.json()) as {
    viewedLeafId: string;
    messages: Array<{
      id: string;
      role: string;
      parentId: string | null;
      text: string;
      status?: string;
      reasoningSummary?: string | null;
      reasoningDurationMs?: number | null;
    }>;
  };
  const identityResponse = await page.request.get(
    `${stack.apiUrl}/api/identity`,
  );
  expect(identityResponse.ok()).toBe(true);
  const identity = (await identityResponse.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  const databaseTree = await workerControl(
    'database-tree',
    chatId,
    JSON.stringify({
      orgId: identity.organization.id,
      userId: identity.user.id,
      expected: reasoningTree.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
      })),
    }),
  );
  expect(databaseTree?.viewedLeafId).toBe(reasoningTree.viewedLeafId);
  expect(databaseTree?.messages).toEqual(
    reasoningTree.messages.map((message) => ({
      id: message.id,
      parentId: message.parentId,
      role: message.role,
      status: message.status ?? null,
      textMatches: true,
    })),
  );
  const reasoningMessagesById = new Map(
    reasoningTree.messages.map((message) => [message.id, message]),
  );
  const selectedPath: typeof reasoningTree.messages = [];
  let selectedMessage = reasoningMessagesById.get(reasoningTree.viewedLeafId);
  while (selectedMessage) {
    selectedPath.unshift(selectedMessage);
    selectedMessage = selectedMessage.parentId
      ? reasoningMessagesById.get(selectedMessage.parentId)
      : undefined;
  }
  const expectedAssistantIds = selectedPath
    .filter((message) => message.role === 'assistant')
    .map((message) => message.id);
  const visibleMessages = await page
    .locator('[data-message-id][data-role]')
    .evaluateAll((articles) =>
      articles.map((article) => ({
        id: article.getAttribute('data-message-id'),
        role: article.getAttribute('data-role'),
        textLength: article.getAttribute('data-text-content')?.length ?? 0,
      })),
    );
  const expectedVisibleMessages = selectedPath.map((message) => ({
    id: message.id,
    role: message.role,
    textLength: message.text.length,
  }));
  expect(
    visibleMessages,
    JSON.stringify({ visibleMessages, expectedVisibleMessages }),
  ).toEqual(expectedVisibleMessages);
  expect(
    selectedPath
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id),
  ).toEqual(expectedAssistantIds);
  const reasoningAssistant = page.locator(
    `[data-message-id="${reasoningTree.viewedLeafId}"]`,
  );
  await expect(reasoningAssistant).toHaveAttribute(
    'data-text-content',
    'Reasoned synthetic answer.',
  );
  await expect(reasoningAssistant).toHaveAttribute(
    'data-reasoning-content',
    'Synthetic reasoning summary.',
  );
});

test('reloads a paused answer from its received Valkey cursor through Caddy snapshot recovery', async ({
  page,
}) => {
  const stack = descriptor();
  const authHeaders = await authenticateApi(page.request, {
    name: 'Paused runtime proof identity',
  });
  const chatId = randomUUID();
  const userMessageId = randomUUID();
  const created = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers: { ...authHeaders, 'content-type': 'application/json' },
    data: {
      chatId,
      userMessageId,
      requestId: randomUUID(),
      text: 'initial snapshot seed',
      effort: 'high',
    },
  });
  expect(created.status()).toBe(201);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ role: string; status?: string }>;
      };
      return tree.messages
        .filter((message) => message.role === 'assistant')
        .at(-1)?.status;
    })
    .toBe('completed');

  const eventRequests: Array<{
    readonly request: import('@playwright/test').Request;
    readonly path: string;
    readonly runId?: string;
    readonly headers: Record<string, string>;
    response?: import('@playwright/test').Response;
  }> = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.endsWith('/events')) return;
    const runId = path.match(/\/runs\/([^/]+)\/events$/)?.[1];
    eventRequests.push({
      request,
      path,
      ...(runId ? { runId } : {}),
      headers: request.headers(),
    });
  });
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.endsWith('/events')) return;
    const request = eventRequests.findLast(
      (entry) => entry.request === response.request(),
    );
    if (request) request.response = response;
  });
  await page.addInitScript(() => {
    type FrameSummary = {
      readonly path: string;
      readonly id?: string;
      readonly type?: string;
      readonly runId?: string;
      readonly status?: string;
      readonly partCount?: number;
      readonly deltaLength?: number;
      readonly textLength?: number;
      readonly durationMs?: number;
      readonly code?: string;
      readonly snapshot?: {
        readonly generation?: number | null;
        readonly eventId?: string | null;
        readonly revision?: number;
        readonly status?: string;
      };
    };
    const proofWindow = window as Window & {
      __runtimeProofFrames?: FrameSummary[];
    };
    proofWindow.__runtimeProofFrames = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      if (url.pathname.endsWith('/events') && response.body) {
        void (async () => {
          const reader = response.clone().body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let buffer = '';
          const recordFrames = () => {
            for (;;) {
              const boundary = buffer.indexOf('\n\n');
              if (boundary < 0) break;
              const raw = buffer.slice(0, boundary).replace(/\r/g, '');
              buffer = buffer.slice(boundary + 2);
              const id = raw
                .split('\n')
                .find((line) => line.startsWith('id: '))
                ?.slice(4);
              const data = raw
                .split('\n')
                .find((line) => line.startsWith('data: '))
                ?.slice(6);
              let type: string | undefined;
              if (data) {
                try {
                  const parsed = JSON.parse(data) as Record<string, unknown>;
                  if (typeof parsed.type === 'string') type = parsed.type;
                  const snapshot =
                    parsed.snapshot && typeof parsed.snapshot === 'object'
                      ? (parsed.snapshot as Record<string, unknown>)
                      : undefined;
                  proofWindow.__runtimeProofFrames?.push({
                    path: url.pathname,
                    ...(id ? { id } : {}),
                    ...(type ? { type } : {}),
                    ...(typeof parsed.runId === 'string'
                      ? { runId: parsed.runId }
                      : {}),
                    ...(typeof parsed.status === 'string'
                      ? { status: parsed.status }
                      : {}),
                    ...(typeof parsed.partCount === 'number'
                      ? { partCount: parsed.partCount }
                      : {}),
                    ...(typeof parsed.delta === 'string'
                      ? { deltaLength: parsed.delta.length }
                      : {}),
                    ...(typeof parsed.text === 'string'
                      ? { textLength: parsed.text.length }
                      : {}),
                    ...(typeof parsed.durationMs === 'number'
                      ? { durationMs: parsed.durationMs }
                      : {}),
                    ...(typeof parsed.code === 'string'
                      ? { code: parsed.code }
                      : {}),
                    ...(snapshot
                      ? {
                          snapshot: {
                            ...(typeof snapshot.generation === 'number' ||
                            snapshot.generation === null
                              ? { generation: snapshot.generation }
                              : {}),
                            ...(typeof snapshot.eventId === 'string' ||
                            snapshot.eventId === null
                              ? { eventId: snapshot.eventId }
                              : {}),
                            ...(typeof snapshot.revision === 'number'
                              ? { revision: snapshot.revision }
                              : {}),
                            ...(typeof snapshot.status === 'string'
                              ? { status: snapshot.status }
                              : {}),
                          },
                        }
                      : {}),
                  });
                  continue;
                } catch {
                  /* Ignore non-JSON keepalive data. */
                }
              }
              proofWindow.__runtimeProofFrames?.push({
                path: url.pathname,
                ...(id ? { id } : {}),
                ...(type ? { type } : {}),
              });
            }
          };
          for (;;) {
            const { value, done } = await reader.read();
            buffer += decoder
              .decode(value, { stream: !done })
              .replace(/\r\n/g, '\n');
            recordFrames();
            if (done) {
              proofWindow.__runtimeProofFrames?.push({
                path: url.pathname,
                type: 'stream-end',
              });
              break;
            }
          }
        })().catch((error: unknown) => {
          proofWindow.__runtimeProofFrames?.push({
            path: url.pathname,
            type: 'stream-error',
            code: error instanceof Error ? error.name.slice(0, 48) : 'unknown',
          });
        });
      }
      return response;
    };
  });
  await page.goto(`${stack.publicUrl}/e2e/chat-runtime?chatId=${chatId}`);
  await expect(
    page.getByRole('heading', { name: 'Runtime proof' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('[runtime-proof:hold] [runtime-proof:reasoning]');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ role: string; runId?: string }>;
      };
      return tree.messages
        .filter((message) => message.role === 'assistant')
        .at(-1)?.runId;
    })
    .toBeTruthy();
  const beforePrefixResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const beforePrefixTree = (await beforePrefixResponse.json()) as {
    messages: Array<{ id: string; role: string; runId?: string }>;
  };
  const activeRunId = beforePrefixTree.messages
    .filter((message) => message.role === 'assistant')
    .at(-1)?.runId;
  if (!activeRunId) throw new Error('The held run has no server run ID');
  await expect
    .poll(() => workerControl('status', activeRunId))
    .toMatchObject({ prefixBlocked: true });
  await expect
    .poll(() => eventRequests.some((entry) => entry.response?.status() === 200))
    .toBe(true);
  await workerControl('release-prefix', activeRunId);
  await expect(page.locator('[data-role="assistant"]').last()).toContainText(
    'Answer prefix —',
  );
  const activeTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const activeTree = (await activeTreeResponse.json()) as {
    messages: Array<{ role: string; runId?: string; status?: string }>;
  };
  expect(
    activeTree.messages.filter((message) => message.role === 'assistant').at(-1)
      ?.runId,
  ).toBe(activeRunId);
  await expect
    .poll(async () => workerControl('status', activeRunId))
    .toMatchObject({ blocked: true, released: false });

  const actorScope = await page
    .getByTestId('seed-inspection')
    .getAttribute('data-actor-scope');
  if (!actorScope)
    throw new Error('The proof page did not expose its nonsecret actor scope');
  const recoveryKey = `lexon-chat-recovery:${actorScope}:${chatId}`;
  const actualCursor = await page.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    return stored
      ? (JSON.parse(stored) as { cursor?: string }).cursor
      : undefined;
  }, recoveryKey);
  if (!actualCursor) {
    const receivedFrames = await page.evaluate(
      () =>
        (
          window as Window & {
            __runtimeProofFrames?: Array<{
              path: string;
              id?: string;
              type?: string;
            }>;
          }
        ).__runtimeProofFrames ?? [],
    );
    const storedRecord = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      recoveryKey,
    );
    throw new Error(
      `No actual cursor was stored after the held prefix; received SSE frame metadata: ${JSON.stringify(
        {
          receivedFrames,
          hasRecoveryRecord: storedRecord !== null,
          activeRunId,
        },
      )}`,
    );
  }
  expect(actualCursor).toMatch(/^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/);
  expect(await workerControl('cursor', activeRunId, actualCursor!)).toEqual({
    exists: true,
  });
  const priorRequestCount = eventRequests.length;
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Runtime proof' }),
  ).toBeVisible();
  const answer = page.locator('[data-role="assistant"]').last();
  await expect(answer).toHaveAttribute('data-text-content', 'Answer prefix — ');
  await expect(answer).toHaveAttribute(
    'data-reasoning-content',
    'Synthetic reasoning summary.',
  );
  await expect(answer).toHaveAttribute('data-reasoning-duration-ms', '17');
  await expect(answer.getByTestId('reasoning-duration-label')).toHaveText(
    '17 ms',
  );
  await expect
    .poll(() => eventRequests.length)
    .toBeGreaterThan(priorRequestCount);
  const resumedRequest = eventRequests
    .filter((entry) => entry.runId === activeRunId)
    .at(-1);
  expect(resumedRequest?.headers['last-event-id']).toBe(actualCursor);
  expect(resumedRequest?.headers['x-lexon-stream-recovery']).toBe('snapshot');
  await expect.poll(() => resumedRequest?.response?.status()).toBe(200);
  expect(resumedRequest?.response?.status()).toBe(200);
  expect(
    resumedRequest?.response?.headers()['x-lexon-stream-recovery-result'],
  ).toBe('snapshot');

  const retainedCursor = await page.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    return stored
      ? (JSON.parse(stored) as { cursor?: string }).cursor
      : undefined;
  }, recoveryKey);
  expect(retainedCursor).toBe(actualCursor);
  expect(await workerControl('cursor', activeRunId, retainedCursor!)).toEqual({
    exists: true,
  });
  const trimmed = await workerControl('trim', activeRunId);
  expect(trimmed?.removed).toBeGreaterThan(0);
  expect(await workerControl('cursor', activeRunId, retainedCursor!)).toEqual({
    exists: false,
  });
  const priorTrimRecoveryCount = eventRequests.length;
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Runtime proof' }),
  ).toBeVisible();
  const trimmedAnswer = page.locator('[data-role="assistant"]').last();
  await expect(trimmedAnswer).toHaveAttribute(
    'data-text-content',
    'Answer prefix — ',
  );
  await expect(trimmedAnswer).toHaveAttribute(
    'data-reasoning-content',
    'Synthetic reasoning summary.',
  );
  await expect(
    trimmedAnswer.getByTestId('reasoning-duration-label'),
  ).toHaveText('17 ms');
  await expect
    .poll(() => eventRequests.length)
    .toBeGreaterThan(priorTrimRecoveryCount);
  const trimmedRecoveryRequest = eventRequests
    .filter((entry) => entry.runId === activeRunId)
    .at(-1);
  expect(trimmedRecoveryRequest?.headers['last-event-id']).toBe(retainedCursor);
  expect(trimmedRecoveryRequest?.headers['x-lexon-stream-recovery']).toBe(
    'snapshot',
  );
  await expect.poll(() => trimmedRecoveryRequest?.response?.status()).toBe(200);
  expect(
    trimmedRecoveryRequest?.response?.headers()[
      'x-lexon-stream-recovery-result'
    ],
  ).toBe('snapshot');

  const releaseState = await workerControl('release', activeRunId);
  let completedTree:
    | {
        status?: string;
        text: string;
        reasoningSummary?: string | null;
        reasoningDurationMs?: number | null;
      }
    | undefined;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{
          role: string;
          status?: string;
          text: string;
          reasoningSummary?: string | null;
          reasoningDurationMs?: number | null;
        }>;
      };
      const answer = tree.messages
        .filter((message) => message.role === 'assistant')
        .at(-1);
      completedTree = answer;
      return answer
        ? {
            status: answer.status,
            text: answer.text,
            reasoningSummary: answer.reasoningSummary,
            reasoningDurationMs: answer.reasoningDurationMs,
          }
        : undefined;
    })
    .toEqual({
      status: 'completed',
      text: 'Answer prefix — answer suffix.',
      reasoningSummary: 'Synthetic reasoning summary.',
      reasoningDurationMs: 17,
    });
  try {
    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toHaveAttribute('data-text-content', 'Answer prefix — answer suffix.');
  } catch (failure) {
    const frames = await page.evaluate(
      () =>
        (
          window as Window & {
            __runtimeProofFrames?: Array<Record<string, unknown>>;
          }
        ).__runtimeProofFrames ?? [],
    );
    throw new Error(
      `${failure instanceof Error ? failure.message : 'Suffix render failed'}\nPost-trim recovery diagnostics: ${JSON.stringify(
        {
          runId: activeRunId,
          releaseSignaled: releaseState?.released,
          database: {
            status: completedTree?.status,
            exactExpectedText:
              completedTree?.text === 'Answer prefix — answer suffix.',
          },
          frames: frames.filter(
            (frame) => frame.path === `/api/runs/${activeRunId}/events`,
          ),
        },
      )}`,
      { cause: failure },
    );
  }
  const readReplayTypes = () =>
    page.evaluate((runId) => {
      const proofWindow = window as Window & {
        __runtimeProofFrames?: Array<{ path: string; type?: string }>;
      };
      return (proofWindow.__runtimeProofFrames ?? [])
        .filter((frame) => frame.path.endsWith(`/runs/${runId}/events`))
        .map((frame) => frame.type);
    }, activeRunId);
  await expect.poll(readReplayTypes).toContain('finish');
  const replayTypes = await readReplayTypes();
  expect(replayTypes).toContain('snapshot-start');
  expect(replayTypes).toContain('snapshot-part');
  expect(replayTypes).toContain('snapshot-end');
});

test('stops an active answer, rejects a concurrent turn, and retries a safe provider error', async ({
  page,
}) => {
  const stack = descriptor();
  const authHeaders = await authenticateApi(page.request, {
    name: 'Stop and retry runtime proof identity',
  });
  const chatId = randomUUID();
  const userMessageId = randomUUID();
  const created = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers: { ...authHeaders, 'content-type': 'application/json' },
    data: {
      chatId,
      userMessageId,
      requestId: randomUUID(),
      text: 'stop and retry seed',
      effort: 'high',
    },
  });
  expect(created.status()).toBe(201);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ role: string; status?: string }>;
      };
      return tree.messages
        .filter((message) => message.role === 'assistant')
        .at(-1)?.status;
    })
    .toBe('completed');

  await page.goto(`${stack.publicUrl}/e2e/chat-runtime?chatId=${chatId}`);
  await expect(
    page.getByRole('heading', { name: 'Runtime proof' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('[runtime-proof:hold]');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ role: string; runId?: string }>;
      };
      return tree.messages
        .filter((message) => message.role === 'assistant')
        .at(-1)?.runId;
    })
    .toBeTruthy();
  const beforePrefixResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const beforePrefixTree = (await beforePrefixResponse.json()) as {
    messages: Array<{ id: string; role: string; runId?: string }>;
  };
  const activeAssistant = beforePrefixTree.messages
    .filter((message) => message.role === 'assistant')
    .at(-1);
  if (!activeAssistant?.runId)
    throw new Error('The held run has no server run ID');
  await expect
    .poll(() => workerControl('status', activeAssistant.runId!))
    .toMatchObject({ prefixBlocked: true });
  await workerControl('release-prefix', activeAssistant.runId);
  await expect(page.locator('[data-role="assistant"]').last()).toHaveAttribute(
    'data-text-content',
    'Answer prefix — ',
  );
  const activeTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const activeTree = (await activeTreeResponse.json()) as {
    viewedLeafId: string;
    messages: Array<{
      id: string;
      role: string;
      runId?: string;
      status?: string;
    }>;
  };
  await expect
    .poll(async () => workerControl('status', activeAssistant.runId!))
    .toMatchObject({ blocked: true, released: false });

  const conflicting = await page.request.post(
    `${stack.apiUrl}/api/chats/${chatId}/messages`,
    {
      headers: { ...authHeaders, 'content-type': 'application/json' },
      data: {
        userMessageId: randomUUID(),
        parentMessageId: activeTree.viewedLeafId,
        text: 'conflicting active turn',
        effort: 'high',
      },
    },
  );
  expect(conflicting.status()).toBe(409);
  const conflictBody = (await conflicting.json()) as {
    error?: { code?: string };
  };
  expect(conflictBody.error?.code).toBe('CHAT_CONFLICT');

  const cancelResponsePromise = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return path === `/api/runs/${activeAssistant.runId}/cancel`;
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const cancelResponse = await cancelResponsePromise;
  expect(cancelResponse.ok()).toBe(true);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{ id: string; role: string; status?: string }>;
      };
      return tree.messages.find((message) => message.id === activeAssistant.id)
        ?.status;
    })
    .toBe('cancelled');
  await workerControl('release', activeAssistant.runId);

  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('[runtime-proof:error]');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{
          id: string;
          role: string;
          parentId: string | null;
          status?: string;
          text: string;
        }>;
      };
      const user = tree.messages
        .filter((message) => message.role === 'user')
        .at(-1);
      const answer = user
        ? tree.messages
            .filter(
              (message) =>
                message.role === 'assistant' && message.parentId === user.id,
            )
            .at(-1)
        : undefined;
      return user && answer
        ? {
            promptLength: user.text.length,
            status: answer.status,
            text: answer.text,
          }
        : undefined;
    })
    .toEqual({
      promptLength: '[runtime-proof:error]'.length,
      status: 'failed',
      text: '',
    });
  const failedTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const failedTree = (await failedTreeResponse.json()) as {
    messages: Array<{
      id: string;
      role: string;
      status?: string;
      text: string;
      parentId: string | null;
    }>;
  };
  const failedAnswer = failedTree.messages
    .filter((message) => message.role === 'assistant')
    .at(-1);
  if (!failedAnswer) throw new Error('The provider failure answer is missing');
  expect(failedAnswer.status).toBe('failed');
  await page
    .locator(`[data-message-id="${failedAnswer.id}"]`)
    .getByRole('button', { name: 'Try again' })
    .click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${stack.apiUrl}/api/chats/${chatId}`,
      );
      if (!response.ok()) return undefined;
      const tree = (await response.json()) as {
        messages: Array<{
          role: string;
          parentId: string | null;
          status?: string;
          text: string;
        }>;
      };
      const answer = tree.messages
        .filter((message) => message.role === 'assistant')
        .at(-1);
      return answer ? { status: answer.status, text: answer.text } : undefined;
    })
    .toEqual({ status: 'completed', text: 'Try again succeeded.' });
  const retriedTreeResponse = await page.request.get(
    `${stack.apiUrl}/api/chats/${chatId}`,
  );
  const retriedTree = (await retriedTreeResponse.json()) as {
    messages: Array<{
      id: string;
      role: string;
      parentId: string | null;
      status?: string;
    }>;
  };
  const errorUser = retriedTree.messages
    .filter((message) => message.role === 'user')
    .at(-1);
  const errorAnswers = retriedTree.messages.filter(
    (message) =>
      message.role === 'assistant' && message.parentId === errorUser?.id,
  );
  expect(errorAnswers).toHaveLength(2);
  expect(errorAnswers.map((message) => message.status)).toEqual([
    'failed',
    'completed',
  ]);
});
