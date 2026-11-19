import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertApprovalSourceReachable,
  assertApprovedVisualSet,
  buildVisualBaselineManifest,
  invalidateRecapturedApproval,
  resolveVisualMode,
  visualSetDirectory,
} from '../visual-mode.mjs';

const sourceSha = 'a'.repeat(40);

function png(width, height, seed = 0) {
  const bytes = Buffer.alloc(32, seed);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function visualSet({ status = 'approved', os = 'Linux 6.8 (linux/x64)' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'lexon-visual-set-'));
  mkdirSync(join(directory, 'review'));
  mkdirSync(join(directory, 'baseline'));
  const index = {
    version: 1,
    format: 'png',
    deviceScaleFactor: 1,
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    },
    views: {},
  };
  const images = {};
  for (const [id, viewport, seed] of [
    ['sign-in-desktop-light', 'desktop', 1],
    ['sign-in-mobile-dark', 'mobile', 2],
  ]) {
    const { width, height } = index.viewports[viewport];
    const bytes = png(width, height, seed);
    writeFileSync(join(directory, 'review', `${id}.png`), bytes);
    writeFileSync(join(directory, 'baseline', `${id}.png`), bytes);
    index.views[id] = { path: `review/${id}.png`, viewport };
    images[id] = {
      path: `review/${id}.png`,
      sha256: sha256(bytes),
      width,
      height,
      deviceScaleFactor: 1,
    };
  }
  const approval =
    status === 'approved'
      ? {
          version: 1,
          status,
          sourceSha,
          ownerApproval: { reference: 'Owner review', date: '2026-11-15' },
          environment: {
            os,
            browser: 'Chromium 140',
            playwright: '1.64.1',
            node: 'v24.22.1',
            locale: 'en-US',
            timezone: 'Asia/Jakarta',
          },
          images,
        }
      : { version: 1, status, images: {} };
  writeFileSync(join(directory, 'approval.json'), JSON.stringify(approval));
  return { directory, index, approval, images };
}

const linuxCi = { ci: true, platform: 'linux' };

test('the F4.1 set is the default visual set', () => {
  assert.equal(
    visualSetDirectory(undefined, '/repository'),
    resolve('/repository/docs/references/F4.1-visual'),
  );
  assert.throws(() => visualSetDirectory('../secrets', '/repository'));
});

test('an approved F4.1 set with matching review and baseline images passes', () => {
  const { directory, index, approval } = visualSet();
  assert.equal(
    assertApprovedVisualSet(index, approval, directory, {
      expectedViewCount: 2,
    }),
    2,
  );
});

test('comparison is refused without an approval record', () => {
  assert.throws(
    () =>
      resolveVisualMode({
        explicitMode: 'compare',
        approvalPath: join(tmpdir(), 'lexon-missing-approval.json'),
        updateSnapshots: false,
        runtime: linuxCi,
      }),
    /Missing visual approval record/,
  );
});

test('comparison is refused while the set awaits the owner', () => {
  const { directory } = visualSet({ status: 'awaiting-owner' });
  const options = {
    approvalPath: join(directory, 'approval.json'),
    updateSnapshots: false,
    runtime: linuxCi,
  };
  assert.equal(
    resolveVisualMode({ ...options, explicitMode: undefined }),
    'capture',
  );
  assert.throws(
    () => resolveVisualMode({ ...options, explicitMode: 'compare' }),
    /requires recorded owner approval/,
  );
});

test('an image whose bytes differ from the approved hash fails the set', () => {
  const { directory, index, approval } = visualSet();
  writeFileSync(
    join(directory, 'baseline', 'sign-in-desktop-light.png'),
    png(1440, 900, 9),
  );
  assert.throws(
    () =>
      assertApprovedVisualSet(index, approval, directory, {
        expectedViewCount: 2,
      }),
    /sha256 does not match the approved record/,
  );
});

test('an approval recorded on a platform other than Linux is rejected', () => {
  const { directory, index, approval } = visualSet({
    os: 'Darwin 27.0.0 (darwin/arm64)',
  });
  assert.throws(
    () =>
      assertApprovedVisualSet(index, approval, directory, {
        expectedViewCount: 2,
      }),
    /Approved visual record is invalid or incomplete/,
  );
});

test('an approval whose source commit is not in this history is rejected', () => {
  const { approval } = visualSet();
  assert.doesNotThrow(() =>
    assertApprovalSourceReachable(approval, (sha) => sha === sourceSha),
  );
  assert.throws(
    () => assertApprovalSourceReachable(approval, () => false),
    /is not an ancestor of the current commit/,
  );
});

test('recapturing one image returns it and the whole set to awaiting-owner (M3)', () => {
  const { approval, images } = visualSet();
  const recaptured = {
    ...images,
    'sign-in-mobile-dark': {
      ...images['sign-in-mobile-dark'],
      sha256: 'b'.repeat(64),
    },
  };
  const result = invalidateRecapturedApproval(approval, recaptured);
  assert.deepEqual(result.invalidated, ['sign-in-mobile-dark']);
  assert.equal(result.approval.status, 'awaiting-owner');
  assert.deepEqual(result.approval.invalidated, [
    {
      id: 'sign-in-mobile-dark',
      approvedSha256: images['sign-in-mobile-dark'].sha256,
      recapturedSha256: 'b'.repeat(64),
    },
  ]);
  assert.equal(
    result.approval.images['sign-in-desktop-light'].sha256,
    images['sign-in-desktop-light'].sha256,
    'an unchanged image keeps its approved hash',
  );
  assert.equal(
    result.approval.images['sign-in-mobile-dark'],
    undefined,
    'a recaptured image loses its approved entry',
  );
  assert.equal(approval.status, 'approved', 'the input record is not mutated');
});

test('recapturing identical bytes keeps the approval', () => {
  const { approval, images } = visualSet();
  const result = invalidateRecapturedApproval(approval, images);
  assert.deepEqual(result.invalidated, []);
  assert.equal(result.approval.status, 'approved');
  assert.deepEqual(result.approval, approval);
});

test('an unapproved set has nothing to invalidate', () => {
  const { approval, images } = visualSet({ status: 'awaiting-owner' });
  const result = invalidateRecapturedApproval(approval, images);
  assert.deepEqual(result.invalidated, []);
  assert.deepEqual(result.approval, approval);
});

test('approved deviations are validated and carried into the baseline manifest', () => {
  const { directory, index, approval } = visualSet();
  const deviations = [
    { id: 'a', variant: 'm-dark', percent: 1.52, reason: 'owner accepted' },
  ];
  const manifest = buildVisualBaselineManifest(
    index,
    { ...approval, deviations },
    directory,
    {
      sourceSha,
      environment: approval.environment,
      expectedViewCount: 2,
    },
  );
  assert.deepEqual(manifest.deviations, deviations);
  assert.throws(
    () =>
      assertApprovedVisualSet(
        index,
        { ...approval, deviations: [{ id: 'a', variant: 'x' }] },
        directory,
        { expectedViewCount: 2 },
      ),
    /deviations are invalid/,
  );
});

test('a re-approved golden may differ from its approved review image', () => {
  const { directory, index, approval } = visualSet();
  const id = 'sign-in-desktop-light';
  const previousSha256 = approval.images[id].sha256;
  const bytes = png(1440, 900, 9);
  writeFileSync(join(directory, 'baseline', `${id}.png`), bytes);
  const reapproved = {
    id,
    sha256: sha256(bytes),
    previousSha256,
    evidence: { pixels: 1, bbox: [1, 1, 1, 1] },
    decision: '2026-11-19, noise-only re-approval',
  };
  const changed = {
    ...approval,
    images: {
      ...approval.images,
      [id]: { ...approval.images[id], sha256: reapproved.sha256 },
    },
  };
  // Without the entry the golden hash no longer matches the review image.
  assert.throws(
    () =>
      assertApprovedVisualSet(index, changed, directory, {
        expectedViewCount: 2,
      }),
    /sha256 does not match/,
  );
  const withEntry = { ...changed, reapproved: [reapproved] };
  assert.equal(
    assertApprovedVisualSet(index, withEntry, directory, {
      expectedViewCount: 2,
    }),
    2,
  );
  assert.equal(
    buildVisualBaselineManifest(index, withEntry, directory, {
      sourceSha,
      environment: approval.environment,
      expectedViewCount: 2,
    }).images[id].sha256,
    reapproved.sha256,
  );
  assert.throws(
    () =>
      assertApprovedVisualSet(
        index,
        { ...changed, reapproved: [{ ...reapproved, evidence: {} }] },
        directory,
        { expectedViewCount: 2 },
      ),
    /re-approvals are invalid/,
  );
});
