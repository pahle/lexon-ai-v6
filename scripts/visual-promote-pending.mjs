// Writes owner-approved pending captures back into the visual set.
//
// For every approved id the real capture is selected with
// selectPendingCapture (same shard-authoritative selection the review packet
// used) and written to both the indexed review path and the baseline path
// (view.path with review/ -> baseline/). approval.json gains or refreshes the
// images entry and records one amendment for the batch; the ids leave
// index.pending. Non-pixel-locked ids (svg-snapshot, engine-tests) may only be
// cleared from pending — they never get a baseline file or an images entry
// (guarded by the baseline-lock spec).
//
//   node scripts/visual-promote-pending.mjs --set F4.1-visual \
//     --shards-dir <dir of shard folders> --approve-file ids.txt \
//     --clear-file ids.txt --amendment-reference "..." \
//     --amendment-source-sha <sha> --amendment-date YYYY-MM-DD
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectPendingCapture } from './visual-pending-selection.mjs';
import { isPixelLocked } from './visual-mode.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function promotePendingApprovals({
  setDir,
  captureRoot,
  approveIds,
  clearOnlyIds = [],
  amendment,
}) {
  const indexPath = resolve(setDir, 'index.json');
  const approvalPath = resolve(setDir, 'approval.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
  const pending = new Set(index.pending ?? []);
  const requested = [...approveIds, ...clearOnlyIds];
  const notPending = requested.find((id) => !pending.has(id));
  if (notPending)
    throw new Error(`Visual view "${notPending}" is not pending.`);
  const overlap = approveIds.find((id) => clearOnlyIds.includes(id));
  if (overlap)
    throw new Error(`Visual view "${overlap}" is both approved and cleared.`);

  for (const id of approveIds) {
    const view = index.views[id];
    if (!view) throw new Error(`Pending view "${id}" is not in the index.`);
    if (!isPixelLocked(view))
      throw new Error(
        `Pending view "${id}" is ${view.lock} locked and cannot gain a pixel baseline.`,
      );
  }
  for (const id of clearOnlyIds) {
    const view = index.views[id];
    if (view && isPixelLocked(view))
      throw new Error(
        `Pending view "${id}" is pixel locked: approve a baseline instead of clearing it.`,
      );
  }

  approval.images = approval.images ?? {};
  for (const id of approveIds) {
    const view = index.views[id];
    const baselineRelative = view.path.replace(/^review\//, 'baseline/');
    const pick = selectPendingCapture({
      captureRoot,
      id,
      baselinePath: existsSync(resolve(setDir, baselineRelative))
        ? resolve(setDir, baselineRelative)
        : null,
    });
    const bytes = readFileSync(pick.path);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const viewport = index.viewports[view.viewport];
    if (
      !viewport ||
      viewport.width !== width ||
      viewport.height !== height ||
      index.deviceScaleFactor !== 1
    )
      throw new Error(
        `Pending view "${id}" capture dimensions ${width}x${height} do not match its viewport.`,
      );
    writeFileSync(resolve(setDir, view.path), bytes);
    writeFileSync(resolve(setDir, baselineRelative), bytes);
    approval.images[id] = {
      path: view.path,
      sha256: sha256(bytes),
      width,
      height,
      deviceScaleFactor: index.deviceScaleFactor,
    };
  }
  for (const id of clearOnlyIds) {
    const pick = selectPendingCapture({
      captureRoot,
      id,
      baselinePath: null,
    });
    writeFileSync(
      resolve(setDir, index.views[id].path),
      readFileSync(pick.path),
    );
  }

  // A full re-baseline supersedes a noise-only re-approval: review/ and
  // baseline/ now both carry the newly approved capture, so the recorded
  // previousSha256 no longer describes either file.
  if (approval.reapproved) {
    const kept = approval.reapproved.filter(
      (entry) => !approveIds.includes(entry.id),
    );
    if (kept.length === 0) delete approval.reapproved;
    else approval.reapproved = kept;
  }

  const remaining = (index.pending ?? []).filter(
    (id) => !requested.includes(id),
  );
  if (remaining.length === 0) delete index.pending;
  else index.pending = remaining;
  approval.amendments = [
    ...(approval.amendments ?? []),
    { ...amendment, viewIds: [...approveIds] },
  ];
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + '\n');
  return { approved: [...approveIds], cleared: [...clearOnlyIds] };
}

function readIdsFile(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const setDir = resolve(
    import.meta.dirname,
    '..',
    'docs/references',
    value('--set') ?? 'F4.1-visual',
  );
  const out = promotePendingApprovals({
    setDir,
    captureRoot: resolve(value('--shards-dir')),
    approveIds: readIdsFile(value('--approve-file')),
    clearOnlyIds: value('--clear-file')
      ? readIdsFile(value('--clear-file'))
      : [],
    amendment: {
      reference: value('--amendment-reference'),
      date: value('--amendment-date'),
      sourceSha: value('--amendment-source-sha'),
    },
  });
  console.log(
    `promoted ${out.approved.length} approved ids, cleared ${out.cleared.length}`,
  );
}
