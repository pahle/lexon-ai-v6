import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Committed snapshots of the indicator's SVG markup, one string per visual
 * view id. The file is `{ "version": 1, "snapshots": { "<id>": "<markup>" } }`
 * with ids in sorted order. A check compares by string equality on every
 * platform; only an explicit update (LEXON_SVG_SNAPSHOT_UPDATE=1) writes.
 */
export function isSvgSnapshotUpdate(env = process.env) {
  return env.LEXON_SVG_SNAPSHOT_UPDATE === '1';
}

function read(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed.version !== 1 || typeof parsed.snapshots !== 'object')
    throw new Error(`SVG snapshot file is invalid: ${file}`);
  return parsed;
}

export function checkSvgSnapshot({ file, id, markup, update }) {
  if (update) {
    const stored = existsSync(file)
      ? read(file)
      : { version: 1, snapshots: {} };
    stored.snapshots[id] = markup;
    stored.snapshots = Object.fromEntries(
      Object.entries(stored.snapshots).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
    writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
    return;
  }
  if (!existsSync(file))
    throw new Error(
      `The SVG snapshot file is missing: ${file}. Write it with LEXON_SVG_SNAPSHOT_UPDATE=1.`,
    );
  const stored = read(file);
  if (!Object.hasOwn(stored.snapshots, id))
    throw new Error(`The SVG snapshot file has no entry for "${id}".`);
  if (stored.snapshots[id] !== markup)
    throw new Error(
      `The indicator SVG for "${id}" differs from the committed snapshot.\n` +
        `committed: ${stored.snapshots[id]}\nactual:    ${markup}`,
    );
}

/** The markup of a frozen frame must not change between two reads. */
export function assertStableSvgRead(id, first, second) {
  if (first !== second)
    throw new Error(
      `The indicator SVG for "${id}" changed between two reads of the same frame.\n` +
        `first:  ${first}\nsecond: ${second}`,
    );
}
