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
    ...(source.match(/[A-Za-z0-9._+-]+@example\.test/g) ?? []),
    ...[...source.matchAll(/slug:\s*'([^']+)'/g)].map((m) => 'slug ' + m[1]),
  ]);

test('brand-visual fixed addresses and slugs are unique within the e2e specs', () => {
  const own = fixedAddresses(read('brand-visual.spec.ts'));
  assert.ok(own.size > 0, 'brand-visual.spec.ts has fixed addresses');
  const others = readdirSync(e2eDirectory).filter(
    (name) => name.endsWith('.ts') && name !== 'brand-visual.spec.ts',
  );
  const shared = [];
  for (const name of others)
    for (const address of fixedAddresses(read(name)))
      if (own.has(address)) shared.push(`${address} (also in ${name})`);
  assert.deepEqual(shared, []);
});
