import { isIP } from 'node:net';
import { z } from 'zod';
import { RuntimeConfigurationError } from './configuration-error.js';

export const AUTH_LIMIT_ACTIONS = [
  'signin',
  'signup',
  'reset',
  'verification-resend',
  'totp',
  'recovery',
  'setup-redemption',
  'bearer-issuance',
] as const;
export type AuthLimitAction = (typeof AUTH_LIMIT_ACTIONS)[number];
export interface AuthRateRule {
  account: number;
  ip: number;
  windowSeconds: number;
}
export type AuthRateRules = Record<AuthLimitAction, AuthRateRule>;
export const DEFAULT_AUTH_RATE_RULES: AuthRateRules = {
  signin: { account: 5, ip: 30, windowSeconds: 60 },
  signup: { account: 3, ip: 10, windowSeconds: 600 },
  reset: { account: 3, ip: 10, windowSeconds: 600 },
  'verification-resend': { account: 3, ip: 10, windowSeconds: 600 },
  totp: { account: 5, ip: 30, windowSeconds: 300 },
  recovery: { account: 5, ip: 30, windowSeconds: 300 },
  'setup-redemption': { account: 5, ip: 20, windowSeconds: 600 },
  'bearer-issuance': { account: 5, ip: 20, windowSeconds: 60 },
};
const positive = z.number().int().positive();
const rule = z.strictObject({
  account: positive,
  ip: positive,
  windowSeconds: positive,
});
const overrides = z.partialRecord(z.enum(AUTH_LIMIT_ACTIONS), rule);
export function readAuthRateRules(value: string | undefined): AuthRateRules {
  if (value === undefined) return structuredClone(DEFAULT_AUTH_RATE_RULES);
  try {
    const result = overrides.parse(JSON.parse(value));
    return { ...structuredClone(DEFAULT_AUTH_RATE_RULES), ...result };
  } catch {
    throw new RuntimeConfigurationError(['AUTH_RATE_RULES_JSON']);
  }
}
export function validateTrustedProxies(values: readonly string[]): string[] {
  for (const value of values) {
    const parts = value.split('/');
    const address = parts[0]!;
    const family = isIP(address);
    if (
      !family ||
      parts.length > 2 ||
      (parts.length === 2 &&
        (!/^(0|[1-9][0-9]*)$/.test(parts[1]!) ||
          Number(parts[1]) > (family === 4 ? 32 : 128)))
    )
      throw new RuntimeConfigurationError(['AUTH_TRUSTED_PROXIES']);
  }
  return [...values];
}
export function readTrustedProxies(value: string | undefined): string[] {
  return validateTrustedProxies(
    !value ? [] : value.split(',').map((item) => item.trim()),
  );
}
