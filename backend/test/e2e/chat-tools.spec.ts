import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { containerId, descriptor, docker } from './runtime-support.js';

/**
 * F5 acceptance (task 10): the real pause→decide→resume loop against the live
 * compose stack. The scripted ai-worker answers `[f5-tools:ask]` /
 * `[f5-tools:rename]` marker prompts with a genuine `tool-proposal` +
 * `tool_calls` outcome on the first generation, so every pause, dock, record
 * and resume below travels the production path — only the model is scripted.
 * Expiry is driven through the real `OperationExpirySweep.sweep()` via the
 * worker's control socket after a test-side `expires_at` backdate, so the
 * spec never waits on the 60 s scheduler cadence.
 */

type OperationSnapshot = {
  operationId: string;
  kind: 'approval' | 'question';
  status: string;
  approvalRequired: boolean;
  snapshotHash: string;
  expiresAt: string | null;
  decidedAt: string | null;
  toolName: string;
  input?: Record<string, unknown>;
  display?: Record<string, unknown>;
  output?: unknown;
};

type ChatTree = {
  title: string;
  viewedLeafId: string | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    parentId: string | null;
    runId?: string;
    text: string;
    status?: string;
    operations?: OperationSnapshot[];
  }>;
};

// The scripted gateway counts generations per prompt STRING for the whole
// worker process, so each test needs its own marker prompt or a later test's
// first generation would count past 1 and never propose the tool.
const askPrompt = (tag: string) =>
  `[f5-tools:ask] Apakah kontrak ini masih berlaku? — ${tag}`;
const RENAME_PROMPT = '[f5-tools:rename] Ganti judul percakapan ini';
const QUESTION_TEXT = 'Kontrak jenis apa yang Anda maksud?';
const OPTION_LABEL = 'Perjanjian kerja';
const RENAMED_TITLE = 'Somasi PT Sinar';

async function onboardedIdentity(
  page: Page,
  apiUrl: string,
  email: string,
): Promise<Record<string, string>> {
  const headers = await authenticateApi(page.request, {
    name: 'F5 Tools',
    email,
  });
  const onboarded = await page.request.post(
    `${apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);
  return headers;
}

async function treeOf(
  page: Page,
  apiUrl: string,
  chatId: string,
  headers: Record<string, string>,
): Promise<ChatTree | undefined> {
  const response = await page.request.get(`${apiUrl}/api/chats/${chatId}`, {
    headers,
  });
  if (!response.ok()) return undefined;
  return (await response.json()) as ChatTree;
}

function latestAssistant(tree: ChatTree) {
  return tree.messages.filter((message) => message.role === 'assistant').at(-1);
}

/** Polls the canonical tree until the latest assistant carries an awaiting op. */
async function awaitPausedOperation(
  page: Page,
  apiUrl: string,
  chatId: string,
  headers: Record<string, string>,
): Promise<{ runId: string; operation: OperationSnapshot }> {
  let found: { runId: string; operation: OperationSnapshot } | undefined;
  await expect
    .poll(
      async () => {
        const tree = await treeOf(page, apiUrl, chatId, headers);
        const assistant = tree && latestAssistant(tree);
        const operation = assistant?.operations?.find(
          (entry) => entry.status === 'awaiting_approval',
        );
        found =
          assistant?.runId && operation
            ? { runId: assistant.runId, operation }
            : undefined;
        return found;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  return found!;
}

/** Polls the canonical tree until the latest assistant run reaches a status. */
async function awaitLatestAssistantStatus(
  page: Page,
  apiUrl: string,
  chatId: string,
  headers: Record<string, string>,
  statuses: readonly string[],
): Promise<NonNullable<ReturnType<typeof latestAssistant>>> {
  let message: ReturnType<typeof latestAssistant>;
  await expect
    .poll(
      async () => {
        const tree = await treeOf(page, apiUrl, chatId, headers);
        message = tree && latestAssistant(tree);
        return message && statuses.includes(message.status ?? '')
          ? message
          : undefined;
      },
      { timeout: 60_000 },
    )
    .toBeTruthy();
  return message!;
}

/** Drives the real §7 job handler the BullMQ scheduler runs every 60 s. */
async function workerSweep(runId: string) {
  const worker = await containerId('ai-worker');
  const output = await docker([
    'exec',
    worker,
    'node',
    'backend/test/e2e/chat-worker-control.mjs',
    'sweep',
    runId,
  ]);
  return JSON.parse(output) as { swept?: boolean } | null;
}

async function psqlInTenant(
  orgId: string,
  userId: string,
  sql: string,
): Promise<string> {
  const postgresId = await containerId('postgres');
  return docker([
    'exec',
    postgresId,
    'sh',
    '-c',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql "$@"',
    'psql',
    '-U',
    'postgres',
    '-d',
    'lexon',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `BEGIN; SET LOCAL ROLE lexon_migrator; SELECT set_config('app.org_id','${orgId}',true),set_config('app.user_id','${userId}',true); ${sql} COMMIT;`,
  ]);
}

async function identityIds(
  page: Page,
  apiUrl: string,
): Promise<{ orgId: string; userId: string }> {
  const response = await page.request.get(`${apiUrl}/api/identity`);
  expect(response.status()).toBe(200);
  const identity = (await response.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  return { orgId: identity.organization.id, userId: identity.user.id };
}

/** Sends the marker prompt through the real composer and lands on the chat. */
async function sendFromWorkspace(
  page: Page,
  publicUrl: string,
  text: string,
): Promise<string> {
  await page.goto(`${publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await expect(composer).toBeVisible();
  await composer.fill(text);
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test('a paused ask_user question docks above the composer, answers through the radiogroup, and resumes to a stored record', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await onboardedIdentity(
    page,
    stack.apiUrl,
    `f5-tools-ask-${randomUUID()}@example.test`,
  );
  const decisionPosts: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/runs\/[0-9a-f-]{36}\/operations\/[0-9a-f-]{36}\/decision/.test(
        request.url(),
      )
    )
      decisionPosts.push(request.postData() ?? '');
  });

  const chatId = await sendFromWorkspace(
    page,
    stack.publicUrl,
    askPrompt('ask'),
  );
  const dock = page.locator('[data-slot="operation-dock"]');
  await expect(
    page.getByRole('status', { name: 'Question from Lexon' }),
  ).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(dock.getByText(QUESTION_TEXT)).toBeVisible();
  await expect(
    dock.getByRole('radiogroup', { name: QUESTION_TEXT }),
  ).toBeVisible();
  await expect(
    dock.getByRole('radio', { name: new RegExp(OPTION_LABEL) }),
  ).toBeVisible();
  // §5.3 the thread pill and the composer hint announce the pause.
  await expect(page.getByText('Waiting for you')).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await expect(composer).toHaveAttribute(
    'placeholder',
    'Or reply in your own words…',
  );

  const { operation } = await awaitPausedOperation(
    page,
    stack.apiUrl,
    chatId,
    headers,
  );
  expect(operation.kind).toBe('question');
  expect(operation.toolName).toBe('ask_user');
  expect(operation.approvalRequired).toBe(true);
  expect(operation.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  expect(operation.expiresAt).toBeTruthy();
  expect(operation.input?.questions).toHaveLength(1);

  await dock.getByRole('radio', { name: new RegExp(OPTION_LABEL) }).click();
  // The decision goes through the owner-only §6.3 route exactly once.
  await expect.poll(() => decisionPosts).toHaveLength(1);
  const decisionBody = JSON.parse(decisionPosts[0]!) as {
    snapshotHash?: string;
    action?: string;
    answers?: Array<{ questionId?: string; choice?: { index?: number } }>;
  };
  expect(decisionBody.action).toBe('answer');
  expect(decisionBody.snapshotHash).toBe(operation.snapshotHash);
  expect(decisionBody.answers).toEqual([
    { questionId: 'q1', choice: { kind: 'option', index: 0 } },
  ]);

  // The dock closes and the stored decision becomes the in-thread record.
  await expect(dock).toHaveCount(0);
  const record = page.locator('[data-slot="decision-record"]');
  await expect(record).toHaveCount(1);
  await expect(record).toContainText(QUESTION_TEXT);
  await expect(record).toContainText(OPTION_LABEL);

  const settled = await awaitLatestAssistantStatus(
    page,
    stack.apiUrl,
    chatId,
    headers,
    ['completed'],
  );
  const settledOp = settled.operations?.[0];
  expect(settledOp?.status).toBe('answered');
  expect(settledOp?.output).toMatchObject({
    answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
  });
  expect(settled.text).toContain(
    'Scripted answer: Apakah kontrak ini masih berlaku?',
  );
  await expect(
    page.locator('[data-role="assistant"] .aui-md').last(),
  ).toContainText('Scripted answer:');
});

test('a paused rename_chat approval docks, approves once, applies the rename, and records the outcome', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await onboardedIdentity(
    page,
    stack.apiUrl,
    `f5-tools-rename-${randomUUID()}@example.test`,
  );

  const chatId = await sendFromWorkspace(page, stack.publicUrl, RENAME_PROMPT);
  const dock = page.locator('[data-slot="operation-dock"]');
  await expect(
    page.getByRole('status', { name: 'Approval needed' }),
  ).toBeVisible();
  await expect(
    dock.getByRole('heading', { name: 'Lexon wants to rename this chat' }),
  ).toBeVisible();
  await expect(dock.getByText('New title')).toBeVisible();
  await expect(dock.getByText(RENAMED_TITLE)).toBeVisible();
  const approveButton = dock.getByRole('button', { name: /Approve/ });
  await expect(approveButton).toBeVisible();
  await expect(dock.getByRole('button', { name: /Reject/ })).toBeVisible();

  const { operation } = await awaitPausedOperation(
    page,
    stack.apiUrl,
    chatId,
    headers,
  );
  expect(operation.kind).toBe('approval');
  expect(operation.toolName).toBe('rename_chat');
  expect(operation.input).toMatchObject({ newTitle: RENAMED_TITLE });
  expect(operation.display).toMatchObject({ currentTitle: RENAME_PROMPT });

  await approveButton.click();
  await expect(dock).toHaveCount(0);
  const record = page.locator('[data-slot="decision-record"]');
  await expect(record).toHaveCount(1);
  await expect(record).toContainText('Renamed this chat');

  // The transactional write lands once inside the resume commit.
  await expect
    .poll(
      async () => (await treeOf(page, stack.apiUrl, chatId, headers))?.title,
    )
    .toBe(RENAMED_TITLE);
  const settled = await awaitLatestAssistantStatus(
    page,
    stack.apiUrl,
    chatId,
    headers,
    ['completed'],
  );
  expect(settled.operations?.[0]?.status).toBe('completed');
  expect(settled.operations?.[0]?.output).toMatchObject({ renamed: true });
  expect(settled.text).toContain('Scripted answer: Ganti judul percakapan ini');
});

test('a paused question expires through the real sweep after a backdated expires_at', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await onboardedIdentity(
    page,
    stack.apiUrl,
    `f5-tools-expiry-${randomUUID()}@example.test`,
  );

  const chatId = await sendFromWorkspace(
    page,
    stack.publicUrl,
    askPrompt('expiry'),
  );
  const dock = page.locator('[data-slot="operation-dock"]');
  await expect(dock).toBeVisible();
  const { runId, operation } = await awaitPausedOperation(
    page,
    stack.apiUrl,
    chatId,
    headers,
  );

  const { orgId, userId } = await identityIds(page, stack.apiUrl);
  const backdated = await psqlInTenant(
    orgId,
    userId,
    `UPDATE app.ai_operations SET expires_at = clock_timestamp() - interval '1 minute' WHERE org_id='${orgId}' AND id='${operation.operationId}' AND status='awaiting_approval';`,
  );
  expect(backdated).toContain('UPDATE 1');
  // The test drives the identical handler the 60 s scheduler job runs.
  await workerSweep(runId);

  const settled = await awaitLatestAssistantStatus(
    page,
    stack.apiUrl,
    chatId,
    headers,
    ['completed'],
  );
  const expired = settled.operations?.[0];
  expect(expired?.status).toBe('expired');
  expect(expired?.output).toMatchObject({ unanswered: true });

  await expect(dock).toHaveCount(0);
  const record = page.locator('[data-slot="decision-record"]');
  await expect(record).toHaveCount(1);
  await expect(record).toContainText(QUESTION_TEXT);
  await expect(record).toContainText('Unanswered (expired)');
  expect(settled.text).toContain(
    'Scripted answer: Apakah kontrak ini masih berlaku?',
  );
});

test('sending while the panel is open supersedes the pause and answers the new message', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await onboardedIdentity(
    page,
    stack.apiUrl,
    `f5-tools-supersede-${randomUUID()}@example.test`,
  );

  const chatId = await sendFromWorkspace(
    page,
    stack.publicUrl,
    askPrompt('supersede'),
  );
  const dock = page.locator('[data-slot="operation-dock"]');
  await expect(dock).toBeVisible();
  await awaitPausedOperation(page, stack.apiUrl, chatId, headers);

  const composer = page.getByRole('textbox', { name: 'Message input' });
  const reply = 'Lanjutkan saja tanpa jawaban saya.';
  await composer.fill(reply);
  const sendPosted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new RegExp(`/api/chats/${chatId}/messages`).test(response.url()),
    { timeout: 15_000 },
  );
  await composer.press('Enter');
  const sendResponse = await sendPosted;
  expect(sendResponse.status()).toBe(201);

  // §6.4: the still-waiting question settles dismissed {answered_in_chat:true}
  // and the paused run completes in the same transaction as the new send.
  let lastObserved: unknown;
  try {
    await expect
      .poll(
        async () => {
          const tree = await treeOf(page, stack.apiUrl, chatId, headers);
          const assistants = tree?.messages.filter(
            (message) => message.role === 'assistant',
          );
          const first = assistants?.[0];
          const second = assistants?.[1];
          const op = first?.operations?.[0];
          lastObserved = {
            firstStatus: first?.status,
            firstOperation: op?.status,
            secondStatus: second?.status,
            messageCount: tree?.messages.length,
          };
          return first?.status === 'completed' &&
            op?.status === 'dismissed' &&
            second?.status === 'completed'
            ? { first, second, op }
            : undefined;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
  } catch (error) {
    await test.info().attach('last observed tree', {
      body: JSON.stringify(lastObserved, null, 2),
    });
    throw error;
  }

  await expect(dock).toHaveCount(0);
  const record = page.locator('[data-slot="decision-record"]');
  await expect(record).toHaveCount(1);
  await expect(record).toContainText('Answered in chat');
  const tree = (await treeOf(page, stack.apiUrl, chatId, headers))!;
  const assistants = tree.messages.filter(
    (message) => message.role === 'assistant',
  );
  expect(assistants[0]?.operations?.[0]?.output).toMatchObject({
    answered_in_chat: true,
  });
  expect(
    tree.messages.filter((message) => message.role === 'user').at(-1)?.text,
  ).toBe(reply);
  expect(assistants.at(-1)?.text).toContain(`Scripted answer: ${reply}`);
  await expect(
    page.locator('[data-role="user"]').getByText(reply),
  ).toBeVisible();
});

test('a mid-pause reload restores the docked panel with the same operation', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await onboardedIdentity(
    page,
    stack.apiUrl,
    `f5-tools-reload-${randomUUID()}@example.test`,
  );

  const chatId = await sendFromWorkspace(
    page,
    stack.publicUrl,
    askPrompt('reload'),
  );
  const dock = page.locator('[data-slot="operation-dock"]');
  await expect(dock).toBeVisible();
  const { runId, operation } = await awaitPausedOperation(
    page,
    stack.apiUrl,
    chatId,
    headers,
  );

  await page.reload();
  await expect(
    page.getByRole('status', { name: 'Question from Lexon' }),
  ).toBeVisible();
  await expect(dock.getByText(QUESTION_TEXT)).toBeVisible();
  await expect(
    dock.getByRole('radio', { name: new RegExp(OPTION_LABEL) }),
  ).toBeVisible();
  await expect(page.getByText('Waiting for you')).toBeVisible();
  const stillPaused = await awaitPausedOperation(
    page,
    stack.apiUrl,
    chatId,
    headers,
  );
  expect(stillPaused.operation.operationId).toBe(operation.operationId);
  expect(stillPaused.runId).toBe(runId);
});
