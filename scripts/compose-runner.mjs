import { spawn } from 'node:child_process';
import { root } from './compose-environment.mjs';
export function composeArgs(project, args, files = []) {
  if (!/^lexon-(?:dev|e2e-[a-f0-9]+)$/.test(project))
    throw new Error('Invalid Compose project');
  return [
    'compose',
    '--project-name',
    project,
    '--file',
    root + 'docker-compose.yml',
    ...files.flatMap((file) => ['--file', file]),
    ...args,
  ];
}
export function run(
  command,
  args,
  { env = process.env, quiet = false, signal, timeoutMs } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      signal,
    });
    let output = '';
    if (quiet) {
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', () => undefined);
    }
    const timer = timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), timeoutMs)
      : undefined;
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} failed (${signal ?? code})`));
    });
  });
}
