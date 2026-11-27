// F4.1 visual set, F6 Matters group (prototype revision 18): the Matters
// list and page, members/instructions/delete dialogs, organization settings
// Matters, chat sharing, and the shared/matter read-only views — in the
// Kantor Hukum Adil world over deterministic project/share payloads. Real
// auth, org, shell, and chat thread; only the F6 payloads are fixtured.
import { expect, test } from '@playwright/test';
import { ChatDetailSchema } from '@lexon/contracts';
import { captureBrandViews } from './brand-visual-support.js';
import { descriptor } from './runtime-support.js';
import { answerStart, openThread } from './brand-visual-chat-support.js';
import {
  chatId,
  chatTree,
  installChatFixtures,
  installRunStreamFixture,
} from './chat-state-fixtures.js';
import {
  expectResting,
  gotoWorkspace,
  openUserMenu,
} from './brand-visual-world.js';
import {
  adilWorld,
  andi,
  budi,
  citra,
  installAdilMemberCount,
  installChatDetail,
  installMatterFixtures,
  installSharedChatsFixture,
  matterList,
  mergerId,
  rina,
  sewaId,
  sharedChatRows,
  signInAs,
  sinarId,
} from './matter-state-fixtures.js';

const matterName = 'PT Sinar Abadi — wanprestasi';
const stack = () => descriptor();
const mattersUrl = () => `${stack().frontendUrl}/matters`;
const matterUrl = (id: string) => `${mattersUrl()}/${id}`;

function projectChatDetail() {
  return ChatDetailSchema.parse({
    ...chatTree('answer-complete'),
    id: '00000000-0000-4000-8000-000000000213',
    title: 'Bukti surat dan saksi',
    access: 'reader',
    ownerName: budi.name,
    projectId: sinarId,
    projectName: matterName,
  });
}

test('F6 Matters list and page states for the matter owner', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  const world = await adilWorld(page, playwright);
  await signInAs(page, andi);
  await installAdilMemberCount(page);
  const env = { stack: stack(), state: 'matters-list' };
  await installMatterFixtures(page, () => env.state);
  await gotoWorkspace(page, 'Andi');

  const openMatters = async () => {
    const response = await page.goto(mattersUrl());
    expect(response?.status()).toBe(200);
  };

  await captureBrandViews(page, 'matters-list', {
    open: async () => {
      env.state = 'matters-list';
      await openMatters();
      await expect(page.getByText(matterName).first()).toBeVisible();
    },
  });

  await captureBrandViews(page, 'matters-empty', {
    open: async () => {
      env.state = 'matters-empty';
      await openMatters();
      await expect(page.getByText('No matters yet')).toBeVisible();
    },
  });

  await captureBrandViews(page, 'matter-new', {
    open: async () => {
      env.state = 'matters-list';
      await openMatters();
      await page.getByRole('button', { name: 'New matter' }).first().click();
      await expect(
        page.getByRole('dialog', { name: /new matter/i }),
      ).toBeVisible();
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
    keepFocus: true,
  });

  const openMatter = async () => {
    const response = await page.goto(matterUrl(sinarId));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: matterName })).toBeVisible();
  };

  await captureBrandViews(page, 'matter-owner', {
    open: async () => {
      env.state = 'matter-owner';
      await openMatter();
      await expect(
        page.getByRole('button', { name: 'Members', exact: true }),
      ).toBeVisible();
    },
  });

  await captureBrandViews(page, 'matter-instructions-edit', {
    open: async () => {
      env.state = 'matter-owner';
      await openMatter();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.getByRole('textbox').last()).toBeVisible();
    },
    close: async () => {
      await page.keyboard.press('Escape');
    },
    keepFocus: true,
  });

  await captureBrandViews(page, 'matter-members', {
    open: async () => {
      env.state = 'matter-owner';
      await openMatter();
      await page.getByRole('button', { name: 'Members', exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: `Members of ${matterName}` }),
      ).toBeVisible();
      await expect(
        page.getByText('Access restricted by your organization'),
      ).toBeVisible();
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  });

  await captureBrandViews(page, 'matter-delete', {
    open: async () => {
      env.state = 'matter-owner';
      await openMatter();
      await page.getByRole('button', { name: 'Matter actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete matter' }).click();
      await expect(
        page.getByRole('alertdialog', { name: `Delete ${matterName}?` }),
      ).toBeVisible();
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    },
  });

  // Last in the test: the capture switches the active organization to
  // Personal, and the close restores Kantor Hukum Adil for the shell.
  await captureBrandViews(page, 'matter-personal', {
    open: async () => {
      env.state = 'matter-personal';
      const api = stack().apiUrl;
      const list = await page.request.get(api + '/api/organizations');
      const body = (await list.json()) as {
        items: { id: string; kind: string }[];
      };
      const personal = body.items.find((org) => org.kind === 'personal');
      expect(personal).toBeDefined();
      expect(
        (
          await page.request.post(api + '/api/organizations/active', {
            headers: { origin: stack().frontendUrl },
            data: { organizationId: personal!.id },
          })
        ).status(),
      ).toBe(200);
      const response = await page.goto(matterUrl(sewaId));
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole('heading', { name: 'Kontrak sewa ruko Tebet' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Members', exact: true }),
      ).toHaveCount(0);
    },
    close: async () => {
      const api = stack().apiUrl;
      expect(
        (
          await page.request.post(api + '/api/organizations/active', {
            headers: { origin: stack().frontendUrl },
            data: { organizationId: world.orgId },
          })
        ).status(),
      ).toBe(200);
    },
  });
});

test('F6 Matter page for a viewer', async ({ page, playwright }) => {
  test.setTimeout(120_000);
  await adilWorld(page, playwright);
  await signInAs(page, citra);
  await installAdilMemberCount(page);
  const env = { stack: stack(), state: 'matter-viewer' };
  await installMatterFixtures(page, () => env.state, {
    items: () =>
      matterList()
        .filter((row) => row.id === sinarId)
        .map((row) => ({ ...row, myRole: 'viewer' as const })),
  });
  await gotoWorkspace(page, 'Citra');

  await captureBrandViews(page, 'matter-viewer', {
    open: async () => {
      const response = await page.goto(matterUrl(sinarId));
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole('heading', { name: matterName }),
      ).toBeVisible();
      await expect(page.getByText('Viewer')).toBeVisible();
    },
  });
});

test('F6 Matter and shared chats', async ({ page, playwright }) => {
  test.setTimeout(300_000);
  await adilWorld(page, playwright);
  await signInAs(page, andi);
  await installAdilMemberCount(page);
  const env = { stack: stack(), state: 'answer-complete' };
  // Citra and Rina see only the matters they belong to in the sidebar.
  const navItems = () =>
    env.state === 'citra'
      ? matterList()
          .filter((row) => row.id === sinarId)
          .map((row) => ({ ...row, myRole: 'viewer' as const }))
      : env.state === 'rina'
        ? matterList().filter((row) => row.id === mergerId)
        : matterList();
  await installMatterFixtures(page, () => env.state, { items: navItems });
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  await gotoWorkspace(page, 'Andi');
  const frontend = stack().frontendUrl;

  // chat-share: the Share dialog on a standalone team chat. Captured before
  // the project-bound detail below, since project chats hide Share.
  await captureBrandViews(page, 'chat-share', {
    open: async () => {
      env.state = 'answer-complete';
      await openThread(
        page,
        env,
        'answer-complete',
        page.getByText(answerStart),
      );
      await page
        .getByRole('button', { name: 'Chat actions', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Share' }).click();
      await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible();
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
    keepFocus: true,
  });

  // matter-chat: the owner's own chat inside the matter — the detail is
  // project-bound so the r18 header chip "PT Sinar Abadi › title" renders.
  await installChatDetail(
    page,
    ChatDetailSchema.parse({
      ...chatTree('answer-complete'),
      id: chatId,
      title: 'Syarat sah perjanjian (Pasal 1320)',
      access: 'owner',
      projectId: sinarId,
      projectName: matterName,
    }),
  );
  // Re-register the matter fixtures after the chat fixtures so the own-scope
  // /api/chats list resolves to the matter chats for the Recent sidebar.
  await installMatterFixtures(page, () => env.state, { items: navItems });
  await captureBrandViews(page, 'matter-chat', {
    open: async () => {
      env.state = 'answer-complete';
      await openThread(
        page,
        env,
        'answer-complete',
        page.getByText(answerStart),
      );
      await expect(page.getByText(matterName).first()).toBeVisible();
    },
  });

  // matter-chat-readonly: Citra (matter viewer) opens Budi's chat.
  env.state = 'citra';
  await signInAs(page, citra);
  await installChatDetail(page, projectChatDetail());
  await captureBrandViews(page, 'matter-chat-readonly', {
    open: async () => {
      env.state = 'citra';
      const response = await page.goto(
        `${frontend}/chats/${projectChatDetail().id}`,
      );
      expect(response?.status()).toBe(200);
      await expect(
        page.getByText(`${budi.name}’s chat · read-only`),
      ).toBeVisible();
    },
  });

  // Rina's shared-chat states: a shared standalone chat and the shared list.
  env.state = 'rina';
  await signInAs(page, rina);
  const sharedChat = ChatDetailSchema.parse({
    ...chatTree('answer-complete'),
    id: sharedChatRows()[0]!.id,
    title: sharedChatRows()[0]!.title,
    access: 'reader',
    ownerName: andi.name,
  });
  await installChatDetail(page, sharedChat);
  await installSharedChatsFixture(page);

  await captureBrandViews(page, 'chat-shared-readonly', {
    open: async () => {
      env.state = 'rina';
      const response = await page.goto(`${frontend}/chats/${sharedChat.id}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByText(`Shared by ${andi.name} · read-only`),
      ).toBeVisible();
    },
  });

  await captureBrandViews(page, 'chats-shared', {
    open: async () => {
      env.state = 'rina';
      const response = await page.goto(`${frontend}/chats`);
      expect(response?.status()).toBe(200);
      await page.getByRole('tab', { name: 'Shared with me' }).click();
      await expect(
        page.getByText(`Shared by ${andi.name}`).first(),
      ).toBeVisible();
    },
  });
});

test('F6 organization settings Matters for the admin', async ({
  page,
  playwright,
}) => {
  test.setTimeout(200_000);
  await adilWorld(page, playwright);
  await installAdilMemberCount(page);
  const env = { stack: stack(), state: 'answer-complete' };
  await installMatterFixtures(page, () => env.state);
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  await gotoWorkspace(page, 'Dewi');

  const openMattersSettings = async (viewport: 'desktop' | 'mobile') => {
    env.state = 'answer-complete';
    await openThread(page, env, 'answer-complete', page.getByText(answerStart));
    await openUserMenu(page, viewport);
    await page.getByRole('menuitem', { name: /^Settings/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    if (viewport === 'mobile')
      await dialog.getByRole('button', { name: 'Back to sections' }).click();
    await dialog
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Matters', exact: true })
      .click();
    await expect(page).toHaveURL(/settings=matters$/);
    await expect(page.getByText(matterName).first()).toBeVisible();
  };

  await captureBrandViews(page, 'settings-matters', {
    open: openMattersSettings,
    close: async (viewport) => {
      await page
        .getByRole('dialog', { name: 'Settings' })
        .getByRole('button', { name: 'Close settings' })
        .click();
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
      await expectResting(page, viewport);
    },
  });

  await captureBrandViews(page, 'settings-matters-restrict', {
    open: async (viewport) => {
      await openMattersSettings(viewport);
      const row = page.getByRole('row').filter({ hasText: matterName });
      await row.getByRole('button', { name: 'Restrict access' }).click();
      await expect(
        page.getByRole('dialog', {
          name: `Restrict access to ${matterName}`,
        }),
      ).toBeVisible();
    },
    close: async (viewport) => {
      await page.keyboard.press('Escape');
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await settings.getByRole('button', { name: 'Close settings' }).click();
      await expect(settings).toBeHidden();
      await expectResting(page, viewport);
    },
    keepFocus: true,
  });
});
