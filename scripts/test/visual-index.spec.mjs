import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const expectedViews = [
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

test('Checkpoint C index maps 15 states to both theme captures and every amended prototype', () => {
  const indexPath = resolve(root, 'docs/references/F2.1-visual/index.json');
  assert.ok(existsSync(indexPath), 'shared Checkpoint C index exists');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const checkpointC = index.checkpointC;
  assert.ok(checkpointC, 'canonical visual index has Checkpoint C metadata');
  assert.equal(checkpointC.directory, 'checkpoints');
  assert.equal(checkpointC.deviceScaleFactor, 1);
  assert.deepEqual(checkpointC.viewport, { width: 1440, height: 900 });
  assert.deepEqual(
    checkpointC.views.map(({ id, prototypes }) => [id, prototypes]),
    expectedViews,
  );
  assert.equal(checkpointC.views.length, 15);
  assert.equal(
    checkpointC.views.find(({ id }) => id === 'user-menu-open')?.fixture,
    'active-platform-operator-after-totp-with-platform-navigation-visible',
  );

  const captureNames = checkpointC.views.flatMap(({ id }) =>
    ['light', 'dark'].map((theme) => `c-${id}-${theme}.png`),
  );
  assert.equal(captureNames.length, 30);
  assert.equal(new Set(captureNames).size, 30);
  const prototypes = checkpointC.views.flatMap(
    ({ prototypes: sources }) => sources,
  );
  assert.equal(prototypes.length, 18);
  assert.equal(new Set(prototypes).size, 18);
  for (const source of prototypes) {
    const path = resolve(root, 'docs/design/f2.1-prototype/screens', source);
    assert.ok(existsSync(path), source);
    assert.equal(
      sha256(readFileSync(path)),
      checkpointC.prototypeSha256[source],
      `${source} pristine bytes`,
    );
  }
  for (const capture of captureNames) {
    const path = resolve(
      root,
      'docs/references/F2.1-visual',
      checkpointC.directory,
      capture,
    );
    assert.ok(existsSync(path), `${capture} exists`);
    const png = readFileSync(path);
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.equal(png.readUInt32BE(16), 1440, `${capture} width`);
    assert.equal(png.readUInt32BE(20), 900, `${capture} height`);
  }
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
