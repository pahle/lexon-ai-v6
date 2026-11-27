import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function isSnapshotUpdateEnabled(updateSnapshots) {
  return ['all', 'changed', 'missing'].includes(updateSnapshots);
}

/**
 * An index view is a pixel golden unless it carries a `lock`. Its screenshot
 * is then captured for owner review only, and the regression lock is:
 * - "svg-snapshot": a committed SVG snapshot (scripts/svg-snapshot.mjs);
 * - "engine-tests": none at the page level; the frame is covered by the
 *   engine unit tests and the timeline fixture guard.
 */
export function isPixelLocked(view) {
  if (view.lock === undefined) return true;
  if (view.lock === 'svg-snapshot' || view.lock === 'engine-tests')
    return false;
  throw new Error(`Unknown visual lock "${view.lock}".`);
}

/**
 * True when a view's indicator SVG is compared with the committed snapshot:
 * every view except one locked by the engine tests alone. A pixel-locked view
 * (indicator-finished) keeps its golden and also has a snapshot.
 */
export function hasSvgSnapshot(view) {
  return view.lock !== 'engine-tests';
}

/** The index views that are pixel goldens, as an id-to-view object. */
export function pixelLockedViews(index) {
  return Object.fromEntries(
    Object.entries(index.views).filter(([, view]) => isPixelLocked(view)),
  );
}

/**
 * Every file under baseline/ must be the pixel golden of an indexed,
 * pixel-locked view. A non-pixel lock (svg-snapshot, engine-tests) has no
 * pixel golden by design; a baseline file for it would silently pass
 * byte-existence checks while never being a sanctioned golden.
 */
export function assertBaselineLocks(index, directory) {
  const baselineDir = resolve(directory, 'baseline');
  if (!existsSync(baselineDir)) return;
  for (const file of readdirSync(baselineDir)) {
    if (!file.endsWith('.png')) continue;
    const id = file.slice(0, -'.png'.length);
    const view = index.views[id];
    if (!view)
      throw new Error(
        `baseline/${file} has no indexed view; remove it or index the view first.`,
      );
    if (!isPixelLocked(view))
      throw new Error(
        `baseline/${file} exists but view "${id}" is ${view.lock} locked and has no pixel golden.`,
      );
  }
}

/**
 * Index views awaiting owner approval (an explicit, reviewed `pending` list in
 * the visual index). A pending view is captured for review and listed, never
 * compared with a golden, and needs no approval entry.
 */
export function pendingViewIds(index) {
  return index.pending ?? [];
}

export function isPendingView(index, id) {
  return pendingViewIds(index).includes(id);
}

/**
 * Index views drawn in the prototype but not built yet (an explicit `planned`
 * list in the visual index). A planned view is never captured, never
 * compared, and has no approval entry. The slice that builds it moves each id
 * from `planned` to `pending` when it captures it.
 */
export function plannedViewIds(index) {
  return index.planned ?? [];
}

export function isPlannedView(index, id) {
  return plannedViewIds(index).includes(id);
}

/** `pending` and `planned` name indexed views, once each, never both. */
export function assertVisualIndexLists(index) {
  const pending = new Set(pendingViewIds(index));
  const seen = new Set();
  for (const id of plannedViewIds(index)) {
    if (!index.views?.[id])
      throw new Error(
        `Planned visual view "${id}" is not present in the visual index.`,
      );
    if (seen.has(id))
      throw new Error(`Planned visual view "${id}" is listed twice.`);
    if (pending.has(id))
      throw new Error(`Visual view "${id}" is both planned and pending.`);
    seen.add(id);
  }
}

export const DEFAULT_VISUAL_SET = 'F4.1-visual';

/** The directory of a visual set under docs/references (default: F4.1). */
export function visualSetDirectory(
  set = process.env.LEXON_VISUAL_SET ?? DEFAULT_VISUAL_SET,
  root = process.cwd(),
) {
  if (!/^F\d+(\.\d+)?-visual$/.test(set))
    throw new Error(`Unknown visual set: ${set}`);
  return resolve(root, 'docs/references', set);
}

/**
 * Recapturing an image invalidates its recorded approval (F4 follow-up M3).
 * Returns a new approval record: every approved image whose recaptured hash
 * differs loses its approved entry, is listed under `invalidated`, and the
 * set returns to awaiting-owner, which refuses compare and update modes.
 */
/**
 * The hash a review image had when the owner approved it. A re-approved image
 * keeps its review hash; its golden carries the new hash (`images[id]`).
 */
export function approvedReviewSha256(approval, id) {
  return (
    approval.reapproved?.find((entry) => entry.id === id)?.previousSha256 ??
    approval.images?.[id]?.sha256
  );
}

export function invalidateRecapturedApproval(approval, capturedImages) {
  if (approval.status !== 'approved') return { approval, invalidated: [] };
  const changed = Object.entries(approval.images ?? {}).filter(
    ([id]) =>
      capturedImages[id] !== undefined &&
      capturedImages[id].sha256 !== approvedReviewSha256(approval, id),
  );
  if (changed.length === 0) return { approval, invalidated: [] };
  const invalidated = changed.map(([id]) => id);
  return {
    invalidated,
    approval: {
      ...approval,
      status: 'awaiting-owner',
      images: Object.fromEntries(
        Object.entries(approval.images).filter(
          ([id]) => !invalidated.includes(id),
        ),
      ),
      invalidated: [
        ...(approval.invalidated ?? []),
        ...changed.map(([id, image]) => ({
          id,
          approvedSha256: image.sha256,
          recapturedSha256: capturedImages[id].sha256,
        })),
      ],
    },
  };
}

/** An approval must come from a commit in the current history. */
export function assertApprovalSourceReachable(approval, isAncestor) {
  if (!isAncestor(approval.sourceSha))
    throw new Error(
      `Approved visual source ${approval.sourceSha} is not an ancestor of the current commit.`,
    );
}

export function resolveVisualMode({
  explicitMode = process.env.LEXON_VISUAL_MODE,
  approvalPath = resolve('docs/references/F4.1-visual/approval.json'),
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
  { mode, baselineDirectory = 'baseline', retirements },
) {
  const view = index.views?.[id];
  if (!view) throw new Error(`Visual index has no entry for view "${id}".`);
  if (isPlannedView(index, id))
    throw new Error(
      `Visual view "${id}" is planned: it is not built yet. Capture it only after you move it from planned to pending.`,
    );
  assertReviewPath(id, view.path, directory, 'review');
  if (mode !== 'capture' && !isPixelLocked(view)) return null;
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
  if (mode === 'compare' && retirements !== undefined) {
    validateRetirements(index, retirements, directory, baselineDirectory);
    if (retirements.images.some((image) => image.id === id)) return null;
  }
  return artifactPath;
}

function validateRetirements(index, record, directory, baselineDirectory) {
  const approvalDate = new Date(record?.ownerApproval?.date);
  if (
    record?.version !== 1 ||
    record.status !== 'approved' ||
    !record.ownerApproval ||
    typeof record.ownerApproval.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.ownerApproval.date) ||
    typeof record.ownerApproval.reference !== 'string' ||
    !record.ownerApproval.reference.trim() ||
    !Number.isFinite(approvalDate.getTime()) ||
    approvalDate.toISOString().slice(0, 10) !== record.ownerApproval.date ||
    record.replacementSlice !== 'F4.1' ||
    !Array.isArray(record.images) ||
    record.images.length === 0
  ) {
    throw new Error('Visual retirement record is invalid or incomplete.');
  }

  const seen = new Set();
  for (const image of record.images) {
    if (!image || typeof image.id !== 'string') {
      throw new Error('Visual retirement image is invalid or incomplete.');
    }
    const view = index.views?.[image.id];
    if (!view || seen.has(image.id)) {
      throw new Error(
        `Visual retirement image "${image.id}" is unknown or duplicated.`,
      );
    }
    seen.add(image.id);
    assertReviewPath(image.id, view.path, directory, 'review');
    const relativePath = view.path.replace(
      /^review\//,
      `${baselineDirectory}/`,
    );
    const artifactPath = resolve(directory, relativePath);
    const artifactRoot = resolve(directory, baselineDirectory);
    const safeRelativePath = relative(artifactRoot, artifactPath);
    if (
      safeRelativePath === '' ||
      safeRelativePath.startsWith(`..${sep}`) ||
      safeRelativePath === '..' ||
      isAbsolute(safeRelativePath)
    ) {
      throw new Error(
        `Visual retirement image "${image.id}" resolves outside ${baselineDirectory}/.`,
      );
    }
    if (
      !existsSync(artifactPath) ||
      !/^[a-f0-9]{64}$/.test(image.baselineSha256) ||
      createHash('sha256').update(readFileSync(artifactPath)).digest('hex') !==
        image.baselineSha256
    ) {
      throw new Error(
        `Visual retirement image "${image.id}" has a missing or stale baseline SHA-256.`,
      );
    }
    if (
      typeof image.reason !== 'string' ||
      !image.reason.trim() ||
      typeof image.diff !== 'string' ||
      !image.diff.trim() ||
      !Array.isArray(image.checkedRegions) ||
      image.checkedRegions.length === 0 ||
      image.checkedRegions.some(
        (region) =>
          typeof region?.name !== 'string' ||
          !region.name.trim() ||
          !Array.isArray(region.rect) ||
          region.rect.length !== 4 ||
          region.rect.some(
            (coordinate) => !Number.isInteger(coordinate) || coordinate < 0,
          ) ||
          region.rect[2] <= region.rect[0] ||
          region.rect[3] <= region.rect[1],
      ) ||
      image.outsideApprovedRegions !== 0
    ) {
      throw new Error(
        `Visual retirement image "${image.id}" is invalid or incomplete.`,
      );
    }
  }
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

  assertVisualIndexLists(index);
  const plannedWithApproval = plannedViewIds(index).find(
    (id) => approval.images?.[id],
  );
  if (plannedWithApproval)
    throw new Error(
      `Planned visual view "${plannedWithApproval}" has an approval entry.`,
    );
  const pending = pendingViewIds(index);
  const unknownPending = pending.find((id) => !index.views[id]);
  if (unknownPending)
    throw new Error(
      `Pending visual view "${unknownPending}" is not present in the visual index.`,
    );
  const indexedViews = Object.entries(index.views).filter(
    ([id, view]) =>
      view.path?.startsWith('review/') &&
      isPixelLocked(view) &&
      !pending.includes(id) &&
      !isPlannedView(index, id),
  );
  const approvedUnlocked = Object.keys(approval.images ?? {}).find(
    (id) => index.views[id] && !isPixelLocked(index.views[id]),
  );
  if (approvedUnlocked)
    throw new Error(
      `Approved visual image "${approvedUnlocked}" is ${index.views[approvedUnlocked].lock} locked and has no pixel golden.`,
    );
  if (indexedViews.length !== expectedViewCount) {
    throw new Error(
      `Visual index has ${indexedViews.length} review views; expected ${expectedViewCount}.`,
    );
  }
  const approvedIds = Object.keys(approval.images).filter(
    (id) => !pending.includes(id),
  );
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
    assertPng(
      reviewPath,
      { ...expected, sha256: approvedReviewSha256(approval, id) },
      id,
      'approved review artifact',
    );
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
    ...(approval.reapproved ? { reapproved: approval.reapproved } : {}),
    ...(approval.deviations ? { deviations: approval.deviations } : {}),
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
    approval.deviations !== undefined &&
    (!Array.isArray(approval.deviations) ||
      approval.deviations.some(
        (row) =>
          typeof row.id !== 'string' ||
          !row.id ||
          typeof row.variant !== 'string' ||
          !/^(d|m)(-dark)?$/.test(row.variant) ||
          typeof row.percent !== 'number' ||
          typeof row.reason !== 'string' ||
          !row.reason.trim(),
      ))
  ) {
    throw new Error('Approved visual deviations are invalid.');
  }
  if (
    approval.reapproved !== undefined &&
    (!Array.isArray(approval.reapproved) ||
      approval.reapproved.some(
        (entry) =>
          typeof entry.id !== 'string' ||
          !/^[a-f\d]{64}$/.test(entry.sha256 ?? '') ||
          !/^[a-f\d]{64}$/.test(entry.previousSha256 ?? '') ||
          entry.sha256 === entry.previousSha256 ||
          approval.images?.[entry.id]?.sha256 !== entry.sha256 ||
          !Number.isInteger(entry.evidence?.pixels) ||
          typeof entry.decision !== 'string' ||
          !entry.decision.trim(),
      ))
  ) {
    throw new Error('Approved visual re-approvals are invalid.');
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
