// One long-lived E2E stack for the F4.1 visual dev loop. Several workers share
// it: the frontend runs `next dev` on the working tree's frontend/src (bind
// mount, hot reload, no dev overlay), so edits show without rebuilding.
//
//   node scripts/visual-dev-stack.mjs up        start the stack and keep it
//   node scripts/visual-dev-stack.mjs status    print the project and URLs
//   node scripts/visual-dev-stack.mjs run <group...> [--ids a,b]
//        capture one or more groups (auth, shell, chat, chats-settings,
//        platform) and compare them with the prototype
//   node scripts/visual-dev-stack.mjs down      remove this stack only
//
// Captures go to .cache/f4.1-visual/review/, sheets to
// .cache/f4.1-visual/compare/<group>/. The stack's state lives in
// .cache/visual-dev-stack/ (descriptor.json, operator-environment.json).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { composeArgs, run } from './compose-runner.mjs';
import { root } from './compose-environment.mjs';

const stackDirectory = resolve(root, '.cache/visual-dev-stack');
const descriptorFile = resolve(stackDirectory, 'descriptor.json');
const GROUPS = ['auth', 'shell', 'chat', 'chats-settings', 'platform'];

function readDescriptor() {
  if (!existsSync(descriptorFile))
    throw new Error(
      'No visual dev stack is up: run node scripts/visual-dev-stack.mjs up',
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

const [command, ...rest] = process.argv.slice(2);

if (command === 'up') {
  process.exitCode = await exit(
    process.execPath,
    [resolve(root, 'scripts/e2e.mjs'), '--project', 'brand-visual', '--list'],
    { ...process.env, LEXON_E2E_KEEP: '1', LEXON_VISUAL_DEV: '1' },
  );
  if (process.exitCode === 0) {
    const stack = readDescriptor();
    console.log(
      `Stack ${stack.project} is up. Public URL ${stack.publicUrl}. Next: node scripts/visual-dev-stack.mjs run <group>`,
    );
  }
} else if (command === 'status') {
  const stack = readDescriptor();
  console.log(JSON.stringify({ project: stack.project, url: stack.publicUrl }));
} else if (command === 'run') {
  const stack = readDescriptor();
  const idsAt = rest.indexOf('--ids');
  const explicitIds = idsAt >= 0 ? rest[idsAt + 1] : undefined;
  const groups = rest.filter(
    (arg, at) =>
      !(idsAt >= 0 && (at === idsAt || at === idsAt + 1)) &&
      !arg.startsWith('-'),
  );
  if (groups.length === 0 || groups.some((g) => !GROUPS.includes(g)))
    throw new Error(`Name one or more groups: ${GROUPS.join(', ')}`);
  let failed = 0;
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
        }),
        LEXON_VISUAL_MODE: 'capture',
        LEXON_CHAT_LOAD: '0',
        PLAYWRIGHT_NO_COPY_PROMPT: '1',
        COMPOSE_PROFILES: '',
      },
    );
    if (captureCode !== 0) failed = captureCode;
    const ids = explicitIds ?? groupIds(group).join(',');
    await exit(
      process.execPath,
      [
        resolve(root, 'scripts/visual-compare-prototype.mjs'),
        '--capture-dir',
        resolve(root, '.cache/f4.1-visual/review'),
        '--out-dir',
        resolve(root, `.cache/f4.1-visual/compare/${group}`),
        '--ids',
        ids,
      ],
      process.env,
    );
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
    'Usage: visual-dev-stack.mjs up | status | run <group...> | down',
  );
  process.exitCode = 2;
}
