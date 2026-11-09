import { fork } from 'node:child_process';
import type { StepClaim } from '../../src/infrastructure/db/index.js';
import type { FileServices } from '../setup/provided-context.js';

export async function spawnToolOperationWorker(input: {
  readonly services: FileServices;
  readonly tenant: { readonly orgId: string; readonly userId: string };
  readonly claim: StepClaim;
  readonly operationId: string;
}) {
  const child = fork(
    new URL(
      '../../.test-build/test/process/tool-operation-worker.js',
      import.meta.url,
    ),
    [],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] },
  );
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  const committed = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Tool operation worker checkpoint timed out')),
      15_000,
    );
    child.on(
      'message',
      (message: { checkpoint?: string; result?: unknown }) => {
        if (message.checkpoint === 'operation-committed') {
          clearTimeout(timer);
          resolve(message.result);
        } else if (message.checkpoint === 'operation-failed') {
          clearTimeout(timer);
          reject(new Error('Tool operation worker failed'));
        }
      },
    );
  });
  child.send({
    appUrl: input.services.appUrl,
    tenant: input.tenant,
    claim: input.claim,
    operationId: input.operationId,
  });
  const kill = async () => {
    if (!exited) child.kill('SIGKILL');
    await exit;
  };
  try {
    return { result: await committed, kill, exited: () => exited };
  } catch (error) {
    await kill();
    throw error;
  }
}
