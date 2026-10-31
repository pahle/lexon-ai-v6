import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { composeEnvironment, root } from './compose-environment.mjs';
import { withOwnedStack } from './e2e-lifecycle.mjs';
import { composeArgs, run } from './compose-runner.mjs';
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return String(value);
}
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const packageIndex = args.indexOf('--package');
const selected = packageIndex < 0 ? undefined : args.splice(packageIndex, 2)[1];
const mappings = {
  backend: ['runtime-health', 'backend-api', 'topology'],
  frontend: ['frontend-browser'],
  shared: ['backend-api'],
  evals: ['evaluation-smoke'],
};
if (selected && !mappings[selected]) throw new Error('Unknown E2E package');
if (selected && !args.includes('--project'))
  for (const project of mappings[selected]) args.push('--project', project);
const directory = await mkdtemp(join(tmpdir(), 'lexon-e2e-'));
const project = 'lexon-e2e-' + randomBytes(8).toString('hex');
const secret = () => randomBytes(24).toString('hex');
let env;
const controller = new AbortController();
const stop = () => {
  controller.abort();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  env = await composeEnvironment(
    {
      ...process.env,
      POSTGRES_ADMIN_PASSWORD: secret(),
      DATABASE_MIGRATOR_PASSWORD: secret(),
      DATABASE_APP_PASSWORD: secret(),
      DATABASE_AUTH_PASSWORD: secret(),
      VALKEY_PASSWORD: secret(),
      S3_ACCESS_KEY: secret(),
      S3_SECRET_KEY: secret(),
      S3_BUCKET: 'lexon-e2e',
      API_HOST_PORT: await port(),
      FRONTEND_HOST_PORT: await port(),
    },
    directory,
  );
  env.NETWORK_CONTROL_PATH = root + 'backend/test/e2e/network-control.mjs';
  const files = [root + 'backend/test/e2e/compose.egress-probe.yml'];
  await withOwnedStack({
    project,
    directory,
    signal: controller.signal,
    async start(signal) {
      await run('docker', composeArgs(project, ['config', '--quiet'], files), {
        env,
        quiet: true,
        signal,
      });
      await run('docker', composeArgs(project, ['build'], files), {
        env,
        signal,
      });
      await run(
        'docker',
        composeArgs(
          project,
          ['up', '--detach', '--wait', '--wait-timeout', '180'],
          files,
        ),
        { env, signal },
      );
    },
    async exercise(signal) {
      const descriptor = {
        project,
        apiUrl: `http://127.0.0.1:${env.API_HOST_PORT}`,
        frontendUrl: `http://127.0.0.1:${env.FRONTEND_HOST_PORT}`,
      };
      await run(
        process.execPath,
        [root + 'node_modules/@playwright/test/cli.js', 'test', ...args],
        {
          env: {
            ...process.env,
            LEXON_E2E_DESCRIPTOR: JSON.stringify(descriptor),
          },
          signal,
        },
      );
    },
    down: () =>
      run(
        'docker',
        composeArgs(
          project,
          ['down', '--volumes', '--remove-orphans', '--timeout', '12'],
          files,
        ),
        { env, quiet: true },
      ),
    remove: (directory) => rm(directory, { recursive: true, force: true }),
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await rm(directory, { recursive: true, force: true });
}
