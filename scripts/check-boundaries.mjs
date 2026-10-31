import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--test', new URL('./test/boundaries.spec.mjs', import.meta.url).pathname],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
