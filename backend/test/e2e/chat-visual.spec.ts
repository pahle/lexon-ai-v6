import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  OrganizationSummarySchema,
  SwitchResultSchema,
} from '@lexon/contracts';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

import {
  visualDirectory,
  captureDirectory,
  indexPath,
  manifestPath,
  fixedNow,
  validateFixtures,
  installChatFixtures,
  installRunStreamFixture,
  openState,
  type VisualCapture,
} from './chat-state-fixtures.js';

test('captures the indexed F4 chat visual review set', async ({ page }) => {
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
      data: { name: 'Hukum Nusantara', slug: 'hukum-nusantara' },
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
    const target = resolve(visualDirectory, capture.filename);
    await mkdir(captureDirectory, { recursive: true });
    await page.screenshot({
      path: target,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  }
  if (releasePendingTree) releasePendingTree();

  const producerCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const files = [];
  for (const capture of index.captures) {
    const path = resolve(visualDirectory, capture.filename);
    const image = await readFile(path);
    const updated = {
      ...capture,
      producerCommit,
      sha256: createHash('sha256').update(image).digest('hex'),
    };
    Object.assign(capture, updated);
    files.push({
      id: capture.id,
      filename: capture.filename,
      state: capture.state,
      theme: capture.theme,
      viewport: capture.viewport,
      width: image.readUInt32BE(16),
      height: image.readUInt32BE(20),
      sha256: updated.sha256,
    });
  }
  index.status = 'captured';
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  Object.assign(manifest, {
    status: 'captured-not-reviewed',
    producerCommit,
    capturedAt: new Date().toISOString(),
    fixtureClock: fixedNow,
    files,
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
});
