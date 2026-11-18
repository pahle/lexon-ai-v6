// Helpers shared by the chat and chats/settings group specs: the signed-in
// identity with the deterministic chat API and run-stream fixtures, and the
// calming and opening helpers of the chat states.
import { expect, type Locator, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  answer,
  chatId,
  installChatFixtures,
  installRunStreamFixture,
} from './chat-state-fixtures.js';
import { brandFixedTime } from './brand-visual-support.js';
import { gotoWorkspace, prepareIdentity } from './brand-visual-world.js';
import { ayu } from './prototype-fixtures.js';

// Chat states. The chat API and the run stream are the deterministic fixtures
// of the F4 chat states (chat-state-fixtures.ts); the shell, the auth, and the
// organization are real. The thinking indicator animates, so these states run
// with reduced motion (the project default), which shows the static mark.

export type ChatEnv = { stack: ReturnType<typeof descriptor>; state: string };

export async function startChatStates(page: Page): Promise<ChatEnv> {
  const { stack } = await prepareIdentity(
    page,
    { name: ayu.name },
    ayu.jobTitle,
  );
  const env: ChatEnv = { stack, state: 'new-chat' };
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  // The theme is stored per origin, so the page is on the app before the
  // first capture applies it.
  await gotoWorkspace(page, 'Ayu');
  return env;
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
