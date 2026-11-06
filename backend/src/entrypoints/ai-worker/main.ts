import { loadRuntimeConfig } from '../../config/runtime-config.js';
import { createRuntimeContext } from '../../bootstrap/context.js';
import { runEntrypoint, installShutdown } from '../../bootstrap/shutdown.js';
import { startAiTelemetry } from '../../infrastructure/telemetry/index.js';
import { registerAiSdkTelemetry } from '../../infrastructure/ai/index.js';
await runEntrypoint(import.meta.url, 'ai-worker', async () => {
  const config = loadRuntimeConfig('ai-worker', process.env);
  const telemetry = await startAiTelemetry({
    ...(process.env.LEXON_OTEL_COLLECTOR_URL
      ? { collectorUrl: process.env.LEXON_OTEL_COLLECTOR_URL }
      : {}),
    serviceName: 'lexon-ai-worker',
  });
  try {
    registerAiSdkTelemetry();
    const app = await createRuntimeContext('ai-worker', config);
    installShutdown(app, () => telemetry.close());
  } catch (error) {
    await telemetry.close();
    throw error;
  }
});
