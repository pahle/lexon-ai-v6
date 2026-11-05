import { expect, it } from 'vitest';
import { validateRealModelPrerequisites } from './real-model-prerequisites.js';

it('accepts a dated ZDR-only attestation and returns only its review date', () => {
  expect(
    validateRealModelPrerequisites(
      {
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2026-11-05',
        OPENROUTER_API_KEY: 'must-not-be-returned',
      },
      new Date('2026-11-05T12:00:00.000Z'),
    ),
  ).toEqual({ verifiedOn: '2026-11-05' });
});

it.each([
  { env: {}, now: '2026-11-05T12:00:00.000Z' },
  {
    env: { LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: 'yesterday' },
    now: '2026-11-05T12:00:00.000Z',
  },
  {
    env: { LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2026-02-30' },
    now: '2026-11-05T12:00:00.000Z',
  },
  {
    env: { LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2026-11-06' },
    now: '2026-11-05T23:59:59.999Z',
  },
])(
  'rejects missing, invalid, or future ZDR-only attestation: %o',
  ({ env, now }) => {
    expect(() =>
      validateRealModelPrerequisites(
        { ...env, OPENROUTER_API_KEY: 'K1-secret' },
        new Date(now),
      ),
    ).toThrow(/ZDR-only account.*key credit limit/);
    try {
      validateRealModelPrerequisites(
        { ...env, OPENROUTER_API_KEY: 'K1-secret' },
        new Date(now),
      );
    } catch (error) {
      expect(String(error)).not.toContain('K1-secret');
    }
  },
);
