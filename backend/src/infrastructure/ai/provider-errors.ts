import type { RunErrorCode } from '@lexon/contracts';
import type { ModelAttemptOutcome } from './model-contracts.js';

export interface SafeProviderError {
  readonly safeCode: RunErrorCode;
  readonly attemptOutcome: ModelAttemptOutcome;
}

export function mapProviderError(error: unknown): SafeProviderError {
  if (!isRecord(error)) {
    return { safeCode: 'AI_PROVIDER_UNAVAILABLE', attemptOutcome: 'unknown' };
  }

  const statusCode = error.statusCode;
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) {
    return { safeCode: 'AI_PROVIDER_UNAVAILABLE', attemptOutcome: 'unknown' };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { safeCode: 'AI_PROVIDER_AUTH', attemptOutcome: 'failed' };
  }
  if (statusCode >= 400 && statusCode <= 599) {
    return { safeCode: 'AI_PROVIDER_UNAVAILABLE', attemptOutcome: 'failed' };
  }
  return { safeCode: 'AI_INTERNAL', attemptOutcome: 'unknown' };
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
