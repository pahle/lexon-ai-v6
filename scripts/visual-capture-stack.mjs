// One long-lived E2E stack for the F4.1 visual capture loop. The frontend is
// the production build (the e2e-test-runtime image target, next build +
// next start), so edits and hot reloads by workers never touch the screens.
// Workers keep coding in parallel; only capture runs are serialized, each one
// rebuilding the frontend image from the working tree first.
//
//   node scripts/visual-capture-stack.mjs up        start the stack and keep it
//   node scripts/visual-capture-stack.mjs status    print the project and URLs
//   node scripts/visual-capture-stack.mjs run <group...> [--ids a,b]
//        lock, rebuild + recreate the frontend, capture the groups (auth,
//        shell, chat, chats-settings, platform), compare with the prototype
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
const GROUPS = ['auth', 'shell', 'chat', 'chats-settings', 'platform'];

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
  const stopRelease = () => release().finally(() => process.exit(130));
  process.once('SIGINT', stopRelease);
  process.once('SIGTERM', stopRelease);
  let failed = 0;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--short', 'frontend/src', 'backend/src', 'shared/src'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean).length;
    console.log(
      `Capture run: commit ${sha}, ${dirty} changed files in frontend/src backend/src shared/src, groups ${groups.join(',')}`,
    );
    const env = JSON.parse(readFileSync(stack.operatorEnvironmentPath, 'utf8'));
    // Rebuild every image built from this repository, not only the frontend:
    // a frontend built from the working tree against an older api fails the
    // shared strict schemas (round 4: passwordChangedAt).
    const appServices = ['api', 'ai-worker', 'document-worker', 'dispatcher', 'frontend'];
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
    const problems = await checkStack(stack.project, stack.composeFiles);
    if (problems.length > 0) {
      console.error(`Stack guard failed:\n- ${problems.join('\n- ')}`);
      failed ||= 1;
    }
  } finally {
    process.off('SIGINT', stopRelease);
    process.off('SIGTERM', stopRelease);
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
