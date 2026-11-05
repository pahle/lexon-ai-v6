import type { RunErrorCode } from '@lexon/contracts';
import { APICallError, StreamProviderError } from 'ai';
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

const permanentTransportCodes = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
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
    const apiCallError = APICallError.isInstance(error) ? error : undefined;
    const streamProviderError = StreamProviderError.isInstance(error)
      ? error
      : undefined;
    const sdkError = apiCallError ?? streamProviderError;
    const transport = inspectTransportCause(sdkError?.cause ?? error);
    const sdkFlagMayApply =
      sdkError !== undefined &&
      (sdkError.cause === undefined || sdkError.cause === null);
    const retryable =
      transport === 'retryable' ||
      (transport === 'unknown' && sdkFlagMayApply && sdkError.isRetryable);
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

function inspectTransportCause(
  error: unknown,
): 'retryable' | 'permanent' | 'unknown' {
  const visited = new Set<object>();
  let current: unknown = error;
  let hasRetryableCode = false;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    const code = (current as Error & { readonly code?: unknown }).code;
    if (typeof code === 'string' && permanentTransportCodes.has(code))
      return 'permanent';
    if (typeof code === 'string' && retryableNetworkCodes.has(code))
      hasRetryableCode = true;
    current = current.cause;
  }
  return hasRetryableCode ? 'retryable' : 'unknown';
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
