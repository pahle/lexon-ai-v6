// Helpers of the chats/settings group: the team world (Ayu, Hukum Nusantara)
// with the deterministic chat API and run-stream fixtures, so every capture
// shows the team sidebar of the prototype.
import type { Page, PlaywrightWorkerArgs } from '@playwright/test';
import {
  installChatFixtures,
  installRunStreamFixture,
} from './chat-state-fixtures.js';
import { gotoWorkspace, teamWorld } from './brand-visual-world.js';
import { descriptor } from './runtime-support.js';
import { ayu } from './prototype-fixtures.js';
import type { ChatEnv } from './brand-visual-chat-support.js';

export async function startTeamChatStates(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<ChatEnv & { teamId: string }> {
  const { teamId } = await teamWorld(page, playwright);
  const env = { stack: descriptor(), state: 'new-chat', teamId };
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  await gotoWorkspace(page, ayu.firstName);
  return env;
}
