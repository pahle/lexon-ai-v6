import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function isSnapshotUpdateEnabled(updateSnapshots) {
  return ['all', 'changed', 'missing'].includes(updateSnapshots);
}

export function resolveVisualMode({
  explicitMode = process.env.LEXON_VISUAL_MODE,
  approvalPath = resolve('docs/references/F2.1-visual/approval.json'),
  updateSnapshots = process.argv.includes('--update-snapshots'),
  runtime = { ci: process.env.CI === 'true', platform: process.platform },
} = {}) {
  if (!existsSync(approvalPath))
    throw new Error(`Missing visual approval record: ${approvalPath}`);
  const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
  if (
    approval.version !== 1 ||
    !['awaiting-owner', 'approved'].includes(approval.status)
  ) {
    throw new Error(
      'Visual approval must have version 1 and status awaiting-owner or approved.',
    );
  }
  if (approval.status === 'approved') validateApprovedRecord(approval);
  const mode =
    explicitMode ??
    (approval.status === 'awaiting-owner' ? 'capture' : 'compare');
  if (!['capture', 'compare', 'update'].includes(mode)) {
    throw new Error(`Unknown LEXON_VISUAL_MODE: ${mode}`);
  }
  if (mode === 'compare' && approval.status !== 'approved') {
    throw new Error('Visual comparison requires recorded owner approval.');
  }
  if (
    mode === 'update' &&
    (approval.status !== 'approved' || !updateSnapshots)
  ) {
    throw new Error(
      'Visual baseline update requires owner approval and --update-snapshots.',
    );
  }
  if (mode === 'update' && (!runtime.ci || runtime.platform !== 'linux')) {
    throw new Error('Visual baseline update requires a Linux CI runner.');
  }
  if (mode !== 'update' && updateSnapshots) {
    throw new Error(
      '--update-snapshots is allowed only with LEXON_VISUAL_MODE=update.',
    );
  }
  return mode;
}

export function assertReviewArtifact(index, id, directory) {
  const view = index.views?.[id];
  if (!view) throw new Error(`Visual index has no entry for view "${id}".`);
  return assertReviewPath(id, view.path, directory, 'review');
}

export function assertIndexedArtifact(
  index,
  id,
  directory,
  { mode, baselineDirectory = 'baseline' },
) {
  const view = index.views?.[id];
  if (!view) throw new Error(`Visual index has no entry for view "${id}".`);
  assertReviewPath(id, view.path, directory, 'review');
  const relativePath =
    mode === 'capture'
      ? view.path
      : view.path.replace(/^review\//, `${baselineDirectory}/`);
  const artifactPath = resolve(directory, relativePath);
  const artifactRoot = resolve(
    directory,
    mode === 'capture' ? 'review' : baselineDirectory,
  );
  const safeRelativePath = relative(artifactRoot, artifactPath);
  if (
    safeRelativePath === '' ||
    safeRelativePath.startsWith(`..${sep}`) ||
    safeRelativePath === '..' ||
    isAbsolute(safeRelativePath)
  ) {
    throw new Error(
      `Visual artifact for view "${id}" resolves outside ${mode === 'capture' ? 'review' : baselineDirectory}/.`,
    );
  }
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Visual artifact for view "${id}" is missing: ${artifactPath}`,
    );
  }
  return artifactPath;
}

export function assertApprovedVisualSet(
  index,
  approval,
  directory,
  { requireBaselines = true, expectedViewCount = 82 } = {},
) {
  validateApprovedRecord(approval);
  if (
    index.version !== 1 ||
    index.format !== 'png' ||
    index.deviceScaleFactor !== 1 ||
    !index.views ||
    !index.viewports
  ) {
    throw new Error(
      'Visual index is invalid for approved baseline comparison.',
    );
  }

  const indexedViews = Object.entries(index.views).filter(([, view]) =>
    view.path?.startsWith('review/'),
  );
  if (indexedViews.length !== expectedViewCount) {
    throw new Error(
      `Visual index has ${indexedViews.length} review views; expected ${expectedViewCount}.`,
    );
  }
  const approvedIds = Object.keys(approval.images);
  const indexedIds = indexedViews.map(([id]) => id);
  const extra = approvedIds.filter((id) => !index.views[id]);
  if (extra.length > 0) {
    throw new Error(
      `Approved visual image "${extra[0]}" is not present in the visual index.`,
    );
  }
  const missing = indexedIds.filter((id) => !approval.images[id]);
  if (missing.length > 0) {
    throw new Error(
      `Approved visual record is missing indexed view "${missing[0]}".`,
    );
  }
  if (approvedIds.length !== indexedIds.length) {
    throw new Error(
      'Approved visual record does not match the indexed view set.',
    );
  }

  for (const [id, view] of indexedViews) {
    const expected = approval.images[id];
    const viewport = index.viewports[view.viewport];
    if (!viewport || expected.path !== view.path) {
      throw new Error(
        `Approved visual record for "${id}" has an invalid index path or viewport.`,
      );
    }
    if (
      expected.width !== viewport.width ||
      expected.height !== viewport.height ||
      expected.deviceScaleFactor !== index.deviceScaleFactor
    ) {
      throw new Error(
        `Approved visual record for "${id}" has invalid dimensions or device scale factor.`,
      );
    }
    const reviewPath = resolveApprovedPath(
      directory,
      expected.path,
      'review',
      id,
    );
    assertPng(reviewPath, expected, id, 'approved review artifact');
    if (requireBaselines) {
      const baselinePath = resolveApprovedPath(
        directory,
        expected.path.replace(/^review\//, 'baseline/'),
        'baseline',
        id,
      );
      assertPng(baselinePath, expected, id, 'baseline');
    }
  }
  return indexedViews.length;
}

export function buildVisualBaselineManifest(
  index,
  approval,
  directory,
  {
    sourceSha,
    environment,
    generatedAt = new Date().toISOString(),
    approvalSha256 = createHash('sha256')
      .update(JSON.stringify(approval))
      .digest('hex'),
    indexSha256 = createHash('sha256')
      .update(JSON.stringify(index))
      .digest('hex'),
    expectedViewCount = 82,
  },
) {
  const viewCount = assertApprovedVisualSet(index, approval, directory, {
    expectedViewCount,
  });
  return {
    version: 1,
    sourceSha,
    generatedAt,
    approvalSha256,
    indexSha256,
    environment,
    viewCount,
    images: Object.fromEntries(
      Object.entries(approval.images).map(([id, image]) => [
        id,
        {
          path: image.path.replace(/^review\//, 'baseline/'),
          sha256: image.sha256,
          width: image.width,
          height: image.height,
          deviceScaleFactor: image.deviceScaleFactor,
        },
      ]),
    ),
  };
}

function validateApprovedRecord(approval) {
  if (
    approval.version !== 1 ||
    approval.status !== 'approved' ||
    !/^[a-f\d]{40}$/i.test(approval.sourceSha ?? '') ||
    typeof approval.ownerApproval?.reference !== 'string' ||
    !approval.ownerApproval.reference.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(approval.ownerApproval.date ?? '') ||
    typeof approval.environment?.os !== 'string' ||
    !/^Linux\b/.test(approval.environment.os) ||
    typeof approval.environment?.browser !== 'string' ||
    !approval.environment.browser.trim() ||
    approval.environment.playwright !== '1.64.1' ||
    typeof approval.environment.node !== 'string' ||
    approval.environment.locale !== 'en-US' ||
    approval.environment.timezone !== 'Asia/Jakarta' ||
    !approval.images ||
    typeof approval.images !== 'object' ||
    Array.isArray(approval.images)
  ) {
    throw new Error('Approved visual record is invalid or incomplete.');
  }
  if (approval.originalApproval) {
    if (
      !/^[a-f\d]{40}$/i.test(approval.originalApproval.sourceSha ?? '') ||
      !/^[a-f\d]{40}$/i.test(approval.originalApproval.manifestCommit ?? '') ||
      typeof approval.originalApproval.reference !== 'string' ||
      !approval.originalApproval.reference.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(approval.originalApproval.date ?? '')
    ) {
      throw new Error(
        'Approved visual original approval provenance is invalid.',
      );
    }
  }
  if (
    approval.amendments !== undefined &&
    (!Array.isArray(approval.amendments) ||
      approval.amendments.some(
        (amendment) =>
          typeof amendment.reference !== 'string' ||
          !amendment.reference.trim() ||
          !/^\d{4}-\d{2}-\d{2}$/.test(amendment.date ?? '') ||
          !/^[a-f\d]{40}$/i.test(amendment.sourceSha ?? '') ||
          !Array.isArray(amendment.viewIds) ||
          amendment.viewIds.length === 0,
      ))
  ) {
    throw new Error('Approved visual amendment provenance is invalid.');
  }
}

function resolveApprovedPath(directory, indexedPath, root, id) {
  const expectedPrefix = `${root}/`;
  if (
    typeof indexedPath !== 'string' ||
    !indexedPath.startsWith(expectedPrefix)
  ) {
    throw new Error(
      `Approved visual artifact for "${id}" must target ${root}/.`,
    );
  }
  const rootPath = resolve(directory, root);
  const artifactPath = resolve(directory, indexedPath);
  const safeRelativePath = relative(rootPath, artifactPath);
  if (
    safeRelativePath === '' ||
    safeRelativePath.startsWith(`..${sep}`) ||
    safeRelativePath === '..' ||
    isAbsolute(safeRelativePath)
  ) {
    throw new Error(
      `Approved visual artifact for "${id}" resolves outside ${root}/.`,
    );
  }
  return artifactPath;
}

function assertPng(path, expected, id, artifactName) {
  if (!existsSync(path)) {
    throw new Error(
      `Approved visual view "${id}" ${artifactName} is missing: ${path}`,
    );
  }
  const bytes = readFileSync(path);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error(
      `Approved visual view "${id}" ${artifactName} is not a valid PNG.`,
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== expected.width || height !== expected.height) {
    throw new Error(
      `Approved visual view "${id}" ${artifactName} has invalid dimensions ${width}x${height}; expected ${expected.width}x${expected.height}.`,
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected.sha256) {
    throw new Error(
      `Approved visual view "${id}" ${artifactName} sha256 does not match the approved record.`,
    );
  }
}

function assertReviewPath(id, indexedPath, directory, expectedRoot) {
  if (!indexedPath.startsWith(`${expectedRoot}/`)) {
    throw new Error(
      `Visual view "${id}" must target ${expectedRoot}/ artifacts; refusing "${indexedPath}".`,
    );
  }
  const root = resolve(directory, expectedRoot);
  const artifact = resolve(directory, indexedPath);
  const relativePath = relative(root, artifact);
  if (
    relativePath === '' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === '..' ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `Visual view "${id}" resolves outside ${expectedRoot}/: ${indexedPath}`,
    );
  }
  return artifact;
}
