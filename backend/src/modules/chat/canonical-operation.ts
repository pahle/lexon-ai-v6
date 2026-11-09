import { createHash } from 'node:crypto';
import { canonicalJson } from '../../infrastructure/db/index.js';

export interface CanonicalOperationInput {
  readonly toolId: string;
  readonly toolVersion: number;
  readonly args: unknown;
}

export function canonicalOperationHash(input: CanonicalOperationInput): string {
  if (
    !input ||
    typeof input.toolId !== 'string' ||
    input.toolId.length === 0 ||
    !Number.isSafeInteger(input.toolVersion) ||
    input.toolVersion < 1
  )
    throw new TypeError('Invalid operation identity');

  const canonical = canonicalJson({
    toolId: input.toolId,
    toolVersion: input.toolVersion,
    args: input.args,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
