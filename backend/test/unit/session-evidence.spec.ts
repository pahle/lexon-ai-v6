import { expect, test } from 'vitest';
import { SessionEvidence } from '../../src/modules/identity-access/session-evidence.js';
import { withVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';

const facts = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  activeOrganizationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  channel: 'cookie' as const,
  platformAdmin: false,
  mfaVerifiedAt: null,
  reauthenticatedAt: null,
};
const now = new Date('2026-11-01T00:00:00Z');
test('MFA requires session evidence, never the account enrollment flag', async () => {
  const evidence = new SessionEvidence();
  await withVerifiedIdentity(facts, async (identity) => {
    expect(() => evidence.requireMfa(identity)).toThrow(
      expect.objectContaining({ code: 'AUTH_2FA_REQUIRED' }),
    );
  });
  await withVerifiedIdentity(
    { ...facts, mfaVerifiedAt: now },
    async (identity) => {
      expect(() => evidence.requireMfa(identity)).not.toThrow();
    },
  );
});
test('recent reauthentication expires at the boundary and rejects future or missing evidence', async () => {
  const evidence = new SessionEvidence();
  for (const age of [null, -1, 300, 301]) {
    await withVerifiedIdentity(
      {
        ...facts,
        reauthenticatedAt:
          age === null ? null : new Date(now.getTime() - age * 1000),
      },
      async (identity) => {
        expect(() => evidence.requireRecent(identity, now, 300)).toThrow(
          expect.objectContaining({ code: 'AUTH_REAUTH_REQUIRED' }),
        );
      },
    );
  }
  await withVerifiedIdentity(
    { ...facts, reauthenticatedAt: new Date(now.getTime() - 299999) },
    async (identity) => {
      expect(() => evidence.requireRecent(identity, now, 300)).not.toThrow();
    },
  );
});
test('nonfinite session MFA and clock evidence cannot authorize security changes', async () => {
  const evidence = new SessionEvidence();
  await withVerifiedIdentity(
    {
      ...facts,
      mfaVerifiedAt: new Date(NaN),
      reauthenticatedAt: new Date(NaN),
    },
    async (identity) => {
      expect(() => evidence.requireMfa(identity)).toThrow(
        expect.objectContaining({ code: 'AUTH_2FA_REQUIRED' }),
      );
      expect(() => evidence.requireRecent(identity, now, 300)).toThrow(
        expect.objectContaining({ code: 'AUTH_REAUTH_REQUIRED' }),
      );
    },
  );
  await withVerifiedIdentity(
    { ...facts, reauthenticatedAt: now },
    async (identity) => {
      expect(() => evidence.requireRecent(identity, now, 300)).not.toThrow();
      expect(() =>
        evidence.requireRecent(identity, new Date(NaN), 300),
      ).toThrow();
    },
  );
});
import type { VerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
test('forged and expired-scope identity objects cannot authorize even valid evidence', async () => {
  const evidence = new SessionEvidence();
  const valid = { ...facts, mfaVerifiedAt: now, reauthenticatedAt: now };
  const forged = valid as unknown as VerifiedIdentity;
  for (const operation of [
    () => evidence.requireMfa(forged),
    () => evidence.requireRecent(forged, now, 300),
  ])
    expect(operation).toThrow(
      expect.objectContaining({ code: 'AUTH_REQUIRED' }),
    );
  let escaped: VerifiedIdentity | undefined;
  await withVerifiedIdentity(valid, async (identity) => {
    escaped = identity;
  });
  expect(() => evidence.requireMfa(escaped!)).toThrow(
    expect.objectContaining({ code: 'AUTH_REQUIRED' }),
  );
  expect(() => evidence.requireRecent(escaped!, now, 300)).toThrow(
    expect.objectContaining({ code: 'AUTH_REQUIRED' }),
  );
});
