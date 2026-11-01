import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { UuidSchema } from '@lexon/contracts';

const keyId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const correlation = { subjectHmac: z.string().regex(/^[a-f0-9]{64}$/), keyId };
const reason = z.enum([
  'invalid_credentials',
  'disabled',
  'invalid_factor',
  'rate_limited',
]);
const base = {
  version: z.literal(1),
  eventId: UuidSchema,
  occurredAt: z.iso.datetime(),
  actorUserId: UuidSchema.optional(),
  subjectUserId: UuidSchema.optional(),
  sessionId: UuidSchema.optional(),
  orgId: UuidSchema.optional(),
  invitationId: UuidSchema.optional(),
  memberId: UuidSchema.optional(),
  requestId: UuidSchema.optional(),
};
const failed = z
  .strictObject({
    ...base,
    type: z.literal('identity.sign_in_failed.v1'),
    outcome: z.literal('failure'),
    metadata: z.union([
      z.strictObject({ reason }),
      z.strictObject({ ...correlation, reason }),
    ]),
  })
  .refine(
    (event) =>
      event.subjectUserId
        ? !('subjectHmac' in event.metadata)
        : 'subjectHmac' in event.metadata,
    { message: 'Audit subject is required and unambiguous' },
  );
const success = z.strictObject({
  ...base,
  type: z.literal('identity.sign_in_succeeded.v1'),
  outcome: z.literal('success'),
  subjectUserId: UuidSchema,
  metadata: z.strictObject({ channel: z.enum(['cookie', 'bearer']) }),
});
const organization = z.strictObject({
  ...base,
  type: z.literal('organization.created.v1'),
  outcome: z.literal('success'),
  orgId: UuidSchema,
  actorUserId: UuidSchema,
  metadata: z.strictObject({
    kind: z.enum(['personal', 'team']),
    source: z.enum(['user', 'platform']),
  }),
});
const setup = z
  .strictObject({
    ...base,
    type: z.literal('platform.admin_setup_invoked.v1'),
    outcome: z.enum(['success', 'refused']),
    metadata: z.union([
      z.strictObject({
        additional: z.boolean(),
        status: z.enum(['created', 'pending', 'refused']),
      }),
      z.strictObject({
        ...correlation,
        additional: z.boolean(),
        status: z.enum(['created', 'pending', 'refused']),
      }),
    ]),
  })
  .refine(
    (event) =>
      (event.subjectUserId
        ? !('subjectHmac' in event.metadata)
        : 'subjectHmac' in event.metadata) &&
      (event.metadata.status === 'refused'
        ? event.outcome === 'refused'
        : event.outcome === 'success'),
    { message: 'Invalid administrator setup outcome or subject' },
  );
const account = z.strictObject({
  ...base,
  type: z.literal('identity.account_changed.v1'),
  outcome: z.literal('success'),
  subjectUserId: UuidSchema,
  metadata: z.strictObject({
    action: z.enum([
      'password_changed',
      'password_reset',
      'email_change_requested',
      'email_changed',
      'sessions_revoked',
      'signed_out',
    ]),
  }),
});
const security = z.strictObject({
  ...base,
  type: z.literal('identity.security_changed.v1'),
  outcome: z.literal('success'),
  subjectUserId: UuidSchema,
  actorUserId: UuidSchema,
  sessionId: UuidSchema,
  metadata: z.strictObject({
    action: z.enum([
      'enrollment_started',
      'disabled',
      'recovery_regenerated',
      'mfa_verified',
      'reauthenticated',
    ]),
  }),
});
const settings = z.strictObject({
  ...base,
  type: z.literal('organization.settings_changed.v1'),
  outcome: z.literal('success'),
  orgId: UuidSchema,
  actorUserId: UuidSchema,
  metadata: z.strictObject({
    fields: z
      .array(z.enum(['name', 'slug', 'require2fa']))
      .min(1)
      .max(3)
      .refine((fields) => new Set(fields).size === fields.length),
  }),
});
const invitation = z.strictObject({
  ...base,
  type: z.literal('organization.invitation_changed.v1'),
  outcome: z.literal('success'),
  actorUserId: UuidSchema,
  orgId: UuidSchema,
  invitationId: UuidSchema,
  metadata: z.strictObject({
    action: z.enum([
      'created',
      'resent',
      'cancelled',
      'declined',
      'accepted',
      'expired_replaced',
    ]),
  }),
});
const memberAudit = {
  ...base,
  outcome: z.literal('success'),
  actorUserId: UuidSchema,
  subjectUserId: UuidSchema,
  orgId: UuidSchema,
  memberId: UuidSchema,
};
const departure = z.strictObject({
  ...memberAudit,
  type: z.literal('organization.member_departed.v1'),
  metadata: z.strictObject({ reason: z.enum(['leave', 'remove']) }),
});
const roleChange = z.strictObject({
  ...memberAudit,
  type: z.literal('organization.member_role_changed.v1'),
  metadata: z.strictObject({
    previousRole: z.enum(['member', 'admin', 'owner']),
    role: z.enum(['member', 'admin', 'owner']),
  }),
});
export const AuditEventSchema = z.union([
  failed,
  success,
  organization,
  setup,
  account,
  security,
  settings,
  invitation,
  departure,
  roleChange,
]);
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type OrgAuditEvent = AuditEvent & { orgId: string };

export function validateAuditEvent(event: unknown): AuditEvent {
  const result = AuditEventSchema.safeParse(event);
  if (!result.success) throw new Error('Invalid audit event');
  return result.data;
}
export function correlateEmail(
  normalizedEmail: string,
  secret: string,
  identifier: string,
): { subjectHmac: string; keyId: string } {
  if (!keyId.safeParse(identifier).success || Buffer.byteLength(secret) < 32)
    throw new Error('Invalid audit correlation configuration');
  return {
    subjectHmac: createHmac('sha256', secret)
      .update('lexon.audit.email.v1\0')
      .update(identifier)
      .update('\0')
      .update(normalizedEmail.trim().toLowerCase())
      .digest('hex'),
    keyId: identifier,
  };
}
