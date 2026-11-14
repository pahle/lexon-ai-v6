import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('chat workspace, history, and thread pass full-page accessibility in every supported viewport and theme', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Ayu Wardani',
    email: `chat-accessibility-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);

  const chatId = randomUUID();
  const question =
    'Bagaimana kewajiban para pihak dalam perjanjian kerja sama?';
  const created = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers,
    data: {
      chatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: question,
      effort: 'high',
    },
  });
  expect(created.status()).toBe(201);
  let persistedAnswer = '';
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${stack.apiUrl}/api/chats/${chatId}`,
          { headers },
        );
        if (response.status() !== 200) return false;
        const tree = (await response.json()) as {
          messages?: Array<{
            role: string;
            status?: string;
            text?: string;
          }>;
        };
        const assistant = tree.messages?.find(
          (message) => message.role === 'assistant',
        );
        if (
          assistant?.status !== 'completed' ||
          typeof assistant.text !== 'string' ||
          !assistant.text.trim()
        )
          return false;
        persistedAnswer = assistant.text;
        return true;
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  const routes = [
    {
      path: '/workspace',
      ready: async () => {
        await expect(
          page.getByRole('heading', { name: /^Welcome, / }),
        ).toBeVisible();
        await expect(
          page.getByRole('textbox', { name: 'Message input' }),
        ).toBeVisible();
      },
    },
    {
      path: '/chats',
      ready: async () => {
        await expect(
          page.getByRole('heading', { name: 'Chats', exact: true }),
        ).toBeVisible();
        await expect(
          page
            .locator(`a[href="/chats/${chatId}"]`)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      },
    },
    {
      path: `/chats/${chatId}`,
      ready: async () => {
        await expect(
          page
            .locator('[data-role="user"]')
            .getByText(question, { exact: true }),
        ).toBeVisible();
        await expect(
          page.locator('[data-role="assistant"] .aui-md').last(),
        ).toContainText(persistedAnswer);
      },
    },
  ];
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  await page.goto(`${stack.publicUrl}/workspace`);
  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (const route of routes) {
        await page.evaluate(
          (theme) => localStorage.setItem('theme', theme),
          colorScheme,
        );
        await page.goto(`${stack.publicUrl}${route.path}`);
        await expect(page).toHaveURL(`${stack.publicUrl}${route.path}`);
        await route.ready();
        await expect(page.locator('html')).toHaveClass(
          colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
        );
        const hasHorizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(
          hasHorizontalOverflow,
          `${viewport.name} ${colorScheme} ${route.path} horizontal overflow`,
        ).toBe(false);
        const violations = (
          await new AxeBuilder({ page }).withTags(axeTags).analyze()
        ).violations;
        expect(
          violations,
          `${viewport.name} ${colorScheme} ${route.path}`,
        ).toEqual([]);
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.goto(`${stack.publicUrl}/workspace`);
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await skipLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const opener = page.getByRole('button', { name: 'Open navigation' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const sidebar = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Tab');
  expect(
    await sidebar.evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(opener).toBeFocused();
});
