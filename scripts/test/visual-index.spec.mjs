import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
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
  isSnapshotUpdateEnabled,
  resolveVisualMode,
} from '../visual-mode.mjs';

const root = resolve(import.meta.dirname, '../..');
const visualRoot = resolve(root, 'docs/references/F4.1-visual');

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
  assert.match(readme, /LEXON_VISUAL_MODE/);
  assert.match(readme, /`awaiting-owner` captures/);
  assert.match(readme, /`approved` compares/);
  assert.match(readme, /visual_mode: update/);
  assert.match(readme, /approval\.json/);
});

test('approved retirement skips only the selected comparison baseline', () => {
  withRetirementFixture(({ index, tempRoot, retirement }) => {
    const retirementOptions = { retirements: retirement };
    assert.equal(
      assertIndexedArtifact(index, 'retired-view', tempRoot, {
        mode: 'compare',
        ...retirementOptions,
      }),
      null,
    );
    assert.equal(
      assertIndexedArtifact(index, 'active-view', tempRoot, {
        mode: 'compare',
        ...retirementOptions,
      }),
      resolve(tempRoot, 'baseline/active-view.png'),
    );
  });
});

test('approved retirement does not alter capture or update artifact paths', () => {
  withRetirementFixture(({ index, tempRoot, retirement }) => {
    for (const [mode, expectedPath] of [
      ['capture', 'review/retired-view.png'],
      ['update', 'baseline/retired-view.png'],
    ]) {
      assert.equal(
        assertIndexedArtifact(index, 'retired-view', tempRoot, {
          mode,
          retirements: retirement,
        }),
        resolve(tempRoot, expectedPath),
      );
    }
  });
});

function withRetirementFixture(run) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'lexon-visual-retirement-'));
  try {
    const index = {
      views: {
        'retired-view': { path: 'review/retired-view.png' },
        'active-view': { path: 'review/active-view.png' },
      },
    };
    const baseline = pngFixture(16, 16);
    const baselineSha256 = sha256(baseline);
    mkdirSync(resolve(tempRoot, 'baseline'), { recursive: true });
    mkdirSync(resolve(tempRoot, 'review'), { recursive: true });
    writeFileSync(resolve(tempRoot, 'baseline/retired-view.png'), baseline);
    writeFileSync(resolve(tempRoot, 'baseline/active-view.png'), baseline);
    writeFileSync(resolve(tempRoot, 'review/retired-view.png'), baseline);
    writeFileSync(resolve(tempRoot, 'review/active-view.png'), baseline);

    const retirement = {
      version: 1,
      status: 'approved',
      ownerApproval: { date: '2026-11-13', reference: 'owner approval record' },
      replacementSlice: 'F4.1',
      images: [
        {
          id: 'retired-view',
          baselineSha256,
          reason: 'The view is retired by the replacement slice.',
          diff: 'The replacement removes this view from the comparison set.',
          checkedRegions: [
            { name: 'primary content panel', rect: [2, 2, 14, 14] },
          ],
          outsideApprovedRegions: 0,
        },
      ],
    };
    const withoutImageField = (field) => {
      const image = { ...retirement.images[0] };
      delete image[field];
      return { ...retirement, images: [image] };
    };
    run({ index, tempRoot, retirement, withoutImageField });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const invalidRetirementCases = [
  [
    'unknown image ID',
    (retirement) => ({
      ...retirement,
      images: [
        ...retirement.images,
        { ...retirement.images[0], id: 'unknown-view' },
      ],
    }),
  ],
  [
    'duplicate image ID',
    (retirement) => ({
      ...retirement,
      images: [...retirement.images, { ...retirement.images[0] }],
    }),
  ],
  [
    'stale baseline hash',
    (retirement) => ({
      ...retirement,
      images: [{ ...retirement.images[0], baselineSha256: '0'.repeat(64) }],
    }),
  ],
  [
    'blank reason',
    (retirement) => ({
      ...retirement,
      images: [{ ...retirement.images[0], reason: '' }],
    }),
  ],
  [
    'missing reason',
    (retirement, withoutImageField) => withoutImageField('reason'),
  ],
  [
    'blank diff',
    (retirement) => ({
      ...retirement,
      images: [{ ...retirement.images[0], diff: '' }],
    }),
  ],
  [
    'missing diff',
    (retirement, withoutImageField) => withoutImageField('diff'),
  ],
  [
    'empty checked regions',
    (retirement) => ({
      ...retirement,
      images: [{ ...retirement.images[0], checkedRegions: [] }],
    }),
  ],
  [
    'missing checked regions',
    (retirement, withoutImageField) => withoutImageField('checkedRegions'),
  ],
  [
    'nonzero outside-approved-region count',
    (retirement) => ({
      ...retirement,
      images: [{ ...retirement.images[0], outsideApprovedRegions: 1 }],
    }),
  ],
  [
    'invalid owner approval',
    (retirement) => ({
      ...retirement,
      ownerApproval: { date: '2026-11-13', reference: '' },
    }),
  ],
  [
    'impossible approval month',
    (retirement) => ({
      ...retirement,
      ownerApproval: { ...retirement.ownerApproval, date: '2026-99-99' },
    }),
  ],
  [
    'non-leap-year February 29 approval date',
    (retirement) => ({
      ...retirement,
      ownerApproval: { ...retirement.ownerApproval, date: '2025-02-29' },
    }),
  ],
  [
    'negative checked-region coordinates',
    (retirement) => ({
      ...retirement,
      images: [
        {
          ...retirement.images[0],
          checkedRegions: [
            {
              ...retirement.images[0].checkedRegions[0],
              rect: [-1, 2, 14, 14],
            },
          ],
        },
      ],
    }),
  ],
  [
    'zero-width checked region',
    (retirement) => ({
      ...retirement,
      images: [
        {
          ...retirement.images[0],
          checkedRegions: [
            { ...retirement.images[0].checkedRegions[0], rect: [2, 2, 2, 14] },
          ],
        },
      ],
    }),
  ],
  [
    'zero-height checked region',
    (retirement) => ({
      ...retirement,
      images: [
        {
          ...retirement.images[0],
          checkedRegions: [
            { ...retirement.images[0].checkedRegions[0], rect: [2, 2, 14, 2] },
          ],
        },
      ],
    }),
  ],
  [
    'inverted horizontal checked-region axis',
    (retirement) => ({
      ...retirement,
      images: [
        {
          ...retirement.images[0],
          checkedRegions: [
            { ...retirement.images[0].checkedRegions[0], rect: [14, 2, 2, 14] },
          ],
        },
      ],
    }),
  ],
  [
    'inverted vertical checked-region axis',
    (retirement) => ({
      ...retirement,
      images: [
        {
          ...retirement.images[0],
          checkedRegions: [
            { ...retirement.images[0].checkedRegions[0], rect: [2, 14, 14, 2] },
          ],
        },
      ],
    }),
  ],
  [
    'fractional checked-region coordinates',
    (retirement) => ({
      ...retirement,
      images: [
        {
          ...retirement.images[0],
          checkedRegions: [
            {
              ...retirement.images[0].checkedRegions[0],
              rect: [2.5, 2, 14, 14],
            },
          ],
        },
      ],
    }),
  ],
  [
    'unapproved status',
    (retirement) => ({ ...retirement, status: 'awaiting-owner' }),
  ],
];

for (const [caseName, invalidRecord] of invalidRetirementCases) {
  test(`approved retirement rejects ${caseName}`, () => {
    withRetirementFixture(
      ({ index, tempRoot, retirement, withoutImageField }) => {
        assert.throws(
          () =>
            assertIndexedArtifact(index, 'retired-view', tempRoot, {
              mode: 'compare',
              retirements: invalidRecord(retirement, withoutImageField),
            }),
          /retirement/i,
        );
      },
    );
  });
}

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
      environment: {
        os: 'Linux fixture',
        locale: 'en-US',
        timezone: 'Asia/Jakarta',
      },
      generatedAt: '2026-11-05T00:00:00.000Z',
      expectedViewCount: 1,
    });
    assert.equal(manifest.sourceSha, 'b'.repeat(40));
    assert.equal(manifest.viewCount, 1);
    assert.equal(manifest.environment.timezone, 'Asia/Jakarta');
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
    /LEXON_VISUAL_MODE=update pnpm test:e2e [^\n]*--update-snapshots/,
  );
  assert.match(workflow, /LEXON_VISUAL_MODE=compare pnpm test:e2e/);
  // The approval record of the active (F4.1) set decides the mode; the F2.1
  // set is retired and no longer drives CI.
  assert.match(workflow, /docs\/references\/F4\.1-visual\/approval\.json/);
  assert.match(workflow, /docs\/references\/F4\.1-visual\/baseline\/\*\.png/);
});

test('Playwright update snapshots config is the authoritative worker signal', () => {
  assert.equal(isSnapshotUpdateEnabled('changed'), true);
  assert.equal(isSnapshotUpdateEnabled('all'), true);
  assert.equal(isSnapshotUpdateEnabled('missing'), true);
  assert.equal(isSnapshotUpdateEnabled('default'), false);
  assert.equal(isSnapshotUpdateEnabled('none'), false);
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

test('the F4.1 index lists every state in four variants and matches the captures', () => {
  const directory = resolve(root, 'docs/references/F4.1-visual');
  const index = JSON.parse(
    readFileSync(resolve(directory, 'index.json'), 'utf8'),
  );
  const ids = Object.keys(index.views);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const states = new Map();
  for (const [id, view] of Object.entries(index.views)) {
    assert.ok(
      ['desktop', 'mobile'].includes(view.viewport) &&
        ['light', 'dark'].includes(view.theme),
      `${id} has a known viewport and theme`,
    );
    const state = id.slice(0, -`-${view.viewport}-${view.theme}`.length);
    assert.equal(id, `${state}-${view.viewport}-${view.theme}`);
    assert.equal(view.path, `review/${id}.png`);
    states.set(state, [...(states.get(state) ?? []), id]);
  }
  for (const [state, variants] of states)
    assert.deepEqual(
      variants.toSorted(),
      ['desktop', 'mobile']
        .flatMap((viewport) =>
          ['light', 'dark'].map((theme) => `${state}-${viewport}-${theme}`),
        )
        .toSorted(),
      `${state} has the four theme-and-viewport variants`,
    );
  const e2eDirectory = resolve(root, 'backend/test/e2e');
  const source = readdirSync(e2eDirectory)
    .filter((name) => /^brand-visual-.+\.spec\.ts$/.test(name))
    .toSorted()
    .map((name) => readFileSync(resolve(e2eDirectory, name), 'utf8'))
    .join('\n');
  const captured = new Set(
    [...source.matchAll(/captureBrandViews\(\s*page,\s*'([a-z0-9-]+)'/g)].map(
      (match) => match[1],
    ),
  );
  assert.deepEqual([...captured].toSorted(), [...states.keys()].toSorted());
  for (const state of [
    'sign-in',
    'sign-in-field-errors',
    'sign-in-pending',
    'sign-in-form-alert',
    'sign-up',
    'forgot-password',
    'reset-password',
    'verify-email',
    'two-factor',
    'accept-invitation',
    'admin-setup',
    'onboarding',
  ])
    assert.ok(states.has(state), `${state} is indexed`);
});
