import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { descriptor } from './runtime-support.js';
async function compose(args: string[], overrides: Record<string, string> = {}) {
  const stack = descriptor();
  const env = JSON.parse(
    await readFile(stack.operatorEnvironmentPath, 'utf8'),
  ) as Record<string, string>;
  try {
    return (
      await promisify(execFile)(
        'docker',
        [
          'compose',
          '--project-name',
          stack.project,
          '--file',
          new URL('../../../docker-compose.yml', import.meta.url).pathname,
          '--file',
          new URL('./compose.identity.yml', import.meta.url).pathname,
          ...args,
        ],
        { env: { ...env, ...overrides }, timeout: 60000, maxBuffer: 65536 },
      )
    ).stdout;
  } catch {
    throw new Error('Test operator control unavailable');
  }
}
export async function operatorSetup(
  email: string,
  additional = false,
): Promise<{ status: string; mail: { actionUrl: string } | null }> {
  return JSON.parse(
    await compose([
      'run',
      '--rm',
      '--no-deps',
      '-T',
      'admin-setup',
      'node',
      'backend/test/e2e/admin-setup-main.mjs',
      '--email',
      email,
      ...(additional ? ['--additional'] : []),
    ]),
  ) as { status: string; mail: { actionUrl: string } | null };
}
export async function signupMode(open: boolean) {
  await compose(
    [
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '60',
      '--no-deps',
      '--force-recreate',
      'api',
    ],
    { AUTH_OPEN_SIGNUP: String(open) },
  );
}
