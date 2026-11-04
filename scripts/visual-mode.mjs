import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function resolveVisualMode({
  explicitMode = process.env.LEXON_VISUAL_MODE,
  approvalPath = resolve('docs/references/F2.1-visual/approval.json'),
  updateSnapshots = process.argv.includes('--update-snapshots'),
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
  const relativePath = view.path.replace(/^review\//, `${baselineDirectory}/`);
  const artifactPath = resolve(directory, relativePath);
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Visual artifact for view "${id}" is missing: ${artifactPath}`,
    );
  }
  return artifactPath;
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
