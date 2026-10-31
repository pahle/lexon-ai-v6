import { loadRuntimeConfig } from '../../config/runtime-config.js';
import { createRuntimeContext } from '../../bootstrap/context.js';
import { runEntrypoint, installShutdown } from '../../bootstrap/shutdown.js';
await runEntrypoint(import.meta.url, 'ai-worker', async () => {
  const config = loadRuntimeConfig('ai-worker', process.env);
  const app = await createRuntimeContext('ai-worker', config);
  installShutdown(app);
});
