import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  OrganizationSummarySchema,
  SwitchResultSchema,
} from '@lexon/contracts';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

import {
  indexPath,
  fixedNow,
  validateFixtures,
  installChatFixtures,
  installRunStreamFixture,
  openState,
  type VisualCapture,
} from './chat-state-fixtures.js';

// The state readiness, behavior, and solid-destructive-button assertions of
// the retired F4 chat visual capture spec, without screenshots. The state list
// still comes from the F4 visual index (kept as history).
test('every indexed F4 chat state opens with its expected content and controls', async ({
  page,
}) => {
  test.setTimeout(240_000);
  validateFixtures();
  const stack = descriptor();
  await page.clock.setFixedTime(new Date(fixedNow));
  const headers = await authenticateApi(page.request, {
    name: 'Ayu Wardani',
    email: 'ayu.wardani@hukum-nusantara.co.id',
  });
  const createdTeam = await page.request.post(
    `${stack.apiUrl}/api/organizations`,
    {
      headers,
      data: { name: 'Hukum Nusantara', slug: 'hukum-nusantara-states' },
    },
  );
  expect(createdTeam.status()).toBe(201);
  const team = OrganizationSummarySchema.parse(await createdTeam.json());
  expect(team).toMatchObject({
    name: 'Hukum Nusantara',
    kind: 'team',
    role: 'owner',
  });
  const activeTeam = await page.request.post(
    `${stack.apiUrl}/api/organizations/active`,
    { headers, data: { organizationId: team.id } },
  );
  expect(activeTeam.status()).toBe(200);
  expect(SwitchResultSchema.parse(await activeTeam.json())).toMatchObject({
    status: 'switched',
    organization: { id: team.id, name: 'Hukum Nusantara', role: 'owner' },
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);

  let state = '';
  let releasePendingTree: (() => void) | undefined;
  await installChatFixtures(
    page,
    () => state,
    (release) => {
      releasePendingTree = release;
    },
  );
  await installRunStreamFixture(page);
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
    status?: string;
    captures: VisualCapture[];
    navigationCoverage: Array<{ captureId: string }>;
  };
  expect(index.captures).toHaveLength(66);
  expect(index.navigationCoverage).toHaveLength(20);

  for (const capture of index.captures) {
    if (releasePendingTree) {
      releasePendingTree();
      releasePendingTree = undefined;
    }
    state = capture.state;
    const viewport =
      capture.viewport === 'mobile'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      colorScheme: capture.theme,
      reducedMotion: 'reduce',
    });
    await openState(page, stack.publicUrl, capture.state);
    await expect(page.locator('#main')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  }
  if (releasePendingTree) releasePendingTree();
});
