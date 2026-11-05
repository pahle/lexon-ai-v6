import type { RunErrorCode } from '@lexon/contracts';
import type { ModelAttemptOutcome } from './model-contracts.js';

const retryableNetworkCodes = new Set([
  'ConnectionRefused',
  'ConnectionClosed',
  'FailedToOpenSocket',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export interface SafeProviderError {
  readonly safeCode: RunErrorCode;
  readonly attemptOutcome: ModelAttemptOutcome;
  readonly retryable: boolean;
}

export function mapProviderError(error: unknown): SafeProviderError {
  if (!isRecord(error)) {
    return {
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
      attemptOutcome: 'unknown',
      retryable: false,
    };
  }

  const statusCode = error.statusCode;
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) {
    const recognizedSdkError =
      error.name === 'AI_APICallError' ||
      error.name === 'AI_StreamProviderError';
    const retryable =
      (recognizedSdkError && error.isRetryable === true) ||
      isRetryableNetworkTransport(error);
    return {
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
      attemptOutcome: 'unknown',
      retryable,
    };
  }
  if (statusCode === 401 || statusCode === 403) {
    return {
      safeCode: 'AI_PROVIDER_AUTH',
      attemptOutcome: 'failed',
      retryable: false,
    };
  }
  if ([408, 429, 500, 502, 503, 504].includes(statusCode)) {
    return {
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
      attemptOutcome: 'failed',
      retryable: true,
    };
  }
  if (statusCode >= 400 && statusCode <= 599) {
    return {
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
      attemptOutcome: 'failed',
      retryable: false,
    };
  }
  return {
    safeCode: 'AI_INTERNAL',
    attemptOutcome: 'unknown',
    retryable: false,
  };
}

function isRetryableNetworkTransport(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;
  while (isRecord(current) && !visited.has(current)) {
    visited.add(current);
    if (
      typeof current.code === 'string' &&
      retryableNetworkCodes.has(current.code)
    )
      return true;
    if (
      current instanceof TypeError &&
      ['fetch failed', 'failed to fetch'].includes(
        current.message.toLowerCase(),
      ) &&
      current.cause != null
    )
      return true;
    current = current.cause;
  }
  return false;
}

export function normalizeProviderCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid provider cost');
  }
  const source = value.toString();
  const [mantissa, exponentText] = source.toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const sign = mantissa!.startsWith('-') ? '-' : '';
  const unsigned = sign ? mantissa!.slice(1) : mantissa!;
  const [whole, fractional = ''] = unsigned.split('.');
  const digits = `${whole}${fractional}`;
  const decimalPosition = whole!.length + exponent;
  let expanded: string;
  if (decimalPosition <= 0) {
    expanded = `0.${'0'.repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    expanded = `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  } else {
    expanded = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  const [integer, decimal] = expanded.split('.');
  const canonical = `${sign}${integer!.replace(/^0+(?=\d)/, '')}${
    decimal ? `.${decimal}` : ''
  }`;
  if (
    canonical.length > 512 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(canonical)
  ) {
    throw new Error('Invalid provider cost');
  }
  return canonical;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
