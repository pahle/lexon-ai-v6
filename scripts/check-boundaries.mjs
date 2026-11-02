import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    '--test',
    new URL('./test/boundaries.spec.mjs', import.meta.url).pathname,
    new URL('./test/presentation-policy.spec.mjs', import.meta.url).pathname,
    new URL('./test/design-tokens.spec.mjs', import.meta.url).pathname,
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
