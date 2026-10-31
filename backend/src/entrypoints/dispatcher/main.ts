import { loadRuntimeConfig } from '../../config/runtime-config.js';
import { createRuntimeContext } from '../../bootstrap/context.js';
import { runEntrypoint, installShutdown } from '../../bootstrap/shutdown.js';
await runEntrypoint(import.meta.url, 'dispatcher', async () => {
  const config = loadRuntimeConfig('dispatcher', process.env);
  const app = await createRuntimeContext('dispatcher', config);
  installShutdown(app);
});
