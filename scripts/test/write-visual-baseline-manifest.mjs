import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release, type } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  assertApprovalSourceReachable,
  buildVisualBaselineManifest,
  pixelLockedViews,
  visualSetDirectory,
} from '../visual-mode.mjs';

const root = resolve(import.meta.dirname, '../..');
const setIndex = process.argv.indexOf('--set');
const visualSet = setIndex >= 0 ? process.argv[setIndex + 1] : undefined;
const visualDirectory = visualSetDirectory(visualSet, root);
const outputArgument = process.argv
  .slice(2)
  .find(
    (arg, position, args) => arg !== '--set' && args[position - 1] !== '--set',
  );
if (process.env.CI !== 'true' || process.platform !== 'linux') {
  throw new Error('Visual baseline manifest requires a Linux CI runner.');
}
const indexBytes = readFileSync(resolve(visualDirectory, 'index.json'));
const approvalBytes = readFileSync(resolve(visualDirectory, 'approval.json'));
const index = JSON.parse(indexBytes);
const approval = JSON.parse(approvalBytes);
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
  });
  let locale;
  let timezone;
  try {
    const page = await context.newPage();
    ({ locale, timezone } = await page.evaluate(() => ({
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })));
  } finally {
    await context.close();
  }
  if (locale !== 'en-US' || timezone !== 'Asia/Jakarta') {
    throw new Error(
      'Baseline manifest browser context does not match visual settings.',
    );
  }
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  // A shallow CI checkout cannot prove ancestry; a full clone must.
  const shallow =
    execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: root,
      encoding: 'utf8',
    }).trim() === 'true';
  if (!shallow)
    assertApprovalSourceReachable(approval, (sha) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
          cwd: root,
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    });
  const manifest = buildVisualBaselineManifest(
    index,
    approval,
    visualDirectory,
    {
      sourceSha,
      generatedAt: new Date().toISOString(),
      expectedViewCount: Object.values(pixelLockedViews(index)).filter((view) =>
        view.path?.startsWith('review/'),
      ).length,
      approvalSha256: sha256(approvalBytes),
      indexSha256: sha256(indexBytes),
      environment: {
        os: `${type()} ${release()} (${platform()}/${arch()})`,
        browser: `Chromium ${browser.version()}`,
        playwright: JSON.parse(
          readFileSync(
            resolve(root, 'node_modules/@playwright/test/package.json'),
            'utf8',
          ),
        ).version,
        node: process.version,
        locale,
        timezone,
      },
    },
  );
  const output = resolve(
    root,
    outputArgument ?? '.cache/f4.1-visual/baseline-manifest.json',
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `Verified ${manifest.viewCount} approved Linux baseline images: ${output}`,
  );
} finally {
  await browser.close();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
