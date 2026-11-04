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
  assertReviewArtifact,
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
  assert.equal(
    index.normalizations.sessionExpiresAt.endpoint,
    '/api/identity/sessions',
  );
  assert.equal(
    index.normalizations.sessionExpiresAt.fixedIso,
    '2030-01-01T00:00:00.000Z',
  );
});

test('approval explicitly keeps review captures pending and approved mode cannot silently capture', () => {
  const approvalPath = resolve(visualRoot, 'approval.json');
  assert.ok(existsSync(approvalPath), 'explicit approval state exists');
  const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
  assert.deepEqual(approval, { version: 1, status: 'awaiting-owner' });
  assert.equal(
    resolveVisualMode({
      approvalPath,
      explicitMode: undefined,
      updateSnapshots: false,
    }),
    'capture',
  );
  assert.throws(
    () => resolveVisualMode({ approvalPath, explicitMode: 'compare' }),
    /requires recorded owner approval/,
  );
  assert.throws(
    () =>
      resolveVisualMode({
        approvalPath,
        explicitMode: 'update',
        updateSnapshots: false,
      }),
    /requires owner approval and --update-snapshots/,
  );
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
    const approvedPath = resolve(tempRoot, 'approval.json');
    writeFileSync(
      approvedPath,
      JSON.stringify({ version: 1, status: 'approved' }),
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
    writeFileSync(capturePath, 'capture');
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
    assert.equal(
      resolveVisualMode({
        approvalPath: approvedPath,
        explicitMode: 'update',
        updateSnapshots: true,
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
