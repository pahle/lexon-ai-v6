import { expect, it } from 'vitest';
import { validateRealModelPrerequisites } from './real-model-prerequisites.js';

it('accepts a dated ZDR-only attestation and returns only its review date', () => {
  expect(
    validateRealModelPrerequisites({
      LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2026-11-05',
      OPENROUTER_API_KEY: 'must-not-be-returned',
    }),
  ).toEqual({ verifiedOn: '2026-11-05' });
});

it.each([
  {},
  { LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: 'yesterday' },
  { LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2026-11-06' },
])('rejects missing, invalid, or future ZDR-only attestation: %o', (env) => {
  expect(() =>
    validateRealModelPrerequisites({ ...env, OPENROUTER_API_KEY: 'K1-secret' }),
  ).toThrow(/ZDR-only account.*key credit limit/);
  try {
    validateRealModelPrerequisites({ ...env, OPENROUTER_API_KEY: 'K1-secret' });
  } catch (error) {
    expect(String(error)).not.toContain('K1-secret');
  }
});
