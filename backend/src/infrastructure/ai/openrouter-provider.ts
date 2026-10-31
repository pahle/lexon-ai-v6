import { createOpenRouter } from '@openrouter/ai-sdk-provider';
// Internal constructor only. Production model selection is unavailable in F0.
export function createOpenRouterProvider(
  options: { apiKey?: string; fetch?: typeof fetch } = {},
) {
  return createOpenRouter({ ...options, compatibility: 'strict' });
}
