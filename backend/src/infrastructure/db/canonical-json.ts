/** Deterministic serializer for JSON-safe operation arguments and results. */
export function canonicalJson(
  value: unknown,
  ancestors = new Set<object>(),
): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.includes('\u0000')) throw new TypeError('Expected JSON data');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
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
        if (key.includes('\u0000')) throw new TypeError('Expected JSON data');
        return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
      })
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Counts bytes in PostgreSQL 17 JSONB's textual output representation. */
export function jsonbTextBytes(value: unknown): number {
  return Buffer.byteLength(postgresJsonbText(value, new Set()), 'utf8');
}

function postgresJsonbText(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.includes('\u0000')) throw new TypeError('Expected JSON data');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Expected JSON data');
    return postgresNumericText(value);
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
        return postgresJsonbText(descriptor.value, ancestors);
      }).join(', ')}]`;
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
        if (key.includes('\u0000')) throw new TypeError('Expected JSON data');
        return `${JSON.stringify(key)}: ${postgresJsonbText(descriptor.value, ancestors)}`;
      })
      .join(', ')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function postgresNumericText(value: number): string {
  const encoded = JSON.stringify(value);
  if (!encoded) throw new TypeError('Expected JSON data');
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(encoded);
  if (!match) throw new TypeError('Expected JSON data');
  const sign = match[1] ?? '';
  const whole = match[2]!;
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? '0');
  const digits = `${whole}${fraction}`;
  const decimalPosition = whole.length + exponent;
  if (decimalPosition <= 0)
    return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length)
    return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}
