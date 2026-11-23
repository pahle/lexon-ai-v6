// One long-lived E2E stack for the F4.1 visual capture loop. The frontend is
// the production build (the e2e-test-runtime image target, next build +
// next start), so edits and hot reloads by workers never touch the screens.
// Workers keep coding in parallel; only capture runs are serialized, each one
// rebuilding the frontend image from the working tree first.
//
//   node scripts/visual-capture-stack.mjs up        start the stack and keep it
//   node scripts/visual-capture-stack.mjs status    print the project and URLs
//   node scripts/visual-capture-stack.mjs run <group...> [--ids a,b]
//        [--linux]  (browser + compare inside the Playwright Linux image, CI numbers)
//        lock, rebuild + recreate the frontend, capture the groups (auth,
//        shell, chat, chats-settings, platform, platform-accounts,
//        platform-organizations), compare with the prototype
//   node scripts/visual-capture-stack.mjs down      remove this stack only
//
// Captures go to .cache/f4.1-visual/review/, sheets to
// .cache/f4.1-visual/compare/<group>/. State lives in
// .cache/visual-capture-stack/ (descriptor.json, operator-environment.json,
// capture.lock).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { acquireLock } from './visual-capture-lock.mjs';
import { checkStack } from './e2e-stack-guard.mjs';
import { composeArgs, run } from './compose-runner.mjs';
import { root } from './compose-environment.mjs';

const stackDirectory = resolve(root, '.cache/visual-capture-stack');
const descriptorFile = resolve(stackDirectory, 'descriptor.json');
const PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';
const GROUPS = [
  'auth',
  'shell',
  'chat',
  'chats-settings',
  'platform',
  'platform-accounts',
  'platform-organizations',
];

function readDescriptor() {
  if (!existsSync(descriptorFile))
    throw new Error(
      'No visual capture stack is up: run node scripts/visual-capture-stack.mjs up',
    );
  return JSON.parse(readFileSync(descriptorFile, 'utf8'));
}

function exit(command, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', (code) => done(code ?? 1));
  });
}

/** The capture ids a group spec writes, read from its captureBrandViews calls. */
export function groupIds(group) {
  const source = readFileSync(
    resolve(root, `backend/test/e2e/brand-visual-${group}.spec.ts`),
    'utf8',
  );
  return [
    ...new Set(
      [...source.matchAll(/captureBrandViews\(\s*page,\s*'([a-z0-9-]+)'/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

function capture(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: root });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.once('error', fail);
    child.once('exit', (code) => done({ code: code ?? 1, out: out.trim() }));
  });
}

/** Arguments shared by the Linux containers: user, memory, repo mount. */
export function linuxContainerArgs(uid, gid) {
  return [
    '--rm',
    '--init',
    '--ipc=host',
    '--memory',
    '2g',
    '--user',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp',
    '-v',
    `${root}:/work:ro`,
    '-v',
    `${resolve(root, '.cache/f4.1-visual')}:/work/.cache/f4.1-visual`,
    '-w',
    '/work',
  ];
}

/**
 * Starts the Playwright browser server in the official Linux image (the
 * browser, and so the font rendering, is Linux; the test runner stays on the
 * host next to docker and the stack). Resolves the ws endpoint and a stop().
 */
async function startLinuxBrowser() {
  const name = `lexon-e2e-visual-linux-${process.pid}`;
  const started = await capture('docker', [
    'run',
    '--detach',
    '--name',
    name,
    ...linuxContainerArgs(process.getuid(), process.getgid()),
    '-p',
    '127.0.0.1::3000',
    PLAYWRIGHT_IMAGE,
    'node',
    '/work/node_modules/@playwright/test/cli.js',
    'run-server',
    '--host',
    '0.0.0.0',
    '--port',
    '3000',
  ]);
  if (started.code !== 0) throw new Error('Could not start the Linux browser');
  const stop = () => capture('docker', ['stop', '--time', '3', name]);
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const port = await capture('docker', ['port', name, '3000/tcp']);
      const logs = await capture('docker', ['logs', name]);
      if (port.code === 0 && /Listening on/.test(logs.out)) {
        return {
          endpoint: `ws://127.0.0.1:${port.out.split(':').pop()}/`,
          stop,
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('The Linux browser server did not start');
  } catch (error) {
    await stop();
    throw error;
  }
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'up') {
  process.exitCode = await exit(
    process.execPath,
    [resolve(root, 'scripts/e2e.mjs'), '--project', 'brand-visual', '--list'],
    { ...process.env, LEXON_E2E_KEEP: '1' },
  );
  if (process.exitCode === 0) {
    const stack = readDescriptor();
    console.log(
      `Stack ${stack.project} is up. Public URL ${stack.publicUrl}. Next: node scripts/visual-capture-stack.mjs run <group>`,
    );
  }
} else if (command === 'status') {
  const stack = readDescriptor();
  console.log(JSON.stringify({ project: stack.project, url: stack.publicUrl }));
} else if (command === 'run') {
  const stack = readDescriptor();
  const idsAt = rest.indexOf('--ids');
  const explicitIds = idsAt >= 0 ? rest[idsAt + 1] : undefined;
  const linux = rest.includes('--linux');
  const groups = rest.filter(
    (arg, at) =>
      !(idsAt >= 0 && (at === idsAt || at === idsAt + 1)) &&
      !arg.startsWith('-'),
  );
  if (groups.length === 0 || groups.some((g) => !GROUPS.includes(g)))
    throw new Error(`Name one or more groups: ${GROUPS.join(', ')}`);
  const release = await acquireLock(resolve(stackDirectory, 'capture.lock'), {
    onWait: (pid) =>
      console.error(`Waiting for the capture run of pid ${pid}...`),
  });
  let linuxBrowser;
  const stopRelease = () =>
    Promise.resolve(linuxBrowser?.stop())
      .then(() => release())
      .finally(() => process.exit(130));
  process.once('SIGINT', stopRelease);
  process.once('SIGTERM', stopRelease);
  let failed = 0;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync(
      'git',
      ['status', '--short', 'frontend/src', 'backend/src', 'shared/src'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter(Boolean).length;
    console.log(
      `Capture run: commit ${sha}, ${dirty} changed files in frontend/src backend/src shared/src, groups ${groups.join(',')}`,
    );
    const env = JSON.parse(readFileSync(stack.operatorEnvironmentPath, 'utf8'));
    // Rebuild every image built from this repository, not only the frontend:
    // a frontend built from the working tree against an older api fails the
    // shared strict schemas (round 4: passwordChangedAt).
    const appServices = [
      'api',
      'ai-worker',
      'document-worker',
      'dispatcher',
      'frontend',
    ];
    await run(
      'docker',
      composeArgs(stack.project, ['build', ...appServices], stack.composeFiles),
      { env },
    );
    await run(
      'docker',
      composeArgs(
        stack.project,
        [
          'up',
          '--detach',
          '--no-deps',
          '--force-recreate',
          '--wait',
          '--wait-timeout',
          '180',
          ...appServices,
        ],
        stack.composeFiles,
      ),
      { env },
    );
    if (linux) linuxBrowser = await startLinuxBrowser();
    for (const group of groups) {
      const captureCode = await exit(
        process.execPath,
        [
          resolve(root, 'node_modules/@playwright/test/cli.js'),
          'test',
          '--project',
          'brand-visual',
          '--output',
          resolve(stackDirectory, `pw-${group}`),
          `backend/test/e2e/brand-visual-${group}.spec.ts`,
        ],
        {
          ...process.env,
          LEXON_E2E_DESCRIPTOR: JSON.stringify({
            project: stack.project,
            operatorEnvironmentPath: stack.operatorEnvironmentPath,
            apiUrl: stack.apiUrl,
            publicUrl: stack.publicUrl,
            frontendUrl: stack.frontendUrl,
            composeFiles: stack.composeFiles,
          }),
          LEXON_VISUAL_MODE: 'capture',
          LEXON_CHAT_LOAD: '0',
          PLAYWRIGHT_NO_COPY_PROMPT: '1',
          COMPOSE_PROFILES: '',
          ...(linuxBrowser && {
            PW_TEST_CONNECT_WS_ENDPOINT: linuxBrowser.endpoint,
            PW_TEST_CONNECT_EXPOSE_NETWORK: '<loopback>',
          }),
        },
      );
      if (captureCode !== 0) failed = captureCode;
      const ids = explicitIds ?? groupIds(group).join(',');
      const compareArgs = [
        'scripts/visual-compare-prototype.mjs',
        '--capture-dir',
        '.cache/f4.1-visual/review',
        '--out-dir',
        `.cache/f4.1-visual/compare/${group}`,
        '--ids',
        ids,
      ];
      await (linux
        ? exit(
            'docker',
            [
              'run',
              ...linuxContainerArgs(process.getuid(), process.getgid()),
              PLAYWRIGHT_IMAGE,
              'node',
              ...compareArgs,
            ],
            process.env,
          )
        : exit(
            process.execPath,
            compareArgs.map((a) =>
              a.startsWith('.') || a.startsWith('scripts')
                ? resolve(root, a)
                : a,
            ),
            process.env,
          ));
    }
    const problems = await checkStack(stack.project, stack.composeFiles);
    if (problems.length > 0) {
      console.error(`Stack guard failed:\n- ${problems.join('\n- ')}`);
      failed ||= 1;
    }
  } finally {
    process.off('SIGINT', stopRelease);
    process.off('SIGTERM', stopRelease);
    await linuxBrowser?.stop();
    await release();
  }
  process.exitCode = failed;
} else if (command === 'down') {
  const stack = readDescriptor();
  const env = JSON.parse(readFileSync(stack.operatorEnvironmentPath, 'utf8'));
  await run(
    'docker',
    composeArgs(
      stack.project,
      ['down', '--volumes', '--remove-orphans', '--timeout', '12'],
      stack.composeFiles,
    ),
    { env, quiet: true },
  );
  const { rm } = await import('node:fs/promises');
  await rm(stackDirectory, { recursive: true, force: true });
  console.log(`Stack ${stack.project} removed.`);
} else {
  console.error(
    'Usage: visual-capture-stack.mjs up | status | run <group...> | down',
  );
  process.exitCode = 2;
}
