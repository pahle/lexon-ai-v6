import { loadRuntimeConfig } from '../../config/runtime-config.js';
import { createApi } from '../../bootstrap/api.js';
import { runEntrypoint, installShutdown } from '../../bootstrap/shutdown.js';
await runEntrypoint(import.meta.url, 'api', async () => {
  const config = loadRuntimeConfig('api', process.env);
  const app = await createApi(config);
  try {
    await app.listen(config.port, '0.0.0.0');
  } catch {
    await app.close();
    throw new Error('API listen failed');
  }
  installShutdown(app);
});
