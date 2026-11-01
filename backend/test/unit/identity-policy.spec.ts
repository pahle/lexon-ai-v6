import { expect, test } from 'vitest';
import { OrgActionSchema, type OrgRole } from '@lexon/contracts';
import { IdentityPolicy } from '../../src/modules/identity-access/identity-policy.js';

const policy = new IdentityPolicy();
const all = ['none', 'member', 'admin', 'owner'];
// Approved design matrix. Columns are existing target roles; 'none' means
// an action without a target. No platform role appears in this permission set.
const approved: Record<string, Partial<Record<string, readonly string[]>>> = {
  create_team: { none: all, member: all, admin: all, owner: all },
  read_members: { member: all, admin: all, owner: all },
  read_invitations: { admin: all, owner: all },
  invite_member: { admin: all, owner: all },
  invite_admin: { owner: all },
  promote_owner: { owner: ['member', 'admin', 'owner'] },
  change_role: {
    admin: ['member', 'admin'],
    owner: ['member', 'admin', 'owner'],
  },
  remove_member: { admin: ['member'], owner: ['member', 'admin', 'owner'] },
  leave: { member: all, admin: all, owner: all },
  settings: { owner: all },
};
test('approved team role matrix covers every action, actor and target combination', () => {
  expect(Object.keys(approved).sort()).toEqual(
    [...OrgActionSchema.options].sort(),
  );
  for (const action of OrgActionSchema.options)
    for (const actorRole of [null, 'member', 'admin', 'owner'] as const)
      for (const targetRole of [
        undefined,
        'member',
        'admin',
        'owner',
      ] as const) {
        const input = {
          action,
          actorRole,
          kind: 'team' as const,
          ...(targetRole ? { targetRole: targetRole as OrgRole } : {}),
        };
        const expected =
          approved[action]?.[actorRole ?? 'none']?.includes(
            targetRole ?? 'none',
          ) ?? false;
        expect(policy.can(input), `${action}/${actorRole}/${targetRole}`).toBe(
          expected,
        );
        expect(policy.can({ ...input, kind: 'personal' })).toBe(false);
      }
});
test('platform status grants no team privilege and denied policy has one safe error', () => {
  const input = {
    action: 'settings' as const,
    actorRole: null,
    kind: 'team' as const,
    platformAdmin: true,
  };
  expect(policy.can(input)).toBe(false);
  expect(() => policy.require(input)).toThrow(
    expect.objectContaining({ code: 'ORG_FORBIDDEN', status: 403 }),
  );
});
test('account and organization policy requires actual finite MFA evidence', () => {
  const user = {
    banned: false,
    emailVerified: true,
    twoFactorEnabled: false,
    role: 'user',
  };
  expect(() => policy.requireAccount(user, null)).not.toThrow();
  expect(() =>
    policy.require({ action: 'leave', actorRole: 'member', kind: 'team' }),
  ).not.toThrow();
  for (const [account, mfa, options, code] of [
    [{ ...user, banned: true }, null, {}, 'AUTH_REQUIRED'],
    [
      { ...user, emailVerified: false },
      null,
      {},
      'AUTH_EMAIL_VERIFICATION_REQUIRED',
    ],
    [user, null, { platform: true }, 'ORG_FORBIDDEN'],
    [{ ...user, role: 'admin' }, null, {}, 'AUTH_2FA_REQUIRED'],
    [{ ...user, twoFactorEnabled: true }, null, {}, 'AUTH_2FA_REQUIRED'],
    [
      { ...user, twoFactorEnabled: true },
      new Date(NaN),
      {},
      'AUTH_2FA_REQUIRED',
    ],
  ] as const)
    expect(() => policy.requireAccount(account, mfa, options)).toThrow(
      expect.objectContaining({ code }),
    );
  expect(() =>
    policy.requireAccount({ ...user, twoFactorEnabled: true }, new Date()),
  ).not.toThrow();
  expect(() =>
    policy.requireAccount(
      { ...user, role: 'admin', twoFactorEnabled: true },
      new Date(),
      { platform: true },
    ),
  ).not.toThrow();
  expect(() =>
    policy.requireAccount({ ...user, twoFactorEnabled: true }, null, {
      allowIncompleteMfa: true,
    }),
  ).not.toThrow();
  for (const date of [null, new Date(NaN)])
    expect(() => policy.requireOrganizationMfa(true, date)).toThrow(
      expect.objectContaining({ code: 'AUTH_2FA_REQUIRED' }),
    );
  expect(() => policy.requireOrganizationMfa(true, new Date())).not.toThrow();
  expect(() => policy.requireOrganizationMfa(false, null)).not.toThrow();
});
