import { expect, test } from 'vitest';
import {
  OwnSessionSummarySchema,
  TotpInputSchema,
  RecoveryCodeInputSchema,
  ReauthenticateInputSchema,
  PasswordChangeInputSchema,
  PasswordResetInputSchema,
  EmailChangeInputSchema,
  BearerSessionResponseSchema,
  SecurityStateSchema,
} from '../src/index.js';

test('own session summaries are safe versioned identifiers for cookie and Bearer', () => {
  const session = {
    version: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    channel: 'cookie',
    createdAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-08T00:00:00.000Z',
    current: true,
    deviceName: 'Chrome on macOS',
    deviceKind: 'desktop',
  };
  expect(OwnSessionSummarySchema.parse(session)).toEqual(session);
  expect(
    OwnSessionSummarySchema.safeParse({ ...session, channel: 'bearer' })
      .success,
  ).toBe(true);
  for (const invalid of [
    { deviceName: '' },
    { deviceName: 'x'.repeat(81) },
    { deviceKind: 'watch' },
  ])
    expect(
      OwnSessionSummarySchema.safeParse({ ...session, ...invalid }).success,
    ).toBe(false);
  expect(
    OwnSessionSummarySchema.safeParse({
      ...session,
      deviceName: undefined,
    }).success,
  ).toBe(false);
  for (const extra of [
    { token: 'secret' },
    { email: 'person@example.test' },
    { ipAddress: '127.0.0.1' },
    { userAgent: 'browser' },
    { location: 'Jakarta' },
  ])
    expect(
      OwnSessionSummarySchema.safeParse({ ...session, ...extra }).success,
    ).toBe(false);
  expect(
    BearerSessionResponseSchema.safeParse({
      version: 1,
      sessionId: session.id,
      token: 'opaque-secret',
      expiresAt: session.expiresAt,
    }).success,
  ).toBe(true);
});
test('factor and reauthentication inputs forbid bypass/evidence injection', () => {
  expect(TotpInputSchema.parse({ code: '012345' })).toEqual({ code: '012345' });
  expect(TotpInputSchema.safeParse({ code: '12345' }).success).toBe(false);
  expect(
    TotpInputSchema.safeParse({ code: '123456', trustDevice: true }).success,
  ).toBe(false);
  expect(
    RecoveryCodeInputSchema.safeParse({ code: 'one-time-code' }).success,
  ).toBe(true);
  expect(
    ReauthenticateInputSchema.safeParse({
      password: 'existing',
      totp: '123456',
      recoveryCode: 'recovery',
    }).success,
  ).toBe(false);
  expect(
    ReauthenticateInputSchema.safeParse({
      password: 'existing',
      mfaVerifiedAt: '2026-11-01T00:00:00.000Z',
    }).success,
  ).toBe(false);
});
test('password changes/reset require twelve characters and email changes normalize', () => {
  expect(
    PasswordChangeInputSchema.safeParse({
      currentPassword: 'current',
      newPassword: 'x'.repeat(11),
    }).success,
  ).toBe(false);
  expect(
    PasswordResetInputSchema.safeParse({
      token: 'opaque',
      newPassword: 'x'.repeat(12),
    }).success,
  ).toBe(true);
  expect(
    EmailChangeInputSchema.parse({ newEmail: ' New@Example.test ' }),
  ).toEqual({ newEmail: 'new@example.test' });
});

test('security state exposes evidence flags and counts without factor secrets', () => {
  const state = {
    version: 1,
    twoFactorEnabled: true,
    mfaVerified: true,
    reauthenticationExpiresAt: null,
    recoveryCodesRemaining: 4,
    passwordChangedAt: '2026-09-18T00:00:00.000Z',
  };
  expect(SecurityStateSchema.parse(state)).toEqual(state);
  expect(
    SecurityStateSchema.safeParse({ ...state, passwordChangedAt: null })
      .success,
  ).toBe(true);
  expect(
    SecurityStateSchema.safeParse({ ...state, passwordChangedAt: 'yesterday' })
      .success,
  ).toBe(false);
  expect(
    SecurityStateSchema.safeParse({ ...state, passwordChangedAt: undefined })
      .success,
  ).toBe(false);
  for (const extra of [
    { totpSecret: 'secret' },
    { recoveryCodes: ['secret'] },
    { token: 'secret' },
  ])
    expect(SecurityStateSchema.safeParse({ ...state, ...extra }).success).toBe(
      false,
    );
});
