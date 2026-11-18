import { expect, test, type Locator, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { installChatFixtures, fileNames } from './chat-state-fixtures.js';
import {
  brandFixedTime,
  captureBrandViews,
  type BrandViewport,
} from './brand-visual-support.js';
import {
  chatListRequest,
  expectResting,
  gateRequests,
  gotoWorkspace,
  installPrototypeInvitationExpiry,
  openUserMenu,
  prepareIdentity,
  teamWorld,
} from './brand-visual-world.js';
import { calm, startChatStates } from './brand-visual-chat-support.js';
import { ayu, team, teamInvitations } from './prototype-fixtures.js';
import {
  installTask9MemberOrderNormalization,
  installTask9SessionExpiryNormalization,
} from './visual-support.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';

// F4.1 visual set, chats and settings group: the Chats list, search, the
// Settings dialog sections, and the saved-profile toast.

/** Recent lists the six prototype chats; the chat API itself is mocked. */
const recentChats = (page: Page) =>
  installChatFixtures(
    page,
    () => 'new-chat',
    () => undefined,
  );

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('chats empty and loading lists', async ({ page }) => {
  const stack = descriptor();
  await prepareIdentity(page, { name: ayu.name }, ayu.jobTitle);
  await page.clock.setFixedTime(brandFixedTime);

  await page.goto(stack.frontendUrl + '/chats');
  await expect(page.getByText('No chats yet', { exact: true })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await captureBrandViews(page, 'chats-empty');

  // The list request is held by a gated route, so the loading state stays
  // open for as long as the captures need and never depends on a timer.
  const list = await gateRequests(page, chatListRequest);
  try {
    await page.goto(stack.frontendUrl + '/chats');
    await list.started;
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading chats…' }),
    ).toBeVisible();
    await captureBrandViews(page, 'chats-loading');
  } finally {
    await list.finish();
  }
});

test('Settings sections for the team owner', async ({ page, playwright }) => {
  test.setTimeout(230_000);
  const { teamId } = await teamWorld(page, playwright);
  await recentChats(page);
  await gotoWorkspace(page, ayu.firstName);

  const settingsHooks = (link: string, ready: (page: Page) => Locator) => ({
    open: async (viewport: BrandViewport) => {
      await openUserMenu(page, viewport);
      await page.getByRole('menuitem', { name: /^Settings/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: link, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`settings=${link.toLowerCase()}$`),
      );
      await expect(ready(page)).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'Loading sessions' }),
      ).toHaveCount(0);
      // Settle the dialog's animations and control transitions, then wait
      // until the layout of every control has been still for 12 frames.
      await dialog.evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        );
        const frame = () =>
          new Promise<void>((done) => requestAnimationFrame(() => done()));
        const layout = () =>
          [element, ...element.querySelectorAll('button, [role="radio"]')]
            .map((node) => {
              const r = node.getBoundingClientRect();
              return `${r.x},${r.y},${r.width},${r.height}`;
            })
            .join('|');
        let still = 0;
        let last = layout();
        for (let tries = 0; still < 12 && tries < 300; tries++) {
          await frame();
          const next = layout();
          still = next === last ? still + 1 : 0;
          last = next;
        }
      });
    },
    close: async (viewport: BrandViewport) => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
      await expect(page).toHaveURL(/\/workspace$/);
      await expectResting(page, viewport);
    },
  });

  await captureBrandViews(
    page,
    'settings-profile',
    settingsHooks('Profile', (p) => p.getByLabel('Job title')),
  );
  await captureBrandViews(
    page,
    'settings-appearance',
    settingsHooks('Appearance', (p) => p.getByRole('radio', { name: 'Dark' })),
  );
  const sessions = await installTask9SessionExpiryNormalization(page);
  try {
    await captureBrandViews(
      page,
      'settings-security',
      settingsHooks('Security', (p) =>
        p.getByRole('table', { name: 'Signed-in sessions' }),
      ),
    );
  } finally {
    await sessions.remove();
  }
  const members = await installTask9MemberOrderNormalization(page, teamId, [
    team.members[0].email,
    team.members[1].email,
    team.members[2].email,
  ]);
  try {
    await captureBrandViews(
      page,
      'settings-members',
      settingsHooks('Members', (p) =>
        p.getByText(team.members[2].email, { exact: true }),
      ),
    );
  } finally {
    await members.remove();
  }
  const invitations = await installPrototypeInvitationExpiry(page, teamId);
  try {
    await captureBrandViews(
      page,
      'settings-invitations',
      settingsHooks('Invitations', (p) =>
        p.getByText(teamInvitations[0].email, { exact: true }),
      ),
    );
  } finally {
    await invitations.remove();
  }
  await captureBrandViews(
    page,
    'settings-general',
    settingsHooks('General', (p) =>
      p.getByRole('heading', { name: 'General', exact: true }),
    ),
  );
});

test('toast after a saved profile', async ({ page, playwright }) => {
  const stack = descriptor();
  await teamWorld(page, playwright);
  await recentChats(page);
  // The clock is paused (not raced) so the toast cannot time out: nothing
  // advances it except the small runFor steps below.
  await page.clock.install({ time: new Date(brandFixedTime) });
  await page.goto(stack.frontendUrl + '/workspace?settings=profile');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Job title')).toHaveValue('Senior Associate');
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const save = await gateRequests(
    page,
    (url, method) =>
      url.pathname === '/api/identity/profile' &&
      (method === 'PATCH' || method === ''),
  );
  try {
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await save.started;
    // Pause 100 ms ahead of the page's own clock: the held save request is
    // in flight, and a larger jump would fire the client's request timeout.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 100));
    save.release();
    const toast = page.locator('[data-sonner-toast]');
    await expect
      .poll(async () => {
        await page.clock.runFor(50);
        return toast.count();
      })
      .toBe(1);
    await expect(toast).toContainText('Changes saved.');
    // axe finishes its rules through zero-delay timers, so the paused clock
    // is stepped one millisecond at a time while the captures run. The fake
    // time that passes is the step count, bounded far below the 4 s toast
    // lifetime, so no real-time race is involved.
    let stepping = true;
    let steps = 0;
    const stepper = (async () => {
      while (stepping) {
        await page.clock.runFor(1);
        steps++;
        await new Promise((done) => setTimeout(done, 5));
      }
    })();
    try {
      await captureBrandViews(page, 'toast-success');
    } finally {
      stepping = false;
      await stepper;
    }
    expect(
      steps,
      'fake milliseconds advanced during the captures',
    ).toBeLessThan(3000);
    await expect(toast).toContainText('Changes saved.');
  } finally {
    await save.finish();
  }
});

test('Chats history, search with highlights, and no results', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page);
  const openChats = async (state: string) => {
    env.state = state;
    await page.clock.setFixedTime(brandFixedTime);
    await page.goto(`${env.stack.frontendUrl}/chats`);
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
  };
  const search = async (query: string) => {
    const box = page.getByRole('textbox', { name: 'Search chats' });
    await box.fill(query);
    await box.press('Enter');
  };

  await captureBrandViews(page, 'chats-history', {
    open: async () => {
      await openChats('chats-history');
      for (const title of [fileNames.newChat, fileNames.data])
        await expect(
          page.locator('#main').getByText(title, { exact: true }).first(),
        ).toBeVisible();
    },
  });

  await captureBrandViews(page, 'chats-search', {
    keepFocus: true,
    open: async () => {
      await openChats('chats-search');
      await search('wanprestasi');
      await expect(page.getByText('3 chats', { exact: true })).toBeVisible();
      await expect(page.locator('#main mark').first()).toBeVisible();
      await calm(page);
    },
  });

  await captureBrandViews(page, 'chats-no-results', {
    open: async () => {
      await openChats('chats-no-results');
      await search('hak tanggungan');
      await expect(
        page.getByText('No chats match “hak tanggungan”', { exact: true }),
      ).toBeVisible();
      await calm(page);
    },
  });
});

// Indicator frames. The thinking indicator is driven by the page clock, so
// these captures alone run with motion allowed. The seed is made deterministic
// without a product hook: an init script makes the one-word request the
// indicator uses for its default seed return a fixed value, and the clock is
// installed, paused before the run starts, and advanced with runFor().

// The capture times and the seed live in one fixture (read by path from the
// frontend test fixtures; the boundary lint forbids a frontend test from
// importing docs/) that a frontend unit
// test (frontend/test/indicator-capture-times.spec.tsx) checks against the
// real createTimeline(createSeededRandom(seed)), because the backend does not
// import the frontend (LEXON-02 section 3.4). indicator-mark is the start of
