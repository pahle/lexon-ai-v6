import {
  composeFilesForE2EProjects,
  resolveE2ESelection,
} from './e2e-projects.mjs';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { composeEnvironment, root } from './compose-environment.mjs';
import { withOwnedStack } from './e2e-lifecycle.mjs';
import { checkStack } from './e2e-stack-guard.mjs';
import { buildStackDescriptor } from './e2e-compose-files.mjs';
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
// Bounded, redacted service log tails so a failed chat load run is diagnosable
// from the job log before the stack is torn down.
async function printServiceLogTails(project, files, env) {
  const secrets = Object.entries(env)
    .filter(
      ([name, value]) =>
        /(PASSWORD|SECRET|TOKEN|KEY|URL)/iu.test(name) &&
        typeof value === 'string' &&
        value.length >= 6,
    )
    .map(([, value]) => value);
  const output = await new Promise((resolveLogs) => {
    execFile(
      'docker',
      composeArgs(
        project,
        [
          'logs',
          '--no-color',
          '--tail',
          '60',
          'api',
          'ai-worker',
          'dispatcher',
        ],
        files,
      ),
      { env, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
      (_error, stdout, stderr) => resolveLogs(`${stdout}${stderr}`),
    );
  });
  let text = output;
  for (const value of secrets) text = text.split(value).join('[redacted]');
  console.error(`--- service log tails ---\n${text}\n--- end service logs ---`);
}
const { args, selectedProjects } = resolveE2ESelection(
  process.argv.slice(2),
  undefined,
  { includeLoad: process.env.LEXON_CHAT_LOAD === '1' },
);
const captureChatLoad = selectedProjects.includes('chat-sse-load');
// LEXON_E2E_KEEP=1 (the F4.1 capture stack, scripts/visual-capture-stack.mjs)
// leaves the stack running and keeps its state in .cache/visual-capture-stack.
// The S2 burst provisions 500 users from one address (F4.2 item 27).
const loadIp = captureChatLoad ? 2000 : 100;
const keep = process.env.LEXON_E2E_KEEP === '1';
const keepDirectory = join(root, '.cache/visual-capture-stack');
if (keep) {
  if (existsSync(join(keepDirectory, 'descriptor.json')))
    throw new Error(
      'A visual capture stack is already up: run node scripts/visual-capture-stack.mjs down first',
    );
  await rm(keepDirectory, { recursive: true, force: true });
  await mkdir(keepDirectory, { recursive: true, mode: 0o700 });
}
const directory = keep
  ? keepDirectory
  : await mkdtemp(join(tmpdir(), 'lexon-e2e-'));
// CI names the project per run and shard (lexon-e2e-<run id>-<shard>).
const project =
  process.env.LEXON_E2E_PROJECT ??
  'lexon-e2e-' + randomBytes(8).toString('hex');
if (!/^lexon-e2e-[a-f0-9]+(?:-[0-9]+)?$/u.test(project))
  throw new Error('LEXON_E2E_PROJECT must match lexon-e2e-<hex>[-<shard>]');
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
        signup: { account: 3, ip: loadIp, windowSeconds: 600 },
        'verification-resend': { account: 3, ip: loadIp, windowSeconds: 600 },
        // Since AUTH_TRUSTED_PROXIES the host's direct API calls and its
        // Caddy-routed browser traffic resolve to ONE client address (before,
        // they were two buckets: the gateway and Caddy). The suite signs in far
        // more than 30 times a minute from that one host, so give it headroom.
        // Production keeps the default; the proxy spec reads this value.
        signin: { account: 5, ip: loadIp, windowSeconds: 60 },
        // Every enrolled administrator redeems its setup link about three
        // times, and shard 3 enrolls more than six within ten minutes from
        // that one address, past the default 20 per IP.
        'setup-redemption': { account: 5, ip: loadIp, windowSeconds: 600 },
        // Each enrollment and each platform re-authentication spends TOTP
        // calls; shard 3 makes more than 30 within five minutes from that one
        // address (default 30 per IP). Production keeps the default.
        totp: { account: 5, ip: loadIp, windowSeconds: 300 },
      }),
      COMPOSE_PROFILES: '',
      AUTH_LOCAL_DEVELOPMENT: 'true',
      SMTP_URL: 'smtp://127.0.0.1:2525',
      SMTP_FROM: 'lexon@example.test',
      VALKEY_PASSWORD: secret(),
      S3_ACCESS_KEY: secret(),
      S3_SECRET_KEY: secret(),
      S3_BUCKET: 'lexon-e2e',
      // A /24 per stack from 10.200-10.249, away from Docker's 172.x pools.
      EDGE_SUBNET: `10.${200 + (parseInt(project.slice(-2), 16) % 50)}.${parseInt(project.slice(-4, -2), 16)}.0/24`,
      CADDY_EDGE_IP: `10.${200 + (parseInt(project.slice(-2), 16) % 50)}.${parseInt(project.slice(-4, -2), 16)}.250`,
      PUBLIC_HOST_PORT: publicHostPort,
      PUBLIC_URL: publicUrl,
      API_HOST_PORT: await port(),
      FRONTEND_HOST_PORT: await port(),
    },
    directory,
  );
  env.AUTH_PUBLIC_ORIGIN = publicUrl;
  env.LEXON_REPO_ROOT = root;
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
  const files = composeFilesForE2EProjects(selectedProjects, root);
  const loadEvidence = await withOwnedStack({
    project,
    directory,
    signal: controller.signal,
    captureChatLoad,
    keep,
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
      const descriptor = buildStackDescriptor({
        project,
        operatorEnvironmentPath,
        apiUrl: `http://127.0.0.1:${env.API_HOST_PORT}`,
        publicUrl,
        composeFiles: files,
      });
      if (keep)
        await writeFile(
          join(directory, 'descriptor.json'),
          JSON.stringify({
            ...descriptor,
            directory,
          }),
          { mode: 0o600 },
        );
      let testError;
      try {
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
      } catch (error) {
        testError = error;
        if (captureChatLoad) await printServiceLogTails(project, files, env);
      }
      // Guard: a helper that recreates services must leave the api with
      // sign-up open and every overlay in place, even after a failed run.
      const problems = await checkStack(project, files);
      if (problems.length > 0) {
        console.error(`E2E stack guard failed:\n- ${problems.join('\n- ')}`);
        testError ??= new Error('E2E stack guard failed');
      }
      if (testError) throw testError;
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
  if (!keep || process.exitCode === 1)
    await rm(directory, { recursive: true, force: true });
}
