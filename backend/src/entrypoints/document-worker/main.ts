import { loadRuntimeConfig } from '../../config/runtime-config.js';
import { createRuntimeContext } from '../../bootstrap/context.js';
import { runEntrypoint, installShutdown } from '../../bootstrap/shutdown.js';
await runEntrypoint(import.meta.url, 'document-worker', async () => {
  const config = loadRuntimeConfig('document-worker', process.env);
  const app = await createRuntimeContext('document-worker', config);
  installShutdown(app);
});
