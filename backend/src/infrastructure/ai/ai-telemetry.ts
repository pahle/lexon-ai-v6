import { OpenTelemetry } from '@ai-sdk/otel';
import { registerTelemetry } from 'ai';

export function registerAiSdkTelemetry(): void {
  registerTelemetry(
    new OpenTelemetry({
      providerMetadata: false,
      usage: false,
      embedding: false,
      reranking: false,
      runtimeContext: true,
      headers: false,
      toolChoice: false,
      schema: false,
    }),
  );
}
