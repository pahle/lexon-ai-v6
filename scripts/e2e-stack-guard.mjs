// Fails loudly when a run leaves the api with sign-up closed, or a stack
// without the overlays it was started with (a helper recreated a service
// from a shorter compose file list, or a run was interrupted mid-recreate).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const identityFile = 'backend/test/e2e/compose.identity.yml';
const loadFile = 'backend/test/e2e/compose.chat-load.yml';
const proofFile = 'backend/test/e2e/compose.chat-runtime-proof.yml';

export function stackProblems({ composeFiles, api, aiWorker, frontend }) {
  const has = (name) => composeFiles.some((file) => file.endsWith(name));
  const problems = [];
  if (!api?.running) problems.push('api container is not running');
  else {
    if (!api.env.includes('AUTH_OPEN_SIGNUP=true'))
      problems.push(
        `api ends the run with ${api.env.find((v) => v.startsWith('AUTH_OPEN_SIGNUP=')) ?? 'AUTH_OPEN_SIGNUP unset'} (expected AUTH_OPEN_SIGNUP=true)`,
      );
    if (has(loadFile)) {
      if (!api.cmd.includes('backend/test/e2e/chat-load-api-main.mjs'))
        problems.push(
          'api lost the chat-load overlay (chat-load-api-main.mjs command)',
        );
    } else if (
      has(identityFile) &&
      !api.cmd.includes('backend/test/e2e/auth-api-main.mjs')
    )
      problems.push(
        'api lost the identity overlay (auth-api-main.mjs command)',
      );
  }
  if (has(proofFile)) {
    if (!aiWorker?.running) problems.push('ai-worker is not running');
    else if (!aiWorker.cmd.includes('backend/test/e2e/chat-worker-main.mjs'))
      problems.push(
        'ai-worker lost the chat-runtime-proof overlay (chat-worker-main.mjs command)',
      );
  }
  if (frontend?.env.some((v) => v.startsWith('LEXON_VISUAL_DEV=')))
    problems.push(
      'frontend runs the visual-dev server, not the production build',
    );
  return problems;
}

async function service(project, name) {
  const docker = promisify(execFile);
  const ids = (
    await docker('docker', [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--filter',
      `label=com.docker.compose.service=${name}`,
      '--format',
      '{{.ID}}',
    ])
  ).stdout.trim();
  if (!/^[a-f0-9]+$/.test(ids)) return undefined;
  const [info] = JSON.parse((await docker('docker', ['inspect', ids])).stdout);
  return {
    running: info.State.Running === true,
    env: info.Config.Env ?? [],
    cmd: info.Config.Cmd ?? [],
  };
}

/** Inspect the stack's containers and return the list of problems (empty = ok). */
export async function checkStack(project, composeFiles) {
  try {
    // No container of the project at all: nothing to inspect (not a stack).
    const any = (
      await promisify(execFile)('docker', [
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${project}`,
      ])
    ).stdout.trim();
    if (any === '') return [];
    return stackProblems({
      composeFiles,
      api: await service(project, 'api'),
      aiWorker: await service(project, 'ai-worker'),
      frontend: await service(project, 'frontend'),
    });
  } catch (error) {
    return [`stack guard could not inspect ${project}: ${error.message}`];
  }
}
