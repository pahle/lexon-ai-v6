import { describe, expect, test } from 'vitest';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

describe('canonicalOperationHash', () => {
  test('ignores object key insertion order', () => {
    const firstKeyOrder = {
      toolId: 'write-note',
      toolVersion: 1,
      args: { title: 'A', nested: { z: 2, a: 1 } },
    };
    const secondKeyOrder = {
      args: { nested: { a: 1, z: 2 }, title: 'A' },
      toolVersion: 1,
      toolId: 'write-note',
    };

    expect(canonicalOperationHash(firstKeyOrder)).toBe(
      canonicalOperationHash(secondKeyOrder),
    );
  });

  test('changes for arguments and tool version', () => {
    const baseline = {
      toolId: 'write-note',
      toolVersion: 1,
      args: { title: 'A' },
    };

    expect(
      canonicalOperationHash({ ...baseline, args: { title: 'B' } }),
    ).not.toBe(canonicalOperationHash(baseline));
    expect(canonicalOperationHash({ ...baseline, toolVersion: 2 })).not.toBe(
      canonicalOperationHash(baseline),
    );
  });

  test('rejects values that are not JSON data', () => {
    expect(() =>
      canonicalOperationHash({
        toolId: 'write-note',
        toolVersion: 1,
        args: { value: Number.NaN },
      }),
    ).toThrow();
    expect(() =>
      canonicalOperationHash({
        toolId: 'write-note',
        toolVersion: 1,
        args: { value: BigInt(1) },
      }),
    ).toThrow();
  });

  test('preserves an own __proto__ argument key as data', () => {
    const args = JSON.parse('{"__proto__":{"enabled":true}}') as object;
    const changedArgs = JSON.parse('{"__proto__":{"enabled":false}}') as object;
    const hash = canonicalOperationHash({
      toolId: 'write-note',
      toolVersion: 1,
      args,
    });

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      canonicalOperationHash({
        toolId: 'write-note',
        toolVersion: 1,
        args: changedArgs,
      }),
    ).not.toBe(hash);
  });
});
