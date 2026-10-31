import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
it('exports exactly one public backend evaluation entry', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  expect(Object.keys(manifest.exports)).toEqual(['./evaluation']);
  expect(manifest.exports['./evaluation'].import).toBe(
    './dist/evaluation/index.js',
  );
});
