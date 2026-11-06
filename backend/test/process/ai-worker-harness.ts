import { fork } from 'node:child_process';
import type { FileServices } from '../setup/provided-context.js';
import type { RunProfile } from '../../src/modules/chat/run-contracts.js';

export async function spawnAiWorker(input: {
  readonly services: FileServices;
  readonly tenant: { readonly orgId: string; readonly userId: string };
  readonly profile: RunProfile;
  readonly pause?:
    'none' | 'after-model-response' | 'after-final-commit-before-ack';
  readonly resultText?: string;
  readonly generationId?: string;
}) {
  const child = fork(
    new URL(
      '../../.test-build/test/process/ai-worker-main.js',
      import.meta.url,
    ),
    [],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] },
  );
  const seen = new Set<string>();
  const waiting = new Map<string, () => void>();
  let exited = false;
  child.on('message', (message: { checkpoint?: string }) => {
    if (!message.checkpoint) return;
    seen.add(message.checkpoint);
    waiting.get(message.checkpoint)?.();
  });
  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  const checkpoint = async (name: string, timeoutMs = 20_000) => {
    if (seen.has(name)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => waiting.set(name, resolve)),
        exit.then(() => {
          throw new Error('AI worker exited before checkpoint');
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`AI worker checkpoint timed out: ${name}`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      waiting.delete(name);
    }
  };
  const kill = async () => {
    if (!exited) child.kill('SIGKILL');
    await exit;
  };
  const terminate = async () => {
    if (!exited) child.kill('SIGTERM');
    await exit;
  };
  child.send({
    appUrl: input.services.appUrl,
    queueUrl: input.services.valkey.queueUrl,
    streamUrl: input.services.valkey.streamsUrl,
    prefix: input.services.queuePrefix,
    tenant: input.tenant,
    profile: input.profile,
    pause: input.pause ?? 'none',
    resultText: input.resultText ?? 'Process answer',
    generationId: input.generationId ?? 'process-generation',
  });
  try {
    await checkpoint('worker-ready');
  } catch (error) {
    await kill();
    throw error;
  }
  return {
    checkpoint,
    kill,
    terminate,
    release() {
      child.send({ action: 'release' });
    },
    stop() {
      if (!exited && child.pid) process.kill(child.pid, 'SIGSTOP');
    },
    resume() {
      if (!exited && child.pid) process.kill(child.pid, 'SIGCONT');
    },
    exited: () => exited,
    close: kill,
  };
}
