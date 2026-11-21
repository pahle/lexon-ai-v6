import type { z } from 'zod';

export const REQUEST_TIMEOUT_MS = 10_000;

export interface RequestJsonOptions {
  readonly fetch?: typeof fetch | undefined;
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal | undefined;
}

/** Same-origin, uncached request with an optional JSON body and a timeout. */
export async function requestJson(
  url: string,
  options: RequestJsonOptions,
  unavailable: () => Error,
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await (options.fetch ?? globalThis.fetch)(url, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
      headers: {
        ...(options.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...options.headers,
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch {
    throw unavailable();
  }
}

export async function parseJsonResponse<T>(
  response: Response,
  schema: z.ZodType<T> | null,
  invalid: () => Error,
): Promise<T> {
  if (schema === null) return undefined as T;
  try {
    return schema.parse(await response.json());
  } catch {
    throw invalid();
  }
}
