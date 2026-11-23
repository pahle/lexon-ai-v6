import { expect, test } from 'vitest';
import {
  DEFAULT_AUTH_RATE_RULES,
  readAuthRateRules,
} from '../../src/config/auth-rate-config.js';

// Production auth rate-limit defaults. The E2E stack widens some of these
// through AUTH_RATE_RULES_JSON (scripts/e2e.mjs); production must not move.
const PRODUCTION_DEFAULTS = {
  signin: { account: 5, ip: 30, windowSeconds: 60 },
  signup: { account: 3, ip: 10, windowSeconds: 600 },
  reset: { account: 3, ip: 10, windowSeconds: 600 },
  'verification-resend': { account: 3, ip: 10, windowSeconds: 600 },
  totp: { account: 5, ip: 30, windowSeconds: 300 },
  recovery: { account: 5, ip: 30, windowSeconds: 300 },
  'setup-redemption': { account: 5, ip: 20, windowSeconds: 600 },
  'bearer-issuance': { account: 5, ip: 20, windowSeconds: 60 },
  'platform-session-revoke': { account: 5, ip: 20, windowSeconds: 600 },
  'platform-account-invite': { account: 20, ip: 20, windowSeconds: 3600 },
  'platform-account-invite-resend': { account: 3, ip: 10, windowSeconds: 600 },
};

test('production auth rate-limit defaults are pinned', () => {
  expect(DEFAULT_AUTH_RATE_RULES).toEqual(PRODUCTION_DEFAULTS);
  expect(DEFAULT_AUTH_RATE_RULES.totp).toEqual({
    account: 5,
    ip: 30,
    windowSeconds: 300,
  });
  expect(DEFAULT_AUTH_RATE_RULES['setup-redemption']).toEqual({
    account: 5,
    ip: 20,
    windowSeconds: 600,
  });
});

test('without AUTH_RATE_RULES_JSON the production defaults apply exactly', () => {
  const rules = readAuthRateRules(undefined);
  expect(rules).toEqual(PRODUCTION_DEFAULTS);
  expect(rules).not.toBe(DEFAULT_AUTH_RATE_RULES);
});
