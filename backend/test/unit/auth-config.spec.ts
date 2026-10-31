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
