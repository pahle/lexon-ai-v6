import { createOpenRouter } from '@openrouter/ai-sdk-provider';
// Internal constructor only. Production model selection is restricted to F3's reviewed allowlist.
export function createOpenRouterProvider(
  options: { apiKey?: string; fetch?: typeof fetch } = {},
) {
  return createOpenRouter({ ...options, compatibility: 'strict' });
}
