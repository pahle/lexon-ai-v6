import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  composeEnvironment,
  localEnvironment,
  root,
} from './compose-environment.mjs';
import { composeArgs, run } from './compose-runner.mjs';
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const useMail = args.includes('--mail');
if (useMail) args.splice(args.indexOf('--mail'), 1);
const index = args.indexOf('--package');
const selected = index < 0 ? undefined : args.splice(index, 2)[1];
const services = {
  backend: process.env.LEXON_RUNTIME ?? 'api',
  frontend: 'frontend',
  shared: 'api',
  evals: 'api',
};
try {
  if (selected && !services[selected]) throw new Error('Unknown dev package');
  if (
    selected === 'backend' &&
    !['api', 'ai-worker', 'document-worker', 'dispatcher'].includes(
      services.backend,
    )
  )
    throw new Error('Invalid LEXON_RUNTIME');
  const directory = join(root, '.cache/compose-development');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const input = await localEnvironment();
  if (useMail) input.SMTP_URL = 'smtp://mailpit:1025';
  else if (input.SMTP_URL && new URL(input.SMTP_URL).hostname === 'mailpit')
    throw new Error('Use --mail to enable development Mailpit');
  const env = await composeEnvironment(input, directory);
  await run(
    'docker',
    composeArgs('lexon-dev', [
      ...(useMail ? ['--profile', 'dev-mail'] : []),
      'up',
      '--build',
      ...(selected ? [services[selected]] : []),
      ...args,
    ]),
    { env },
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
