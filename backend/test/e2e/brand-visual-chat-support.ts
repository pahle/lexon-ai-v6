// Helpers shared by the chat and chats/settings group specs: the signed-in
// identity with the deterministic chat API and run-stream fixtures, and the
// calming and opening helpers of the chat states.
import {
  expect,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  answer,
  chatId,
  installChatFixtures,
  installRunStreamFixture,
} from './chat-state-fixtures.js';
import { brandFixedTime } from './brand-visual-support.js';
import { gotoWorkspace, teamWorld } from './brand-visual-world.js';
import { ayu } from './prototype-fixtures.js';

// Chat states. The chat API and the run stream are the deterministic fixtures
// of the F4 chat states (chat-state-fixtures.ts); the shell, the auth, and the
// organization are real. The thinking indicator animates, so these states run
// with reduced motion (the project default), which shows the static mark.

export type ChatEnv = { stack: ReturnType<typeof descriptor>; state: string };

// The chat captures run in the team world of the prototype (Ayu, Hukum
// Nusantara, three members, the six Recent chats).
export async function startChatStates(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<ChatEnv> {
  await teamWorld(page, playwright);
  const env: ChatEnv = { stack: descriptor(), state: 'new-chat' };
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  // The theme is stored per origin, so the page is on the app before the
  // first capture applies it.
  await gotoWorkspace(page, ayu.firstName);
  return env;
}

/**
 * The shared capture helper parks the pointer at (0, 0) just before it
 * screenshots, which closes every tooltip. A state whose prototype shows a
 * tooltip calls this in `open`: when the helper parks the pointer, the target
 * is hovered again and its real tooltip must be visible. Returns the undo to
 * call from `close`.
 */
export function hoverWhenParked(page: Page, target: () => Locator) {
  const mouse = page.mouse as unknown as {
    move: (x: number, y: number, options?: object) => Promise<void>;
  };
  const move = mouse.move.bind(mouse);
  const showTooltip = async () => {
    await target().hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toBeVisible();
  };
  mouse.move = async (x, y, options) => {
    await move(x, y, options);
    if (x === 0 && y === 0) await showTooltip();
  };
  // Focus changes after the pointer is parked (the helper blurs the active
  // element) can close the tooltip again, so it is shown once more right
  // before the screenshot.
  const holder = page as unknown as {
    screenshot: (options?: object) => Promise<Buffer>;
  };
  const screenshot = holder.screenshot.bind(page);
  holder.screenshot = async (options) => {
    if (
      !(await page.locator('[data-slot="tooltip-content"][data-open]').count())
    )
      await showTooltip();
    return screenshot(options);
  };
  return () => {
    delete (mouse as { move?: unknown }).move;
    delete (holder as { screenshot?: unknown }).screenshot;
  };
}

export const messageOf = (page: Page, id: string) =>
  page.locator(`[data-message-id="${id}"]`);

export async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/**
 * Parks the pointer, closes any hover tooltip, lets every animation finish,
 * and waits until the layout has been still for 20 frames, so the capture
 * does not depend on where a transition or an autosizing field is.
 */
export async function calm(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await settleAnimations(page);
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((done) => requestAnimationFrame(() => done()));
    const layout = () =>
      [...document.querySelectorAll('button, textarea, input, mark, main')]
        .map((node) => {
          const r = node.getBoundingClientRect();
          return `${r.x},${r.y},${r.width},${r.height}`;
        })
        .join('|');
    let still = 0;
    let last = layout();
    for (let tries = 0; still < 20 && tries < 300; tries++) {
      await frame();
      const next = layout();
      still = next === last ? still + 1 : 0;
      last = next;
    }
  });
}

export async function openThread(
  page: Page,
  env: ChatEnv,
  state: string,
  ready: Locator,
  query = '',
) {
  env.state = state;
  await page.clock.setFixedTime(brandFixedTime);
  const response = await page.goto(
    `${env.stack.frontendUrl}/chats/${chatId}${query}`,
  );
  expect(response?.status()).toBe(200);
  await expect(ready).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
}

export const reasoningToggle = (page: Page, label: string) =>
  page.getByRole('button', { name: label });
export const answerStart = answer.slice(0, 50);
