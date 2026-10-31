import { pathToFileURL } from 'node:url';
import pino from 'pino';
import type { INestApplicationContext } from '@nestjs/common';
import type { RuntimeName } from '../config/runtime-config.js';
import { createLoggingOptions } from '../infrastructure/telemetry/index.js';
export function installShutdown(app: INestApplicationContext): void {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    void app
      .close()
      .then(() => {
        clearTimeout(deadline);
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
      })
      .catch(() => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
export async function runEntrypoint(
  url: string,
  runtime: RuntimeName,
  boot: () => Promise<void>,
): Promise<void> {
  if (!process.argv[1] || url !== pathToFileURL(process.argv[1]).href) return;
  try {
    await boot();
  } catch {
    pino(createLoggingOptions(runtime).pinoHttp).error({
      event: 'boot_failed',
    });
    process.exitCode = 1;
  }
}
