import { describe, expect, it } from 'vitest';
import { JobTitleSchema } from '@lexon/contracts';
import { accountProfileBodySchema } from '../../src/infrastructure/db/auth/account-plugin.js';

const userId = '3f1c7c0e-6a53-4b8c-9d54-0e2f6f1a7b11';
const inputs: [string, unknown][] = [
  ['empty', ''],
  ['whitespace', '  '],
  ['80 characters', 'a'.repeat(80)],
  ['81 characters', 'a'.repeat(81)],
  ['null', null],
  ['undefined', undefined],
  ['padded', ' Partner '],
];

describe('job title validation parity', () => {
  it.each(inputs)('%s: shared schema and account plugin agree', (_n, value) => {
    const shared = JobTitleSchema.nullable().optional().safeParse(value);
    const plugin = accountProfileBodySchema.safeParse({
      userId,
      jobTitle: value,
    });
    expect(plugin.success).toBe(shared.success);
    if (shared.success && plugin.success)
      expect(plugin.data.jobTitle).toEqual(shared.data);
  });
});
