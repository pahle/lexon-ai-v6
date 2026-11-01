import { expect, test } from 'vitest';
import { readAuthConfig } from '../../src/config/auth-config.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { authConfigEnvironment } from '../setup/auth-environment.js';

test('approved defaults remain configurable and false is parsed as false', () => {
  const env = authConfigEnvironment();
  const config = readAuthConfig(env);
  expect([
    config.cookieSeconds,
    config.cookieRefreshSeconds,
    config.reauthSeconds,
    config.setupSeconds,
    config.bearerSeconds,
    config.invitationSeconds,
    config.verificationSeconds,
    config.resetSeconds,
  ]).toEqual([604800, 86400, 300, 86400, 900, 1209600, 3600, 1800]);
  expect(
    readAuthConfig({
      ...env,
      AUTH_COOKIE_SECONDS: '7200',
      AUTH_COOKIE_REFRESH_SECONDS: '3600',
      AUTH_OPEN_SIGNUP: 'false',
    }),
  ).toMatchObject({
    cookieSeconds: 7200,
    cookieRefreshSeconds: 3600,
    openSignup: false,
    secureCookies: false,
  });
});
test('organization pagination has configurable boot-validated workspace bounds', () => {
  const env = authConfigEnvironment();
  expect(readAuthConfig(env).organizationPagination).toEqual({
    defaultLimit: 20,
    maxLimit: 100,
  });
  expect(
    readAuthConfig({
      ...env,
      AUTH_ORGANIZATION_PAGE_DEFAULT_LIMIT: '5',
      AUTH_ORGANIZATION_PAGE_MAX_LIMIT: '10',
    }).organizationPagination,
  ).toEqual({ defaultLimit: 5, maxLimit: 10 });
  for (const config of [
    { AUTH_ORGANIZATION_PAGE_MAX_LIMIT: '101' },
    { AUTH_ORGANIZATION_PAGE_DEFAULT_LIMIT: '0' },
    {
      AUTH_ORGANIZATION_PAGE_DEFAULT_LIMIT: '11',
      AUTH_ORGANIZATION_PAGE_MAX_LIMIT: '10',
    },
  ])
    expect(() => readAuthConfig({ ...env, ...config })).toThrow();
});
test('durations, independent secrets, identifiers and origins are boot-validated without leaking values', () => {
  const env = authConfigEnvironment();
  for (const invalid of [
    { AUTH_COOKIE_SECONDS: '0' },
    { AUTH_BEARER_SECONDS: '1.5' },
    { AUTH_REAUTH_SECONDS: 'NaN' },
    { AUTH_COOKIE_SECONDS: '3600', AUTH_COOKIE_REFRESH_SECONDS: '7200' },
    { AUTH_OPEN_SIGNUP: 'yes' },
    { AUTH_SECRET: 'secret-sentinel' },
    { AUTH_AUDIT_HMAC_SECRET: env.AUTH_SECRET! },
    { AUTH_AUDIT_HMAC_KEY_ID: 'person@example.test' },
    { AUTH_PUBLIC_ORIGIN: 'https://example.test/path' },
    { AUTH_PUBLIC_ORIGIN: 'secret-sentinel' },
    { DATABASE_AUTH_URL: 'secret-sentinel' },
    { SMTP_URL: 'https://example.test' },
  ]) {
    let failure: unknown;
    try {
      readAuthConfig({ ...env, ...invalid });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const leaked =
      String(failure).includes('secret-sentinel') ||
      JSON.stringify(failure).includes('secret-sentinel');
    expect(leaked).toBe(false);
  }
});
test('insecure cookies require explicit local mode and a loopback public origin', () => {
  const env = authConfigEnvironment();
  expect(() =>
    readAuthConfig({ ...env, AUTH_LOCAL_DEVELOPMENT: 'false' }),
  ).toThrow();
  expect(() =>
    readAuthConfig({ ...env, AUTH_PUBLIC_ORIGIN: 'http://example.test' }),
  ).toThrow();
  expect(
    readAuthConfig({
      ...env,
      AUTH_PUBLIC_ORIGIN: 'https://lexon.example',
      AUTH_LOCAL_DEVELOPMENT: 'false',
    }).secureCookies,
  ).toBe(true);
});
test('workers do not require or retain API identity configuration', () => {
  const env = {
    DATABASE_APP_URL: 'postgresql://app:test@localhost/test',
    VALKEY_QUEUE_URL: 'redis://localhost:6379',
    VALKEY_STREAMS_URL: 'redis://localhost:6379',
    VALKEY_LIMITER_URL: 'redis://localhost:6379',
  };
  for (const runtime of ['ai-worker', 'dispatcher'] as const)
    expect(loadRuntimeConfig(runtime, env)).not.toHaveProperty('auth');
});

test('rate overrides and trusted proxy ranges are strict boot configuration', () => {
  const env = authConfigEnvironment();
  const value = readAuthConfig({
    ...env,
    AUTH_RATE_RULES_JSON: JSON.stringify({
      signin: { account: 2, ip: 4, windowSeconds: 10 },
    }),
    AUTH_TRUSTED_PROXIES: '127.0.0.1,10.0.0.0/8',
  });
  expect(value.rateRules.signin).toEqual({
    account: 2,
    ip: 4,
    windowSeconds: 10,
  });
  expect(value.trustedProxies).toEqual(['127.0.0.1', '10.0.0.0/8']);
  value.rateRules.signup.account = 99;
  expect(readAuthConfig(env).rateRules.signup.account).toBe(3);
  for (const invalid of [
    JSON.stringify({ signin: { account: 0, ip: 4, windowSeconds: 10 } }),
    JSON.stringify({ unknown: { account: 1, ip: 1, windowSeconds: 1 } }),
    JSON.stringify({
      signin: { account: 1, ip: 1, windowSeconds: 1, insurance: true },
    }),
    'not-json',
  ])
    expect(() =>
      readAuthConfig({ ...env, AUTH_RATE_RULES_JSON: invalid }),
    ).toThrow();
  expect(() =>
    readAuthConfig({ ...env, AUTH_TRUSTED_PROXIES: '10.0.0.0/99' }),
  ).toThrow();
});
