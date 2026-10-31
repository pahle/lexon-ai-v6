import { fork } from 'node:child_process';
import type { FileServices } from '../setup/provided-context.js';
export async function spawnFixtureWorker(options: {
  services: FileServices;
  failpoint?: 'before-commit' | 'after-commit-before-ack';
}) {
  const child = fork(
    new URL('../../.test-build/test/process/worker-main.js', import.meta.url),
    [],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] },
  );
  const seen = new Set<string>();
  const waiting = new Map<string, () => void>();
  let exited = false;
  child.on('message', (message: { checkpoint?: string }) => {
    if (message.checkpoint) {
      seen.add(message.checkpoint);
      waiting.get(message.checkpoint)?.();
    }
  });
  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  const checkpoint = async (name: string) => {
    if (seen.has(name)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => waiting.set(name, resolve)),
        exit.then(() => {
          throw new Error('Fixture worker exited before checkpoint');
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Fixture checkpoint timed out: ${name}`)),
            15000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      waiting.delete(name);
    }
  };
  child.send({
    appUrl: options.services.appUrl,
    queueUrl: options.services.valkey.queueUrl,
    prefix: options.services.queuePrefix,
    ...(options.failpoint ? { failpoint: options.failpoint } : {}),
  });
  const kill = async () => {
    if (!exited) child.kill('SIGKILL');
    await exit;
  };
  try {
    await checkpoint('ready');
  } catch (error) {
    await kill();
    throw error;
  }
  return { checkpoint, kill, exited: () => exited, close: kill };
}
