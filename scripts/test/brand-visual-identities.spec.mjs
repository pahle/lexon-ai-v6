import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// In CI every Playwright project shares one stack. A second sign-up of an
// address returns 200 without sending a new verification mail (no account
// enumeration), so a fixed address used by two specs breaks the later one.
const e2eDirectory = new URL('../../backend/test/e2e/', import.meta.url);
const read = (name) => readFileSync(new URL(name, e2eDirectory), 'utf8');
// Fixed identities: example.test addresses and quoted organization slugs.
// An organization slug is unique, so a second create returns an error.
const fixedAddresses = (source) =>
  new Set([
    ...(source.match(/[A-Za-z0-9._+-]+@(?:example\.test|[a-z-]+\.co\.id)/g) ??
      []),
    ...[...source.matchAll(/slug:\s*'([^']+)'/g)].map((m) => 'slug ' + m[1]),
  ]);

test('brand-visual fixed addresses and slugs are unique within the e2e specs', () => {
  const isBrandVisual = (name) =>
    /^(brand-visual-.+|prototype-fixtures)\.(spec\.)?ts$/.test(name);
  const ownFiles = readdirSync(e2eDirectory).filter(isBrandVisual);
  const own = new Set(
    ownFiles.flatMap((name) => [...fixedAddresses(read(name))]),
  );
  assert.ok(own.size > 0, 'the brand-visual specs have fixed addresses');
  const others = readdirSync(e2eDirectory).filter(
    (name) => name.endsWith('.ts') && !isBrandVisual(name),
  );
  const shared = [];
  for (const name of others)
    for (const address of fixedAddresses(read(name)))
      if (own.has(address)) shared.push(`${address} (also in ${name})`);
  // Known: chat-states.spec.ts registers the prototype slug first; the team
  // world falls back to a suffixed slug when it is taken (brand-visual-world.ts).
  const knownCollisions = new Set([
    'slug hukum-nusantara (also in chat-states.spec.ts)',
  ]);
  assert.deepEqual(
    shared.filter((entry) => !knownCollisions.has(entry)),
    [],
  );
});
