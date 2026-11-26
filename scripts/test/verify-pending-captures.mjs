// merge-e2e's pending-capture gate.
//
// Verifies every index.json `pending` view id was captured by some shard:
// the shard's pending.txt must claim it AND the claimed review file must
// exist in that shard's artifact (the capture helper appends pending.txt
// before the screenshot — a crash can leave a claim without a file, so
// coverage alone is not proof).
//
//   node scripts/test/verify-pending-captures.mjs \
//     [--index docs/references/F4.1-visual/index.json] \
//     [--shards-dir pending-shards]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyPendingCaptures({ indexPath, shardsDir }) {
  const pending = JSON.parse(readFileSync(indexPath, 'utf8')).pending ?? [];
  const claimedBy = new Map();
  if (existsSync(shardsDir))
    for (const shard of readdirSync(shardsDir)) {
      const file = join(shardsDir, shard, 'pending.txt');
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const id = line.trim();
        if (id) claimedBy.set(id, shard);
      }
    }
  const missing = pending.filter((id) => !claimedBy.has(id));
  if (missing.length > 0)
    throw new Error(`No shard captured pending views: ${missing.join(', ')}`);
  const missingFiles = pending
    .map((id) => ({ id, shard: claimedBy.get(id) }))
    .filter(
      ({ id, shard }) =>
        !existsSync(join(shardsDir, shard, 'review', `${id}.png`)),
    );
  if (missingFiles.length > 0)
    throw new Error(
      `Pending views claimed but the capture file is missing: ${missingFiles
        .map(({ id, shard }) => `${id} (${shard}/review/${id}.png)`)
        .join(', ')}`,
    );
  return { pending: pending.length, claimed: claimedBy.size };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = { index: null, shardsDir: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1)
    if (argv[i] === '--index') args.index = argv[++i];
    else if (argv[i] === '--shards-dir') args.shardsDir = argv[++i];
  try {
    const result = verifyPendingCaptures({
      indexPath: resolve(
        args.index ?? 'docs/references/F4.1-visual/index.json',
      ),
      shardsDir: resolve(args.shardsDir ?? 'pending-shards'),
    });
    console.log(
      `pending captures verified: ${result.claimed}/${result.pending} claimed with files`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
