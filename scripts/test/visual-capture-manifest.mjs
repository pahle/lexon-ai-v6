import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const visualRoot = resolve(root, 'docs/references/F2.1-visual');
const index = JSON.parse(
  await readFile(resolve(visualRoot, 'index.json'), 'utf8'),
);
const approval = JSON.parse(
  await readFile(resolve(visualRoot, 'approval.json'), 'utf8'),
);
assert.deepEqual(
  approval,
  { version: 1, status: 'awaiting-owner' },
  'Task 9 capture must remain awaiting owner approval.',
);
const reviewViews = Object.entries(index.views).filter(([, view]) =>
  view.path.startsWith('review/'),
);
assert.equal(
  reviewViews.length,
  82,
  'Task 9 manifest includes exactly 82 indexed review PNGs.',
);

const browser = await chromium.launch({ headless: true });
const images = {};
try {
  for (const [id, view] of reviewViews) {
    const imagePath = resolve(visualRoot, view.path);
    const png = await readFile(imagePath);
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      `${id}: PNG`,
    );
    const viewport = index.viewports[view.viewport];
    assert.equal(png.readUInt32BE(16), viewport.width, `${id}: width`);
    assert.equal(png.readUInt32BE(20), viewport.height, `${id}: height`);
    images[id] = {
      path: view.path,
      sha256: createHash('sha256').update(png).digest('hex'),
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: index.deviceScaleFactor,
    };
  }
  const current = {
    version: 1,
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    capturedAt: new Date().toISOString(),
    environment: {
      os: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
      browser: `Chromium ${browser.version()}`,
      playwright: JSON.parse(
        await readFile(
          resolve(root, 'node_modules/@playwright/test/package.json'),
          'utf8',
        ),
      ).version,
      node: process.version,
      locale: 'en-US',
      timezone: 'Asia/Jakarta',
    },
    approvalStatus: approval.status,
    viewCount: reviewViews.length,
    images,
  };
  const compareIndex = process.argv.indexOf('--compare');
  if (compareIndex >= 0) {
    const priorPath = resolve(process.argv[compareIndex + 1]);
    const prior = JSON.parse(await readFile(priorPath, 'utf8'));
    assert.equal(
      prior.sourceSha,
      current.sourceSha,
      'capture source SHA matches',
    );
    assert.deepEqual(
      prior.environment,
      current.environment,
      'capture environment matches',
    );
    assert.deepEqual(
      prior.images,
      current.images,
      'all indexed PNG bytes match the previous capture',
    );
    process.stdout.write(
      `Stable screenshot bytes: ${reviewViews.length}/82 matched ${priorPath}\n`,
    );
  } else {
    const outputIndex = process.argv.indexOf('--output');
    const outputPath =
      outputIndex < 0
        ? resolve(visualRoot, 'capture-manifest.json')
        : resolve(process.argv[outputIndex + 1]);
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(dirname(outputPath), { recursive: true }),
    );
    await writeFile(outputPath, JSON.stringify(current, null, 2) + '\n');
    process.stdout.write(
      `Recorded ${reviewViews.length} indexed PNG hashes in ${outputPath}\n`,
    );
  }
} finally {
  await browser.close();
}
