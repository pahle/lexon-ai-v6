import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ChatTreeSchema, type ChatMessage } from '@lexon/contracts';
import {
  activeRunFrames,
  answer,
  assistantMessage,
  assistantMessageId,
  chatId,
  deepThinkingQuestion,
  expectSolidDestructiveButton,
  fileNames,
  reasoning,
  runId,
  timestamp,
  userMessage,
  userMessageId,
} from './chat-state-fixtures.js';
import {
  brandViewId,
  isBrandViewPixelLocked,
  isBrandViewSvgSnapshotted,
  snapshotIndicatorSvg,
  assertSvgSnapshotsMatched,
  runBrandAxe,
  captureBrandViews,
  brandFixedTime,
  type BrandViewport,
} from './brand-visual-support.js';
import {
  closeMenu,
  expectResting,
  gotoWorkspace,
  openMobileSheet,
} from './brand-visual-world.js';
import {
  answerStart,
  calm,
  messageOf,
  openThread,
  reasoningToggle,
  settleAnimations,
  hoverWhenParked,
  startChatStates,
} from './brand-visual-chat-support.js';
import { openMenuReliably } from './visual-support.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';

// F4.1 visual set, chat group: the chat thread states and the thinking
// indicator frames.

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('new chat, Deep thinking, and a starter prompt', async ({
  page,
  playwright,
}) => {
  await startChatStates(page, playwright);
  const openNewChat = async (viewport: BrandViewport) => {
    await gotoWorkspace(page, 'Ayu');
    await expectResting(page, viewport);
    if (viewport === 'desktop')
      await expect(
        page
          .getByRole('group', { name: 'Recent chats' })
          .getByRole('link', { name: fileNames.default, exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Starter prompts' }),
    ).toBeVisible();
  };
  await captureBrandViews(page, 'chat-new', { open: openNewChat });

  let undoHover: (() => void) | undefined;
  await captureBrandViews(page, 'chat-deep-thinking', {
    open: async (viewport) => {
      await openNewChat(viewport);
      await page
        .getByRole('textbox', { name: 'Message input' })
        .fill(deepThinkingQuestion);
      const toggle = page.getByRole('button', { name: 'Deep thinking' });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await calm(page);
      // The prototype shows the tooltip under the pressed pill.
      // Touch emulation opens no hover tooltip, so only desktop shows it.
      if (viewport === 'desktop')
        undoHover = hoverWhenParked(page, () => toggle);
    },
    close: async () => undoHover?.(),
  });

  const template =
    'Explain Article [number] of [law or regulation] in plain language.';
  await captureBrandViews(page, 'chat-starter-pill', {
    open: async (viewport) => {
      await openNewChat(viewport);
      await page
        .getByRole('group', { name: 'Starter prompts' })
        .getByRole('button', { name: 'Explain an article', exact: true })
        .click();
      const input = page.getByRole('textbox', { name: 'Message input' });
      await expect(input).toHaveValue(template);
      await expect(input).toBeFocused();
      await calm(page);
    },
  });
});

test('completed answers, editing, branches, stopped, and failed runs', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page, playwright);
  const answerShown = page.getByText(answerStart);
  const thought = 'Thought for 14 seconds';
  const openAnswer = async () => {
    await openThread(page, env, 'answer-complete', answerShown);
    await expect(reasoningToggle(page, thought)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // A thread that fits the viewport rests at its start, where the message
    // sits under the content padding (24px, mobile 16px); a longer one scrolls so the message
    // is flush with the viewport top.
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const viewport = document.querySelector(
            '[data-slot="aui_thread-viewport"]',
          );
          const message = document.querySelector(`[data-message-id="${id}"]`);
          if (!viewport || !message) return null;
          const offset = Math.round(
            message.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top,
          );
          // Thread padding-top: 24px (mobile 16px), LEX-DS-001 v3.1 §5.5.
          const rest = window.innerWidth < 768 ? 16 : 24;
          return Math.abs(offset - rest);
        }, userMessageId),
      )
      .toBeLessThanOrEqual(1);
  };

  await captureBrandViews(page, 'chat-reasoning-collapsed', {
    open: openAnswer,
  });

  await captureBrandViews(page, 'chat-reasoning-open', {
    open: async () => {
      await openAnswer();
      await reasoningToggle(page, thought).click();
      await expect(reasoningToggle(page, thought)).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(page.getByText(reasoning)).toBeVisible();
      await settleAnimations(page);
    },
  });

  // The action row of the last answer is always visible, so no focus is
  // needed to reveal it; the capture parks focus away from Copy.
  let undoActionsHover: (() => void) | undefined;
  await captureBrandViews(page, 'chat-answer-actions', {
    open: async (viewport) => {
      await openAnswer();
      const copy = page.getByRole('button', { name: 'Copy answer' });
      await expect(copy).toBeVisible();
      await expect(page.locator('[data-slot="aui_message-actions"]')).toHaveCSS(
        'opacity',
        '1',
      );
      // The desktop prototype shows the Copy tooltip on the hovered button.
      if (viewport === 'desktop')
        undoActionsHover = hoverWhenParked(page, () => copy);
    },
    close: async () => undoActionsHover?.(),
  });

  await captureBrandViews(page, 'chat-edit', {
    keepFocus: true,
    open: async () => {
      await openAnswer();
      const message = messageOf(page, userMessageId);
      await message.getByRole('button', { name: 'Edit message' }).click();
      await expect(
        page.getByRole('textbox', { name: 'Edit message input' }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Edit message input' }),
      ).toBeFocused();
    },
  });

  const editedLeaf = '00000000-0000-4000-8000-000000000105';
  // The branch picker shows whenever a message has several branches, so the
  // state needs no focus and the capture parks it.
  await captureBrandViews(page, 'chat-branch', {
    open: async () => {
      await openThread(
        page,
        env,
        'edited-branch',
        page.getByText('2 / 2', { exact: true }).first(),
      );
      await expect(
        messageOf(page, editedLeaf).getByRole('button', {
          name: 'Previous branch',
        }),
      ).toBeVisible();
    },
  });

  await captureBrandViews(page, 'chat-stopped', {
    open: async () => {
      await openThread(
        page,
        env,
        'stopped',
        page.getByText('You stopped this response.', { exact: true }),
      );
    },
  });

  await captureBrandViews(page, 'chat-error', {
    open: async () => {
      await openThread(
        page,
        env,
        'run-error',
        page.locator('#main').getByRole('alert'),
      );
      await expect(page.locator('#main').getByRole('alert')).toContainText(
        'The response could not be completed.',
      );
    },
  });
});

test('chat menus, rename, delete, and the Recent menu', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page, playwright);
  const answerShown = page.getByText(answerStart);
  const pill = page.getByRole('button', { name: 'Chat actions', exact: true });
  const renameItem = page.getByRole('menuitem', { name: 'Rename' });
  const openPillMenu = async () => {
    await openThread(page, env, 'answer-complete', answerShown);
    await expect(pill).toBeEnabled();
    await openMenuReliably(page, pill, renameItem, 'floating chat menu');
  };
  const closePillMenu = async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  };

  await captureBrandViews(page, 'chat-floating-menu', {
    keepFocus: true,
    open: async () => {
      await openPillMenu();
      await expect(
        page.getByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
    },
    close: closePillMenu,
  });

  await captureBrandViews(page, 'chat-rename', {
    keepFocus: true,
    open: async () => {
      await openPillMenu();
      await renameItem.click();
      const dialog = page.getByRole('dialog', { name: 'Rename chat' });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('textbox', { name: 'Chat title' }),
      ).toBeFocused();
      await settleAnimations(page);
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'Rename chat' }),
      ).toBeHidden();
    },
  });

  await captureBrandViews(page, 'chat-delete', {
    keepFocus: true,
    open: async () => {
      await openPillMenu();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expectSolidDestructiveButton(
        dialog.getByRole('button', { name: 'Delete chat', exact: true }),
      );
      await settleAnimations(page);
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toBeHidden();
    },
  });

  const recentTrigger = page.getByRole('button', {
    name: `Chat actions for ${fileNames.acquisition}`,
  });
  await captureBrandViews(page, 'recent-menu', {
    keepFocus: true,
    open: async (viewport) => {
      await openThread(page, env, 'answer-complete', answerShown);
      if (viewport === 'mobile') await openMobileSheet(page);
      await openMenuReliably(
        page,
        recentTrigger,
        renameItem,
        'Recent chat menu',
      );
      await expect(
        page.getByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
    },
    close: async (viewport) => {
      await closeMenu(page, viewport);
    },
  });
});
/**
 * Holds the page clock still for states whose indicator expires on a timer
 * (the copied check, the feedback toast). The clock is installed once, resumed
 * for each load, and paused 100 ms after the click; the one-millisecond steps
 * that let axe finish are counted and bounded far below the timer.
 */
function frozenClock(page: Page) {
  let stepping = false;
  let steps = 0;
  let loop: Promise<void> | undefined;
  return {
    install: () => page.clock.install({ time: new Date(brandFixedTime) }),
    resume: () => page.clock.resume(),
    async hold() {
      // Pause just after the current fake instant. A far-future pause would
      // run the copied and toast timers to completion before the capture.
      const now = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(new Date(now + 100));
      stepping = true;
      steps = 0;
      loop = (async () => {
        while (stepping) {
          await page.clock.runFor(1);
          steps++;
          await new Promise((done) => setTimeout(done, 5));
        }
      })();
    },
    async release() {
      stepping = false;
      await loop;
      expect(
        steps,
        'fake milliseconds advanced during the capture',
      ).toBeLessThan(2000);
    },
  };
}

// A click on an action below the fold scrolls the thread (Playwright brings
// the target into view). The states show the thread as it opened, so the
// scroll position is saved before the click and put back after it.
const threadScroll = (page: Page) => ({
  save: () =>
    page.evaluate(
      () =>
        document.querySelector('[data-slot="aui_thread-viewport"]')
          ?.scrollTop ?? 0,
    ),
  restore: (top: number) =>
    page.evaluate((value) => {
      const viewport = document.querySelector<HTMLElement>(
        '[data-slot="aui_thread-viewport"]',
      );
      if (!viewport) return;
      viewport.style.scrollBehavior = 'auto';
      viewport.scrollTop = value;
      viewport.style.scrollBehavior = '';
    }, top),
});

test('copied answer and given feedback hold their timers', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page, playwright);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: env.stack.frontendUrl,
  });
  const clock = frozenClock(page);
  await clock.install();
  const load = async () => {
    await clock.resume();
    env.state = 'answer-complete';
    const response = await page.goto(
      `${env.stack.frontendUrl}/chats/${chatId}`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByText(answerStart)).toBeVisible();
  };

  let undoCopiedHover: (() => void) | undefined;
  await captureBrandViews(page, 'chat-copied', {
    open: async (viewport) => {
      await load();
      const scroll = threadScroll(page);
      const top = await scroll.save();
      await page.getByRole('button', { name: 'Copy answer' }).click();
      await scroll.restore(top);
      // The accessible name changes to "Copied" while the confirmation shows.
      const copied = page.getByRole('button', { name: 'Copied' });
      await expect(copied.locator('svg.lucide-check')).toBeVisible();
      await expect(copied).toHaveText('Copied');
      await clock.hold();
      if (viewport === 'desktop')
        undoCopiedHover = hoverWhenParked(page, () => copied);
    },
    close: () => {
      undoCopiedHover?.();
      return clock.release();
    },
  });

  await captureBrandViews(page, 'chat-feedback', {
    open: async () => {
      await load();
      const scroll = threadScroll(page);
      const top = await scroll.save();
      const good = page.getByRole('button', { name: 'Good answer' });
      await good.click();
      await scroll.restore(top);
      await expect(good).toHaveAttribute('aria-pressed', 'true');
      const toast = page.locator('[data-sonner-toast]');
      await expect(toast).toContainText('Thanks for your feedback.');
      await clock.hold();
      await settleAnimations(page);
    },
    close: () => clock.release(),
  });
});

// One turn, as the prototype shows it. A capture-only filler below the answer
// makes the thread scrollable, so the thread can rest at its start with the
// scroll-to-latest button showing.
function streamingTree() {
  return ChatTreeSchema.parse({
    id: chatId,
    title: fileNames.newChat,
    messages: [userMessage(), assistantMessage('streaming-answer')],
    viewedLeafId: assistantMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

test('streaming, reconnecting, and loading chat threads', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page, playwright);

  await page.route(
    (url) => url.pathname === `/api/chats/${chatId}`,
    (route) =>
      route.request().method() === 'GET' && env.state === 'streaming-scroll'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(streamingTree()),
          })
        : route.fallback(),
  );
  let cursor: { x: number; y: number; width: number; height: number } | null =
    null;
  await captureBrandViews(page, 'chat-streaming-scroll', {
    open: async (viewport) => {
      await openThread(
        page,
        env,
        'streaming-scroll',
        page.getByRole('button', { name: 'Stop generating' }),
        '?capture_state=streaming-answer',
      );
      await expect(page.getByText('Thought for 8 seconds')).toBeVisible();
      await page.addStyleTag({
        content: '[data-slot="aui_message-group"] { padding-bottom: 1400px; }',
      });
      const viewportBox = page.locator('[data-slot="aui_thread-viewport"]');
      // Wait until the thread is pinned to the bottom and has stopped
      // changing size, so nothing later pulls it back down.
      await viewportBox.evaluate(async (element) => {
        const frame = () =>
          new Promise<void>((done) => requestAnimationFrame(() => done()));
        let still = 0;
        let last = '';
        for (let tries = 0; still < 30 && tries < 600; tries++) {
          await frame();
          const next = `${element.scrollHeight}|${element.scrollTop}`;
          still = next === last ? still + 1 : 0;
          last = next;
        }
      });
      await page.mouse.move(viewport === 'desktop' ? 840 : 195, 400);
      await viewportBox.evaluate((element) => {
        element.style.scrollBehavior = 'auto';
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(
        page.getByRole('button', { name: 'Scroll to bottom' }),
      ).toBeVisible();
      await expect
        .poll(() => viewportBox.evaluate((element) => element.scrollTop))
        .toBe(0);
      // The streaming cursor after the last word animates (DS 5.6): its box
      // goes into the mask sidecar, next to the prototype's masked caret.
      cursor = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-role="assistant"] li');
        const last = items[items.length - 1];
        if (!last) return null;
        const range = document.createRange();
        range.selectNodeContents(last);
        const rects = range.getClientRects();
        const end = rects[rects.length - 1];
        return end
          ? { x: end.right - 2, y: end.top - 2, width: 24, height: 24 }
          : null;
      });
    },
    close: async (viewport) => {
      const theme = await page
        .locator('html')
        .evaluate((element) =>
          element.classList.contains('dark') ? 'dark' : 'light',
        );
      const sidecar = resolve(
        '.cache/f4.1-visual/review',
        `${brandViewId('chat-streaming-scroll', viewport, theme)}.png.masks.json`,
      );
      if (!cursor || !existsSync(sidecar)) return;
      const rects = JSON.parse(readFileSync(sidecar, 'utf8')) as object[];
      writeFileSync(sidecar, `${JSON.stringify([...rects, cursor])}\n`);
    },
  });

  await captureBrandViews(page, 'chat-reconnecting', {
    open: async () => {
      await openThread(
        page,
        env,
        'reconnecting',
        page.getByRole('button', { name: 'Stop generating' }),
        '?capture_state=reconnecting',
      );
      await expect(
        page.getByText(/Pasal 1320 KUHPerdata menetapkan/).first(),
      ).toBeVisible();
      await expect(page.getByText('Reconnecting…')).toHaveCount(0);
      const disconnected = await page.evaluate(
        () =>
          (
            window as Window & { __chatVisualDisconnectRun?: () => boolean }
          ).__chatVisualDisconnectRun?.() ?? false,
      );
      expect(disconnected).toBe(true);
      await expect(page.getByText('Reconnecting…')).toBeVisible();
      // The prototype shows the scroll-to-latest button here too.
      await page.addStyleTag({
        content: '[data-slot="aui_message-group"] { padding-bottom: 1400px; }',
      });
      const thread = page.locator('[data-slot="aui_thread-viewport"]');
      await thread.evaluate((element) => {
        element.style.scrollBehavior = 'auto';
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(
        page.getByRole('button', { name: 'Scroll to bottom' }),
      ).toBeVisible();
    },
  });

  // The thread request is held by a gated route, so the loading state stays
  // open for as long as the captures need and never depends on a timer.
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  await page.route(
    (url) => url.pathname === `/api/chats/${chatId}`,
    async (route) => {
      if (route.request().method() !== 'GET' || env.state !== 'thread-loading')
        return route.fallback();
      await gate;
      await route.abort().catch(() => undefined);
    },
  );
  try {
    await captureBrandViews(page, 'chat-thread-loading', {
      open: async () => {
        env.state = 'thread-loading';
        await page.clock.setFixedTime(brandFixedTime);
        await page.goto(`${env.stack.frontendUrl}/chats/${chatId}`);
        await expect(page.locator('#main [role="status"]')).toBeVisible();
      },
    });
  } finally {
    release();
  }
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
// the hold of the round's second mark, the instant its drawing has landed.
const indicatorTimes = JSON.parse(
  readFileSync(
    resolve('frontend/test/fixtures/indicator-capture-times.json'),
    'utf8',
  ),
) as {
  seed: number;
  thinkingMs: number;
  wanderMs: number;
  markMs: number;
  finishedOffsetMs: number;
};
const indicatorSeed = indicatorTimes.seed;

async function installHeldRun(page: Page) {
  const thinking = activeRunFrames('thinking');
  const completed = activeRunFrames('streaming-answer').map((frame) => {
    const copy = JSON.parse(JSON.stringify(frame)) as Record<string, unknown>;
    if (copy.type === 'snapshot-start') {
      const snapshot = copy.snapshot as Record<string, unknown>;
      snapshot.status = 'completed';
      snapshot.reasoningDurationMs = 14_000;
    }
    if (copy.partType === 'text') copy.text = answer;
    return copy;
  });
  await page.addInitScript(
    ({ seed, fixtureRunId, thinking, completed }) => {
      const nativeRandom = crypto.getRandomValues.bind(crypto);
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: (array: ArrayBufferView) => {
          if (array instanceof Uint32Array && array.length === 1) {
            array[0] = seed;
            return array;
          }
          return nativeRandom(array as Uint8Array<ArrayBuffer>);
        },
      });
      const nativeFetch = window.fetch.bind(window);
      const held = window as Window & { __finishHeldRun?: () => boolean };
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
        const encoder = new TextEncoder();
        const send = (
          controller: ReadableStreamDefaultController<Uint8Array>,
          frames: unknown[],
        ) => {
          for (const frame of frames)
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
            );
        };
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let settled = false;
            send(controller, thinking);
            held.__finishHeldRun = () => {
              if (settled) return false;
              settled = true;
              send(controller, completed);
              controller.close();
              return true;
            };
            signal?.addEventListener(
              'abort',
              () => {
                if (settled) return;
                settled = true;
                controller.close();
              },
              { once: true },
            );
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
    { seed: indicatorSeed, fixtureRunId: runId, thinking, completed },
  );
}

// Constant pause instant, a few fake seconds after the clock install; the
// page load takes about 1.5 s of fake time, and a longer jump broke the run.
const holdOffsetMs = 3_000;

test('indicator frames at fixed times in a held run', async ({
  page,
  playwright,
}) => {
  test.setTimeout(900_000);
  const markMs = indicatorTimes.markMs;
  const env = await startChatStates(page, playwright);
  await installHeldRun(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: new Date(brandFixedTime) });

  let releaseTree!: () => void;
  let treeGate = Promise.resolve();
  await page.route(
    (url) => url.pathname === `/api/chats/${chatId}`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await treeGate;
      return route.fallback();
    },
  );

  const shot = () =>
    page.screenshot({
      fullPage: false,
      caret: 'hide',
      animations: 'disabled',
      scale: 'css',
    });
  const currentTheme = async () =>
    (await page
      .locator('html')
      .evaluate((element) => element.classList.contains('dark')))
      ? 'dark'
      : 'light';
  // The clock is paused, so a frame must not move between captures.
  // Owner decision of 2026-11-16: on Linux, Chromium rasterizes the identical
  // indicator SVG differently between captures (max channel diff 14/255, only
  // inside the indicator), so the animating frames (chat-thinking,
  // indicator-wander, indicator-mark) carry `"lock": "svg-snapshot"` in the
  // index. Their full-page screenshots are still written in capture mode for
  // review, with no byte assertion on any platform; their lock is a normalized
  // snapshot of the indicator SVG markup (see snapshotFrame). A frame without
  // that lock (indicator-finished, the static mark) keeps the strict checks
  // below: the full-page byte check is a Linux gate only. On Linux the first
  // two full-page screenshots must be byte-identical, before and after the
  // capture. On macOS, Chromium under suite load re-rasterizes a few page
  // pixels between screenshots of an unchanged, frozen page (the indicator
  // element itself stays stable), so there the full-page capture has no byte
  // assertion; instead the indicator element alone (the 20 px indicator svg
  // inside [data-slot="reasoning-mark"]) is screenshotted twice and the two
  // must be byte-identical, with no retry and no tolerance.
  const strictBytes = process.platform === 'linux';
  let pinned: Buffer | undefined;
  const options = {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  } as const;
  const indicator = page.locator('[data-slot="reasoning-mark"] svg').first();
  const scrollState = () =>
    indicator.evaluate((element) => {
      const positions: number[] = [window.scrollX, window.scrollY];
      for (let node: Element | null = element; node; node = node.parentElement)
        positions.push(node.scrollLeft, node.scrollTop);
      return positions;
    });
  const restoreScroll = (positions: number[]) =>
    indicator.evaluate((element, saved) => {
      window.scrollTo({ left: saved[0]!, top: saved[1]!, behavior: 'instant' });
      let index = 2;
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        node.scrollTo({
          left: saved[index++]!,
          top: saved[index++]!,
          behavior: 'instant',
        });
      }
    }, positions);
  /**
   * Warm-up, kept only for the frames that are still pixel-locked
   * (indicator-finished): the strict Linux full-page check and the macOS
   * element check were measured with it and stay as they were. The
   * SVG-snapshot frames read markup and need no warm-up. Chromium's
   * rasterization of the indicator settles with one
   * indicator-only screenshot and one full-page screenshot, both discarded. A
   * capture-only step with no product change; owner decision 2026-11-16.
   * Chromium rasterizes the same SVG differently after the first screenshot of
   * a frame. On the 390 px finished frame the indicator is outside the
   * viewport, so the element screenshot scrolls it into view; the scroll
   * position is saved and restored around it and asserted, and the full-page
   * screenshot comes after the restore, so the frame that follows is at the
   * scroll position it had before the warm-up.
   */
  const warmUp = async (frame: string) => {
    const saved = await scrollState();
    await indicator.screenshot(options);
    await restoreScroll(saved);
    expect(
      await scrollState(),
      `${frame}: scroll restored after warm-up`,
    ).toEqual(saved);
    await shot();
  };
  const pinFrame = async (frame: string, when: string) => {
    await warmUp(frame);
    const first = await shot();
    const second = await shot();
    expect(
      second.equals(first),
      `${frame}: first vs second full-page capture (${when})`,
    ).toBe(true);
    return second;
  };
  /**
   * macOS element check. It runs in the close hook, after the full-page
   * capture has been written, so the scroll that Playwright does to bring an
   * off-screen indicator into view (the 390 px finished frame) cannot affect
   * that capture. The scroll position is restored and compared afterwards.
   */
  const checkIndicatorElement = async (label: string) => {
    const before = await scrollState();
    const first = await indicator.screenshot(options);
    const second = await indicator.screenshot(options);
    expect(second.equals(first), `${label}: two indicator captures`).toBe(true);
    await restoreScroll(before);
    expect(await scrollState(), `${label}: scroll restored`).toEqual(before);
  };

  /** Loads the thinking thread with the run starting at a known clock value. */
  const openHeldRun = async (viewport: BrandViewport, thinkingAxe = false) => {
    await page.clock.resume();
    env.state = 'thinking';
    if (thinkingAxe) {
      // Axe needs live timers, so the thinking thread is checked on a first
      // load with the clock running; the timed frame loads it again.
      await page.goto(env.stack.frontendUrl + '/chats/' + chatId);
      await expect(page.getByText('Thinking…')).toBeVisible();
      await runBrandAxe(
        page,
        brandViewId('chat-thinking', viewport, await currentTheme()),
      );
    }
    treeGate = new Promise<void>((done) => (releaseTree = done));
    await page.goto(env.stack.frontendUrl + '/chats/' + chatId);
    await expect(page.locator('#main [role="status"]')).toBeVisible();
    // Exact start. Pause the clock at a constant instant first, with the tree
    // held (the run's start reaches the page only through the tree; the
    // stream is requested later, on a page timer, which cannot fire while the
    // clock is paused). Then release the tree; no fake time passes while the
    // indicator registers the run, so its start is the same performance.now()
    // value in every run and every later frame is a pure function of runFor().
    const pauseTarget = Date.parse(brandFixedTime) + holdOffsetMs;
    const now = await page.evaluate(() => Date.now());
    expect(now, 'page load finished before the pause instant').toBeLessThan(
      pauseTarget,
    );
    await page.clock.pauseAt(new Date(pauseTarget));
    releaseTree();
    await expect(page.getByText('Thinking…')).toBeVisible();
    // The indicator has registered the run once its svg holds the first draw
    // state: the renderer appends its circles in the same effect that notes
    // the start. No fake time advances while this is polled.
    await expect(
      page
        .locator('[data-slot="reasoning-mark"] svg[width="20"] circle')
        .first(),
    ).toBeAttached();
  };
  const frameId = async (frame: string, viewport: BrandViewport) =>
    brandViewId(frame, viewport, await currentTheme());
  /**
   * Advances the held run to a frame and locks its indicator SVG markup (two
   * equal reads, then a byte comparison with the committed snapshot). Only a
   * frame that is still pixel-locked in the index also gets the full-page
   * byte checks.
   */
  const playTo = async (frame: string, viewport: BrandViewport, ms: number) => {
    await page.clock.runFor(ms);
    const id = await frameId(frame, viewport);
    // A frame locked by the engine tests ("lock": "engine-tests") has no
    // SVG snapshot: its markup is not stable across runs.
    if (await isBrandViewSvgSnapshotted(id))
      await snapshotIndicatorSvg(id, () =>
        indicator.evaluate((element) => element.outerHTML),
      );
    if (!(await isBrandViewPixelLocked(id))) return;
    if (strictBytes) pinned = await pinFrame(frame, 'before capture');
    else await warmUp(frame);
  };
  const closeFrame = async (label: string, viewport: BrandViewport) => {
    if (!(await isBrandViewPixelLocked(await frameId(label, viewport)))) return;
    if (!strictBytes) return checkIndicatorElement(label);
    const after = await pinFrame(label, 'after capture');
    expect(after.equals(pinned!), `${label}: before vs after capture`).toBe(
      true,
    );
    pinned = undefined;
  };

  await captureBrandViews(page, 'chat-thinking', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport, true);
      await playTo('chat-thinking', viewport, indicatorTimes.thinkingMs);
    },
    close: (viewport) => closeFrame('chat-thinking', viewport),
  });
  // wander and mark are not axe-checked: axe hangs on a paused fake clock, and
  // chat-thinking runs axe on the running indicator.
  await captureBrandViews(page, 'indicator-wander', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport);
      await playTo('indicator-wander', viewport, indicatorTimes.wanderMs);
    },
    close: (viewport) => closeFrame('indicator-wander', viewport),
  });
  await captureBrandViews(page, 'indicator-mark', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport);
      await playTo('indicator-mark', viewport, markMs);
    },
    close: (viewport) => closeFrame('indicator-mark', viewport),
  });
  await captureBrandViews(page, 'indicator-finished', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport);
      await page.clock.runFor(markMs);
      env.state = 'answer-complete';
      const finished = await page.evaluate(() =>
        (
          window as Window & { __finishHeldRun?: () => boolean }
        ).__finishHeldRun?.(),
      );
      expect(finished).toBe(true);
      await expect(page.getByText('Thought for 14 seconds')).toBeVisible();
      await playTo(
        'indicator-finished',
        viewport,
        indicatorTimes.finishedOffsetMs,
      );
    },
    close: async (viewport) => {
      await closeFrame('indicator-finished', viewport);
      // Last, because stepping the clock for axe moves the frame.
      let axing = true;
      const stepper = (async () => {
        while (axing) {
          await page.clock.runFor(1);
          await new Promise((done) => setTimeout(done, 5));
        }
      })();
      try {
        await runBrandAxe(
          page,
          brandViewId('indicator-finished', viewport, await currentTheme()),
        );
      } finally {
        axing = false;
        await stepper;
      }
    },
  });
  assertSvgSnapshotsMatched();
});
