import { expect, it } from 'vitest';
import { inspectMetadata } from '../toolchain/metadata.js';

it('injects constructor dependencies using the ESM decorator metadata transform', async () => {
  expect(await inspectMetadata()).toBe('lexon-esm-metadata');
});
