import { createHash } from 'node:crypto';

export interface CanonicalOperationInput {
  readonly toolId: string;
  readonly toolVersion: number;
  readonly args: unknown;
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Expected JSON data');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('Expected JSON data');
  if (ancestors.has(value)) throw new TypeError('Expected JSON data');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        throw new TypeError('Expected JSON data');
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol'))
        throw new TypeError('Expected JSON data');
      const keys = Object.keys(value);
      if (keys.length !== value.length || ownKeys.length !== value.length + 1)
        throw new TypeError('Expected JSON data');
      return `[${Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(value, index))
          throw new TypeError('Expected JSON data');
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('Expected JSON data');
        return canonicalJson(descriptor.value, ancestors);
      }).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError('Expected JSON data');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol'))
      throw new TypeError('Expected JSON data');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    return `{${keys
      .map((key) => {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !('value' in descriptor))
          throw new TypeError('Expected JSON data');
        return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
      })
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
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
