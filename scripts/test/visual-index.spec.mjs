import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  assertIndexedArtifact,
  assertApprovedVisualSet,
  assertReviewArtifact,
  buildVisualBaselineManifest,
  resolveVisualMode,
} from '../visual-mode.mjs';

const root = resolve(import.meta.dirname, '../..');
const visualRoot = resolve(root, 'docs/references/F2.1-visual');
const baseViews = [
  'sign-in',
  'sign-up',
  'forgot-password',
  'two-factor',
  'onboarding',
  'home',
  'profile',
  'security',
  'appearance',
  'members',
  'invitations',
  'general',
  'provisioning',
  'organization-switcher-open',
  'user-menu-open',
  'sign-in-field-errors',
  'sign-in-password-shown-loading',
  'sign-in-form-error',
  'settings-saved-toast',
];
const expectedCheckpointCViews = [
  ['sign-in', ['01-sign-in-light.png', '02-sign-in-dark.png']],
  ['sign-in-field-errors', ['03-sign-in-field-errors.png']],
  ['sign-in-password-shown-loading', ['04-sign-in-password-shown-loading.png']],
  ['sign-in-form-error', ['05-sign-in-form-error.png']],
  ['home', ['10-home-light.png', '11-home-dark.png']],
  ['sidebar-collapsed', ['12-home-sidebar-collapsed.png']],
  ['organization-switcher-open', ['13-organization-switcher-open.png']],
  ['user-menu-open', ['14-user-menu-open.png']],
  ['profile', ['20-settings-profile.png', '21-settings-profile-dark.png']],
  ['appearance', ['22-settings-appearance.png']],
  ['security', ['23-settings-security.png']],
  ['members', ['24-settings-members.png']],
  ['invitations', ['25-settings-invitations.png']],
  ['general', ['26-settings-general.png']],
  ['settings-saved-toast', ['27-settings-saved-toast.png']],
];
const expectedPaths = [
  ...baseViews.flatMap((view) =>
    ['desktop', 'mobile'].flatMap((viewport) =>
      ['light', 'dark'].map(
        (theme) => `review/${view}-${viewport}-${theme}.png`,
      ),
    ),
  ),
  ...['desktop', 'mobile'].flatMap((viewport) =>
    ['light', 'dark'].map(
      (theme) => `review/sidebar-header-expanded-${viewport}-${theme}.png`,
    ),
  ),
  ...['light', 'dark'].map(
    (theme) => `review/sidebar-header-collapsed-desktop-${theme}.png`,
  ),
];

test('canonical index contains the stable 82-image review contract and immutable references', () => {
  const index = JSON.parse(
    readFileSync(resolve(visualRoot, 'index.json'), 'utf8'),
  );
  assert.equal(index.version, 1);
  assert.deepEqual(index.viewports, {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  });
  assert.equal(index.deviceScaleFactor, 1);
  assert.equal(index.format, 'png');
  const reviewViews = Object.entries(index.views).filter(([, view]) =>
    view.path.startsWith('review/'),
  );
  assert.equal(reviewViews.length, 82);
  assert.deepEqual(
    reviewViews.map(([, view]) => view.path).sort(),
    expectedPaths.sort(),
  );
  assert.equal(
    new Set(Object.values(index.views).map((view) => view.path)).size,
    Object.keys(index.views).length,
  );
  for (const [id, view] of reviewViews) {
    assert.ok(
      view.theme &&
        view.viewport &&
        view.state &&
        view.source &&
        view.applicability,
      `${id} metadata`,
    );
    const path = resolve(visualRoot, view.path);
    assert.ok(existsSync(path), `${id}: missing artifact ${view.path}`);
    const png = readFileSync(path);
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      `${id}: PNG signature`,
    );
    const size = index.viewports[view.viewport];
    assert.equal(png.readUInt32BE(16), size.width, `${id}: width`);
    assert.equal(png.readUInt32BE(20), size.height, `${id}: height`);
  }
  const pristine = Object.entries(index.views).filter(([, view]) =>
    view.path.startsWith('reference/'),
  );
  assert.equal(pristine.length, 10);
  const sourceManifest = JSON.parse(
    readFileSync(resolve(visualRoot, 'reference/source-manifest.json'), 'utf8'),
  );
  const protectedReferences = new Map(
    sourceManifest.referencePngs.map(({ path, sha256 }) => [
      path.replace('docs/references/F2.1-visual/', ''),
      sha256,
    ]),
  );
  for (const [id, view] of pristine) {
    const path = resolve(visualRoot, view.path);
    assert.ok(existsSync(path), `${id}: protected pristine PNG`);
    assert.equal(
      sha256(readFileSync(path)),
      protectedReferences.get(view.path),
      `${id}: pristine source SHA`,
    );
  }
  assert.equal(
    Object.values(index.views).some((view) =>
      /\d{4}-\d{2}-\d{2}T.*\.png$/.test(view.path),
    ),
    false,
  );
  assert.equal(index.normalizations.sessions.method, 'GET');
  assert.equal(
    index.normalizations.sessions.endpoint,
    '/api/identity/sessions',
  );
  assert.equal(
    index.normalizations.sessions.fields.createdAt.fixedIso,
    '2026-11-04T11:02:00.000Z',
  );
  assert.equal(
    index.normalizations.sessions.fields.expiresAt.fixedIso,
    '2026-11-11T11:02:00.000Z',
  );
  assert.equal(index.normalizations.invitationExpiresAt.method, 'GET');
  assert.equal(
    index.normalizations.invitationExpiresAt.endpoint,
    '/api/organizations/:activeTeamId/invitations',
  );
  assert.equal(
    index.normalizations.invitationExpiresAt.field,
    'items[].expiresAt',
  );
  assert.equal(
    index.normalizations.invitationExpiresAt.fixedIso,
    '2026-11-18T11:02:00.000Z',
  );
  assert.deepEqual(index.normalizations.invitationExpiresAt.orderedEmails, [
    'sam.taylor@example.test',
    'alex.rivera@example.test',
    'jordan.lee@example.test',
  ]);
  assert.equal(
    index.normalizations.invitationExpiresAt.orderingScope,
    'Only an unpaginated response containing exactly these three distinct emails; preserve the existing rows and every row field.',
  );
  assert.deepEqual(index.normalizations.memberOrder.orderedEmails, [
    'maya.chen@example.test',
    'jordan.lee@example.test',
    'alex.rivera@example.test',
  ]);
  assert.equal(index.normalizations.memberOrder.method, 'GET');
  assert.equal(
    index.normalizations.memberOrder.endpoint,
    '/api/organizations/:activeTeamId/members',
  );
});

test('pending approval defaults to capture and approved update requires explicit Linux CI', () => {
  const approvalPath = resolve(visualRoot, 'approval.json');
  assert.ok(existsSync(approvalPath), 'explicit approval state exists');
  assert.throws(
    () =>
      assertIndexedArtifact({ views: {} }, 'missing-view', visualRoot, {
        mode: 'capture',
      }),
    /missing-view/,
  );
  assert.throws(
    () =>
      resolveVisualMode({
        approvalPath: resolve(visualRoot, 'missing-approval.json'),
      }),
    /Missing visual approval record/,
  );
  assert.throws(
    () =>
      resolveVisualMode({
        approvalPath,
        explicitMode: 'capture-with-baseline',
      }),
    /Unknown LEXON_VISUAL_MODE/,
  );
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'lexon-visual-mode-'));
  try {
    const pendingPath = resolve(tempRoot, 'awaiting-owner.json');
    writeFileSync(
      pendingPath,
      JSON.stringify({ version: 1, status: 'awaiting-owner' }),
    );
    assert.equal(
      resolveVisualMode({ approvalPath: pendingPath, updateSnapshots: false }),
      'capture',
    );
    assert.throws(
      () =>
        resolveVisualMode({
          approvalPath: pendingPath,
          explicitMode: 'compare',
        }),
      /requires recorded owner approval/,
    );
    assert.throws(
      () =>
        resolveVisualMode({
          approvalPath: pendingPath,
          explicitMode: 'update',
          updateSnapshots: false,
        }),
      /requires owner approval and --update-snapshots/,
    );
    const approvedPath = resolve(tempRoot, 'approval.json');
    writeFileSync(
      approvedPath,
      JSON.stringify(
        approvedFixture(
          {
            views: { named: { path: 'review/named.png', viewport: 'desktop' } },
          },
          pngFixture(16, 16),
        ),
      ),
    );
    assert.equal(
      resolveVisualMode({ approvalPath: approvedPath, updateSnapshots: false }),
      'compare',
    );
    assert.throws(
      () =>
        assertIndexedArtifact(
          { views: { named: { path: 'review/named.png' } } },
          'named',
          tempRoot,
          { mode: 'compare' },
        ),
      /named.*baseline.*named\.png/,
    );
    const capturePath = resolve(tempRoot, 'review/named.png');
    mkdirSync(resolve(tempRoot, 'review'), { recursive: true });
    writeFileSync(capturePath, pngFixture(16, 16));
    assert.equal(
      assertIndexedArtifact(
        { views: { named: { path: 'review/named.png' } } },
        'named',
        tempRoot,
        { mode: 'capture' },
      ),
      capturePath,
    );
    assert.equal(
      assertReviewArtifact(
        { views: { valid: { path: 'review/valid.png' } } },
        'valid',
        tempRoot,
      ),
      resolve(tempRoot, 'review/valid.png'),
    );
    for (const path of [
      'reference/login-02-desktop-light.png',
      'checkpoints/c-home-light.png',
      'review/../../reference/login.png',
    ]) {
      assert.throws(
        () =>
          assertReviewArtifact(
            { views: { unsafe: { path } } },
            'unsafe',
            tempRoot,
          ),
        /review\/|outside review/,
      );
    }
    assert.throws(
      () =>
        resolveVisualMode({
          approvalPath: approvedPath,
          explicitMode: 'update',
          updateSnapshots: false,
        }),
      /requires owner approval and --update-snapshots/,
    );
    assert.throws(
      () =>
        resolveVisualMode({
          approvalPath: approvedPath,
          explicitMode: 'update',
          updateSnapshots: true,
          runtime: { ci: true, platform: 'darwin' },
        }),
      /requires a Linux CI runner/,
    );
    assert.equal(
      resolveVisualMode({
        approvalPath: approvedPath,
        explicitMode: 'update',
        updateSnapshots: true,
        runtime: { ci: true, platform: 'linux' },
      }),
      'update',
    );
    assert.throws(
      () =>
        resolveVisualMode({
          approvalPath: approvedPath,
          explicitMode: 'capture',
          updateSnapshots: true,
        }),
      /allowed only with LEXON_VISUAL_MODE=update/,
    );
    writeFileSync(
      approvedPath,
      JSON.stringify({ version: 1, status: 'unknown' }),
    );
    assert.throws(
      () => resolveVisualMode({ approvalPath: approvedPath }),
      /status awaiting-owner or approved/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  const readme = readFileSync(resolve(visualRoot, 'README.md'), 'utf8');
  assert.match(readme, /LEXON_VISUAL_MODE=capture/);
  assert.match(readme, /LEXON_VISUAL_MODE=compare/);
  assert.match(readme, /LEXON_VISUAL_MODE=update/);
  assert.match(readme, /approval\.json/);
});

test('approved visual records require a complete, hash-valid named baseline set', () => {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'lexon-approved-visual-'));
  try {
    const visualRoot = resolve(tempRoot, 'visual');
    mkdirSync(resolve(visualRoot, 'baseline'), { recursive: true });
    mkdirSync(resolve(visualRoot, 'review'), { recursive: true });
    const index = {
      version: 1,
      deviceScaleFactor: 1,
      format: 'png',
      viewports: { desktop: { width: 16, height: 16 } },
      views: {
        'sample-desktop-light': {
          path: 'review/sample-desktop-light.png',
          viewport: 'desktop',
          theme: 'light',
          state: 'Stable sample view',
          source: 'Lexon test fixture',
          applicability: 'Visual regression fixture',
        },
      },
    };
    const baseline = pngFixture(16, 16);
    writeFileSync(
      resolve(visualRoot, 'baseline/sample-desktop-light.png'),
      baseline,
    );
    const approvalPath = resolve(visualRoot, 'approval.json');
    const approval = approvedFixture(index, baseline);
    writeFileSync(approvalPath, JSON.stringify(approval));
    writeFileSync(
      resolve(visualRoot, 'review/sample-desktop-light.png'),
      baseline,
    );

    assert.equal(
      resolveVisualMode({ approvalPath, updateSnapshots: false }),
      'compare',
    );
    const nonLinuxPath = resolve(visualRoot, 'non-linux-approval.json');
    writeFileSync(
      nonLinuxPath,
      JSON.stringify({
        ...approval,
        environment: { ...approval.environment, os: 'Darwin 25.0.0' },
      }),
    );
    assert.throws(
      () => resolveVisualMode({ approvalPath: nonLinuxPath }),
      /invalid or incomplete/,
    );
    assert.equal(
      assertApprovedVisualSet(index, approval, visualRoot, {
        expectedViewCount: 1,
      }),
      1,
    );
    const manifest = buildVisualBaselineManifest(index, approval, visualRoot, {
      sourceSha: 'b'.repeat(40),
      environment: { os: 'Linux fixture' },
      capturedAt: '2026-11-05T00:00:00.000Z',
      expectedViewCount: 1,
    });
    assert.equal(manifest.sourceSha, 'b'.repeat(40));
    assert.equal(manifest.viewCount, 1);
    assert.equal(
      manifest.images['sample-desktop-light'].path,
      'baseline/sample-desktop-light.png',
    );
    approval.sourceSha = 'invalid';
    writeFileSync(approvalPath, JSON.stringify(approval));
    assert.throws(
      () =>
        resolveVisualMode({
          approvalPath,
          explicitMode: 'compare',
          updateSnapshots: false,
        }),
      /invalid or incomplete/,
    );
    approval.sourceSha = 'a'.repeat(40);
    writeFileSync(approvalPath, JSON.stringify(approval));

    rmSync(resolve(visualRoot, 'baseline/sample-desktop-light.png'));
    assert.throws(
      () =>
        assertApprovedVisualSet(index, approval, visualRoot, {
          expectedViewCount: 1,
        }),
      /sample-desktop-light.*baseline.*missing/i,
    );
    const changedBytes = pngFixture(16, 16);
    changedBytes[8] = 1;
    writeFileSync(
      resolve(visualRoot, 'baseline/sample-desktop-light.png'),
      changedBytes,
    );
    assert.throws(
      () =>
        assertApprovedVisualSet(index, approval, visualRoot, {
          expectedViewCount: 1,
        }),
      /sample-desktop-light.*sha256/i,
    );

    writeFileSync(
      resolve(visualRoot, 'baseline/sample-desktop-light.png'),
      baseline,
    );
    writeFileSync(
      resolve(visualRoot, 'baseline/sample-desktop-light.png'),
      pngFixture(15, 16),
    );
    assert.throws(
      () =>
        assertApprovedVisualSet(index, approval, visualRoot, {
          expectedViewCount: 1,
        }),
      /sample-desktop-light.*invalid dimensions/i,
    );
    writeFileSync(
      resolve(visualRoot, 'baseline/sample-desktop-light.png'),
      baseline,
    );
    approval.images['unexpected-view'] = {
      ...approval.images['sample-desktop-light'],
    };
    assert.throws(
      () =>
        assertApprovedVisualSet(index, approval, visualRoot, {
          expectedViewCount: 1,
        }),
      /unexpected-view.*not present in the visual index/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CI comparison is the normal approved path and updates require explicit dispatch', () => {
  const workflow = readFileSync(
    resolve(root, '.github/workflows/ci.yml'),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /visual_mode:[\s\S]*options:[\s\S]*- compare[\s\S]*- update/,
  );
  assert.match(
    workflow,
    /LEXON_VISUAL_MODE=update pnpm test:e2e --update-snapshots/,
  );
  assert.match(workflow, /LEXON_VISUAL_MODE=compare pnpm test:e2e/);
  assert.match(
    workflow,
    /steps\.visual-approval\.outputs\.status == 'awaiting-owner'/,
  );
  assert.match(workflow, /docs\/references\/F2\.1-visual\/baseline\/\*\.png/);
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngFixture(width, height) {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

function approvedFixture(index, bytes) {
  return {
    version: 1,
    status: 'approved',
    sourceSha: 'a'.repeat(40),
    ownerApproval: { reference: 'test approval', date: '2026-11-05' },
    environment: {
      os: 'Linux test fixture',
      browser: 'Chromium 156.0.8078.4',
      playwright: '1.64.1',
      node: 'v24.22.1',
      locale: 'en-US',
      timezone: 'Asia/Jakarta',
    },
    images: Object.fromEntries(
      Object.entries(index.views).map(([id, view]) => [
        id,
        {
          path: view.path,
          sha256: sha256(bytes),
          width: 16,
          height: 16,
          deviceScaleFactor: 1,
        },
      ]),
    ),
  };
}

test('Checkpoint C index still maps every prototype and preserves all checkpoint PNGs', () => {
  const index = JSON.parse(
    readFileSync(resolve(visualRoot, 'index.json'), 'utf8'),
  );
  const checkpointC = index.checkpointC;
  assert.ok(checkpointC, 'canonical visual index has Checkpoint C metadata');
  assert.equal(checkpointC.directory, 'checkpoints');
  assert.equal(checkpointC.deviceScaleFactor, 1);
  assert.deepEqual(checkpointC.viewport, { width: 1440, height: 900 });
  assert.deepEqual(
    checkpointC.views.map(({ id, prototypes }) => [id, prototypes]),
    expectedCheckpointCViews,
  );
  assert.equal(checkpointC.views.length, 15);
  assert.equal(
    checkpointC.views.find(({ id }) => id === 'user-menu-open')?.fixture,
    'active-platform-operator-after-totp-with-platform-navigation-visible-and-children-collapsed',
  );
  const prototypes = checkpointC.views.flatMap(
    ({ prototypes: sources }) => sources,
  );
  assert.equal(prototypes.length, 18);
  for (const source of prototypes) {
    const path = resolve(root, 'docs/design/f2.1-prototype/screens', source);
    assert.ok(existsSync(path), source);
    assert.equal(
      sha256(readFileSync(path)),
      checkpointC.prototypeSha256[source],
      `${source} pristine bytes`,
    );
  }
  for (const { id } of checkpointC.views)
    for (const theme of ['light', 'dark']) {
      const path = resolve(visualRoot, 'checkpoints', `c-${id}-${theme}.png`);
      assert.ok(existsSync(path), `C ${id} ${theme}`);
      const png = readFileSync(path);
      assert.equal(png.readUInt32BE(16), 1440);
      assert.equal(png.readUInt32BE(20), 900);
    }
});
