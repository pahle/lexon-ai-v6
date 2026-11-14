import {
  composeFilesForE2EProjects,
  resolveE2ESelection,
} from './e2e-projects.mjs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  const value = String(server.address().port);
  await new Promise((resolve) => server.close(resolve));
  if (allocatedPorts.has(value)) return port();
  allocatedPorts.add(value);
  return value;
}
const allocatedPorts = new Set();
const { args, selectedProjects } = resolveE2ESelection(
  process.argv.slice(2),
  undefined,
  { includeLoad: process.env.LEXON_CHAT_LOAD === '1' },
);
const captureChatLoad = selectedProjects.includes('chat-sse-load');
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
  const publicHostPort = await port();
  const publicUrl = `http://127.0.0.1:${publicHostPort}`;
  env = await composeEnvironment(
    {
      ...process.env,
      POSTGRES_ADMIN_PASSWORD: secret(),
      DATABASE_MIGRATOR_PASSWORD: secret(),
      DATABASE_APP_PASSWORD: secret(),
      DATABASE_AUTH_PASSWORD: secret(),
      DATABASE_SETUP_PASSWORD: secret(),
      AUTH_SECRET: secret(),
      AUTH_AUDIT_HMAC_SECRET: secret(),
      AUTH_AUDIT_HMAC_KEY_ID: 'e2e-v1',
      AUTH_OPEN_SIGNUP: 'true',
      E2E_AUTH_RATE_RULES_JSON: JSON.stringify({
        signup: { account: 3, ip: 100, windowSeconds: 600 },
        'verification-resend': { account: 3, ip: 100, windowSeconds: 600 },
      }),
      COMPOSE_PROFILES: '',
      AUTH_LOCAL_DEVELOPMENT: 'true',
      SMTP_URL: 'smtp://127.0.0.1:2525',
      SMTP_FROM: 'lexon@example.test',
      VALKEY_PASSWORD: secret(),
      S3_ACCESS_KEY: secret(),
      S3_SECRET_KEY: secret(),
      S3_BUCKET: 'lexon-e2e',
      PUBLIC_HOST_PORT: publicHostPort,
      PUBLIC_URL: publicUrl,
      API_HOST_PORT: await port(),
      FRONTEND_HOST_PORT: await port(),
    },
    directory,
  );
  env.AUTH_PUBLIC_ORIGIN = publicUrl;
  env.NETWORK_CONTROL_PATH = root + 'backend/test/e2e/network-control.mjs';
  env.IDENTITY_TEST_ENTRY_PATH = root + 'backend/test/e2e/auth-api-main.mjs';
  env.IDENTITY_MAIL_CONTROL_PATH = root + 'backend/test/e2e/mail-control.mjs';
  env.IDENTITY_SETUP_TEST_ENTRY_PATH =
    root + 'backend/test/e2e/admin-setup-main.mjs';
  env.IDENTITY_SETUP_TEST_IMAGE = project + '-api';
  const operatorEnvironmentPath = join(directory, 'operator-environment.json');
  await writeFile(operatorEnvironmentPath, JSON.stringify(env), {
    mode: 0o600,
  });
  const files = composeFilesForE2EProjects(
    selectedProjects,
    root,
    process.env.LEXON_VISUAL_DEV === '1',
  );
  const loadEvidence = await withOwnedStack({
    project,
    directory,
    signal: controller.signal,
    captureChatLoad,
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
        operatorEnvironmentPath,
        apiUrl: `http://127.0.0.1:${env.API_HOST_PORT}`,
        publicUrl,
        frontendUrl: publicUrl,
      };
      await run(
        process.execPath,
        [root + 'node_modules/@playwright/test/cli.js', 'test', ...args],
        {
          env: {
            ...process.env,
            LEXON_E2E_DESCRIPTOR: JSON.stringify(descriptor),
            LEXON_CHAT_LOAD: captureChatLoad ? '1' : '0',
            PLAYWRIGHT_NO_COPY_PROMPT: '1',
            COMPOSE_PROFILES: '',
          },
          signal,
        },
      );
      if (captureChatLoad)
        return JSON.parse(
          await readFile(
            join(directory, 'chat-load-observations.json'),
            'utf8',
          ),
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
  if (captureChatLoad) {
    const evidenceDirectory = resolve(
      process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR ||
        join(root, 'test-results/f4-chat-load'),
    );
    const { latency, ...aggregate } = loadEvidence;
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        join(evidenceDirectory, 'F4-sse-load.json'),
        `${JSON.stringify(aggregate, null, 2)}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        join(evidenceDirectory, 'F4-stream-latency.json'),
        `${JSON.stringify(latency, null, 2)}\n`,
        { mode: 0o600 },
      );
    } catch (error) {
      await Promise.all([
        rm(join(evidenceDirectory, 'F4-sse-load.json'), { force: true }),
        rm(join(evidenceDirectory, 'F4-stream-latency.json'), { force: true }),
      ]);
      throw error;
    }
  }
} catch (error) {
  console.error(captureChatLoad ? 'Chat SSE load E2E failed.' : error.message);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await rm(directory, { recursive: true, force: true });
}
