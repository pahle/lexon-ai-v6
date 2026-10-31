import {
  DiagnosticInputSchema,
  DiagnosticResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  type FoundationApi,
} from '@lexon/contracts';
export function createFoundationClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
}): FoundationApi {
  const base = options.baseUrl.replace(/\/$/, '');
  async function request(path: string, init?: RequestInit) {
    try {
      const response = await (options.fetch ?? globalThis.fetch)(
        base + path,
        init,
      );
      return { response, data: (await response.json()) as unknown };
    } catch {
      throw new Error('Backend unavailable');
    }
  }
  return {
    async health() {
      const { response, data } = await request('/health');
      const parsed = HealthResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid backend response');
      if (!response.ok && response.status !== 503)
        throw new Error('Backend unavailable');
      return parsed.data;
    },
    async diagnose(input) {
      const parsed = DiagnosticInputSchema.safeParse(input);
      if (!parsed.success) throw new Error('Enter a valid UUID');
      const { response, data } = await request('/diagnostics/validation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const error = ErrorResponseSchema.safeParse(data);
        throw new Error(
          error.success && error.data.error.code === 'VALIDATION_ERROR'
            ? 'Validation failed'
            : 'Backend unavailable',
        );
      }
      const result = DiagnosticResponseSchema.safeParse(data);
      if (!result.success) throw new Error('Invalid backend response');
      return result.data;
    },
  };
}
