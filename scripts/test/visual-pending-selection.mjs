// Selects the real capture for a pending visual id across shard artifacts.
//
// Each shard uploads docs/references/F4.1-visual/review/*.png wholesale: the
// ids it did not capture ship the checked-in review/ bytes from the checkout
// (equal to the approved baseline only for promoted views — review/ can drift
// ahead of baseline/ on pending re-captures). The only authoritative capture
// assignment is the shard's pending.txt, appended by the capture helper
// (backend/test/e2e/brand-visual-support.ts) when it captures the id.
//
// Checks, in order:
//   1. exactly one shard's pending.txt may claim the id;
//   2. the claiming shard's file must exist;
//   3. every non-claiming shard must hold byte-identical files (a second real
//      capture hiding among them could not all be the checked-in copy);
//   4. if the claimed file equals the approved baseline while another shard
//      holds a different file, the pick is a baseline-vs-baseline compare:
//      throw;
//   5. if the claimed file equals the checked-in copy the other shards ship,
//      the claimer never wrote: throw (stale capture claim);
//   6. claimed == baseline && all shards agree → a legitimate byte-identical
//      recapture (identicalToBaseline: true);
//   7. claimed != baseline && no baseline → first-time capture.
// A claimed file that differs from both baseline and the checked-in copy is
// the real capture; staleReviewDrift records that review/ had already moved
// past baseline/ (informational, not a failure).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Lists a shard artifact dir's claimed pending ids (pending.txt). */
export function shardClaimedIds(shardDir) {
  const file = join(shardDir, 'pending.txt');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function shardFiles(captureRoot, id) {
  const out = [];
  for (const shard of readdirSync(captureRoot)) {
    const dir = join(captureRoot, shard);
    if (!existsSync(join(dir, 'pending.txt'))) continue;
    out.push({ shard, dir, path: join(dir, 'review', `${id}.png`) });
  }
  return out;
}

export function selectPendingCapture({ captureRoot, id, baselinePath }) {
  const shards = shardFiles(captureRoot, id);
  if (shards.length === 0)
    throw new Error(`No shard artifact folders under ${captureRoot}`);
  const claimers = shards.filter((s) => shardClaimedIds(s.dir).includes(id));
  if (claimers.length === 0)
    throw new Error(
      `Pending view "${id}" is not claimed by any shard's pending.txt under ${captureRoot}`,
    );
  if (claimers.length > 1)
    throw new Error(
      `Pending view "${id}" claimed by multiple shards: ${claimers
        .map((s) => s.shard)
        .join(', ')}`,
    );
  const claimer = claimers[0];
  if (!existsSync(claimer.path))
    throw new Error(
      `Pending view "${id}": ${claimer.shard} claims it but ${claimer.path} is missing`,
    );

  const claimedBytes = readFileSync(claimer.path);
  const claimedHash = sha256(claimedBytes);
  const others = shards
    .filter((s) => s !== claimer && existsSync(s.path))
    .map((s) => ({ shard: s.shard, hash: sha256(readFileSync(s.path)) }));
  const baselineHash = baselinePath
    ? sha256(readFileSync(baselinePath))
    : null;

  const distinctOthers = [...new Set(others.map((o) => o.hash))];
  if (distinctOthers.length > 1)
    throw new Error(
      `Pending view "${id}": conflicting captures — non-claiming shards disagree ` +
        `(${others.map((o) => `${o.shard}=${o.hash.slice(0, 10)}`).join(', ')})`,
    );
  // R: the checked-in copy every non-claimer ships; null when no shard has
  // the file (first-time views).
  const checkedInHash = distinctOthers[0] ?? null;
  if (
    baselineHash &&
    claimedHash === baselineHash &&
    distinctOthers.some((hash) => hash !== baselineHash)
  )
    throw new Error(
      `Pending view "${id}": baseline bytes in claiming shard ${claimer.shard} while ` +
        `${others.find((o) => o.hash !== baselineHash).shard} holds a different file — ` +
        `baseline-vs-baseline compare is not a real capture`,
    );
  // Claimed == checked-in copy: a genuine recapture that reproduced the
  // checked-in bytes (view unchanged since that file was written). It is
  // flagged rather than trusted silently — a crash between the pending.txt
  // append and the screenshot would leave the same signature, and the sheet
  // still diffs these bytes against the approved baseline for review.
  if (checkedInHash && claimedHash === checkedInHash)
    return {
      path: claimer.path,
      shard: claimer.shard,
      identicalToBaseline: baselineHash !== null && claimedHash === baselineHash,
      identicalToCheckedIn: true,
      staleReviewDrift:
        baselineHash !== null && checkedInHash !== baselineHash,
    };

  return {
    path: claimer.path,
    shard: claimer.shard,
    identicalToBaseline: baselineHash !== null && claimedHash === baselineHash,
    identicalToCheckedIn: false,
    staleReviewDrift:
      baselineHash !== null &&
      checkedInHash !== null &&
      checkedInHash !== baselineHash,
  };
}
