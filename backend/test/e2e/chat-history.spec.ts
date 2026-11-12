import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

test('Chats history supports submit search, inline rename, permanent delete and in-shell not-found', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Ayu Wardani',
    email: `ayu-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    {
      headers,
      data: {},
    },
  );
  expect(onboarded.status()).toBe(204);

  const chatId = randomUUID();
  const created = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers,
    data: {
      chatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Bagaimana upaya hukum atas wanprestasi dalam perjanjian jual beli?',
      effort: 'high',
    },
  });
  expect(created.status()).toBe(201);
  const secondChatId = randomUUID();
  const secondCreated = await page.request.post(`${stack.apiUrl}/api/chats`, {
    headers,
    data: {
      chatId: secondChatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'Bagaimana upaya hukum atas wanprestasi dalam perjanjian jual beli? Second matter.',
      effort: 'high',
    },
  });
  expect(secondCreated.status()).toBe(201);

  const searchRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/chats/search')
      searchRequests.push(request.method());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${stack.publicUrl}/chats`);
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
  await expect(breadcrumb).toHaveText('Chats');
  const pageHeading = page.getByRole('heading', { name: 'Chats' });
  expect(await pageHeading.locator('..').getAttribute('class')).not.toContain(
    'border-b',
  );
  const primaryNavigation = page.getByRole('navigation', {
    name: 'Primary navigation',
  });
  await expect(
    primaryNavigation.getByRole('link', { name: 'New chat', exact: true }),
  ).toBeVisible();
  await expect(
    primaryNavigation.getByRole('link', { name: 'Chats', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Recent', { exact: true })).toBeVisible();
  const recent = page.getByRole('group', { name: 'Recent chats' });
  const recentLink = recent
    .getByRole('link', {
      name: /Bagaimana upaya hukum/,
    })
    .first();
  await expect(recentLink).toBeVisible();
  const recentRow = recentLink.locator('xpath=..');
  const recentAction = recentRow.locator('button');
  await expect(recentAction).toBeVisible();
  const [recentLinkBox, recentActionBox] = await Promise.all([
    recentLink.boundingBox(),
    recentAction.boundingBox(),
  ]);
  expect(recentLinkBox).not.toBeNull();
  expect(recentActionBox).not.toBeNull();
  expect(
    Math.abs(
      recentLinkBox!.y +
        recentLinkBox!.height / 2 -
        (recentActionBox!.y + recentActionBox!.height / 2),
    ),
  ).toBeLessThan(8);
  await expect(
    page.getByRole('link', { name: 'View all chats', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'New chat', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Today', { exact: true })).toBeVisible();
  const history = page.getByRole('region', { name: 'Today' });
  await expect(
    history.getByRole('link', { name: /Bagaimana upaya hukum/ }).first(),
  ).toBeVisible();
  await mkdir('test-results/f4-chat', { recursive: true });
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chats-history-light.png',
    fullPage: true,
  });
  const historyAxe = await new AxeBuilder({ page }).include('main').analyze();
  expect(historyAxe.violations.map((violation) => violation.id)).toEqual([]);

  await recentAction.focus();
  await page.keyboard.press('Enter');
  const renameMenuItem = page.getByRole('menuitem', { name: 'Rename' });
  const deleteMenuItem = page.getByRole('menuitem', { name: 'Delete' });
  await expect(renameMenuItem).toBeVisible();
  await expect(deleteMenuItem).toBeVisible();
  await expect(deleteMenuItem).toHaveAttribute('data-variant', 'destructive');
  await expect(deleteMenuItem.locator('svg')).toBeVisible();
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chat-actions-menu.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await recentAction.click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await expect(page.getByRole('textbox', { name: 'Chat title' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chat-rename-inline.png',
    fullPage: true,
  });
  await page.getByRole('textbox', { name: 'Chat title' }).press('Escape');

  const search = page.getByRole('textbox', { name: 'Search chats' });
  await search.fill('wanprestasi');
  await search.press('Control+Alt+n');
  await expect(page).toHaveURL(`${stack.publicUrl}/chats`);
  await expect(search).toHaveValue('wanprestasi');
  expect(searchRequests).toEqual([]);
  await search.press('Enter');
  await expect(page.getByText('2 chats', { exact: true })).toBeVisible();
  await expect(page.getByText(/wanprestasi/i).last()).toBeVisible();
  expect(searchRequests).toEqual(['POST']);
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chats-search-light.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chats-search-dark.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'light' });

  const latestRecentLink = recent
    .getByRole('link', {
      name: /Bagaimana upaya hukum/,
    })
    .first();
  const latestRecentRow = latestRecentLink.locator('xpath=..');
  const latestRecentAction = latestRecentRow.locator('button');
  const latestHref = await latestRecentLink.getAttribute('href');
  expect(latestHref).not.toBeNull();
  const searchedChatId = new URL(latestHref!, stack.publicUrl).pathname
    .split('/')
    .at(-1)!;
  await latestRecentAction.click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const sidebarTitle = page.getByRole('textbox', { name: 'Chat title' });
  await sidebarTitle.fill('Employment agreement review');
  await sidebarTitle.press('Enter');
  await expect(
    page
      .getByRole('main')
      .getByText('Employment agreement review', { exact: true }),
  ).toBeVisible();
  const renamedSearchChat = await page.request.get(
    `${stack.apiUrl}/api/chats/${searchedChatId}`,
    { headers },
  );
  expect((await renamedSearchChat.json()).title).toBe(
    'Employment agreement review',
  );

  const renamedRecentLink = recent.getByRole('link', {
    name: 'Employment agreement review',
    exact: true,
  });
  const renamedHref = await renamedRecentLink.getAttribute('href');
  expect(renamedHref).not.toBeNull();
  const renamedChatId = new URL(renamedHref!, stack.publicUrl).pathname
    .split('/')
    .at(-1)!;
  await renamedRecentLink.locator('xpath=..').locator('button').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(
    page.getByRole('heading', { name: 'Delete this chat?' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete chat' })).toBeVisible();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.locator('[data-slot="alert-dialog-content"]')).toHaveCSS(
    'opacity',
    '1',
  );
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-delete-confirm-search.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Delete chat' }).click();
  await expect(page.getByText('1 chat', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('main')
      .getByText('Employment agreement review', { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.get(`${stack.apiUrl}/api/chats/${renamedChatId}`, {
        headers,
      })
    ).status(),
  ).toBe(404);

  await search.fill('praperadilan');
  await search.press('Enter');
  await expect(page.getByText('No chats match “praperadilan”')).toBeVisible();
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chats-no-results-light.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(
    history.getByRole('link', { name: /Bagaimana upaya hukum/ }).first(),
  ).toBeVisible();
  await page.locator('body').click({ position: { x: 800, y: 800 } });
  await page.keyboard.press('Control+Alt+n');
  await expect(page).toHaveURL(`${stack.publicUrl}/workspace`);
  await page.goto(`${stack.publicUrl}/chats`);

  await page.goto(`${stack.publicUrl}/chats/${chatId}`);
  await expect(breadcrumb).toHaveText(/Chats/);
  await expect(
    page.getByRole('button', { name: 'Stop generating' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /^Chat actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(
    page.getByRole('heading', { name: 'Delete this chat?' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete chat' })).toBeVisible();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.locator('[data-slot="alert-dialog-content"]')).toHaveCSS(
    'opacity',
    '1',
  );
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-delete-confirm-current-chat.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Delete chat' }).click();
  await expect(page).toHaveURL(`${stack.publicUrl}/workspace`);
  expect(
    (
      await page.request.get(`${stack.apiUrl}/api/chats/${chatId}`, { headers })
    ).status(),
  ).toBe(404);
  await page.goto(`${stack.publicUrl}/chats/${chatId}/unmatched`);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await page.goto(`${stack.publicUrl}/chats`);
  await expect(page.getByText('No chats yet')).toBeVisible();
  await expect(page.locator('[data-slot="empty"]')).toHaveCSS(
    'height',
    '320px',
  );
  await page.screenshot({
    path: 'test-results/f4-chat/task-15-chats-empty.png',
    fullPage: true,
  });
  for (const width of [390, 767, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow, `overflow at ${width}px`).toBe(false);
    if (width === 390) {
      await page.screenshot({
        path: 'test-results/f4-chat/task-15-chats-empty-mobile.png',
        fullPage: true,
      });
    }
  }
});
