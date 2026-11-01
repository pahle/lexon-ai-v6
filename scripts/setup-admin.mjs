import { join } from 'node:path';
import {
  composeEnvironment,
  localEnvironment,
  root,
} from './compose-environment.mjs';
import { composeArgs, run } from './compose-runner.mjs';
try {
  const input = await localEnvironment();
  if (
    !input.DATABASE_SETUP_PASSWORD ||
    input.DATABASE_SETUP_PASSWORD === 'REPLACE_ME'
  )
    throw new Error('Configure DATABASE_SETUP_PASSWORD in .env');
  const env = await composeEnvironment(
    input,
    join(root, '.cache/compose-development'),
  );
  await run(
    'docker',
    composeArgs('lexon-dev', [
      '--profile',
      'operator',
      'run',
      '--rm',
      'admin-setup',
      'node',
      'backend/dist/entrypoints/admin-setup/main.js',
      ...process.argv.slice(2).filter((arg) => arg !== '--'),
    ]),
    { env },
  );
} catch {
  process.stderr.write('Administrator setup command failed\n');
  process.exitCode = 1;
}
