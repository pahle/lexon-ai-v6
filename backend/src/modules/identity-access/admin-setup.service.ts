import { z } from 'zod';
import type { AuthIntegration } from '../../infrastructure/db/index.js';
import { OrganizationAuthPort } from './organization-auth.port.js';
import { IdentityError } from './identity-error.js';
import type { VerifiedIdentity } from './identity.types.js';
import { appendAuthAudit } from '../audit/index.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EmailAddressSchema } from '@lexon/contracts';
import type {
  AdminSetupOperator,
  AdminSetupGrant,
} from '../../infrastructure/db/index.js';
import { correlateEmail, AuditEventSchema } from '../audit/index.js';
import { decideAdminSetup } from './admin-setup-policy.js';
export interface AdminSetupDependencies {
  operator: AdminSetupOperator;
  origin: string;
  setupSeconds: number;
  auditSecret: string;
  auditKeyId: string;
  send: (message: { email: string; url: string }) => Promise<void>;
}
export async function runAdminSetup(
  input: { email: string; additional: boolean },
  deps: AdminSetupDependencies,
): Promise<{ status: 'created' | 'pending' | 'refused' }> {
  const email = EmailAddressSchema.parse(input.email);
  const result = await deps.operator.transaction(async (tx) => {
    const facts = await tx.facts(email);
    const status = decideAdminSetup({
      email,
      additional: input.additional,
      adminExists: facts.adminExists,
      pendingInitialEmail: facts.pendingInitialEmail,
      existingPending:
        !!facts.grant && Date.parse(facts.grant.expiresAt) > Date.now(),
    });
    const token =
      status !== 'refused' ? randomBytes(32).toString('base64url') : null;
    const grant: AdminSetupGrant | null = token
      ? {
          id: facts.grant?.id ?? randomUUID(),
          identifier: `lexon.admin-setup.v1:${createHash('sha256').update(token).digest('hex')}`,
          value: JSON.stringify({
            version: 1,
            email,
            status: 'pending',
            additional: input.additional,
            boundUserId: facts.userId,
          }),
          expiresAt: new Date(
            Date.now() + deps.setupSeconds * 1000,
          ).toISOString(),
        }
      : null;
    const event = AuditEventSchema.parse({
      version: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'platform.admin_setup_invoked.v1',
      outcome: status === 'refused' ? 'refused' : 'success',
      ...(facts.userId ? { subjectUserId: facts.userId } : {}),
      metadata: {
        additional: input.additional,
        status,
        ...(!facts.userId
          ? correlateEmail(email, deps.auditSecret, deps.auditKeyId)
          : {}),
      },
    });
    await tx.begin({ email, expected: facts, grant, event });
    return { status, token };
  });
  if (result.token) {
    const url = new URL('/admin-setup', deps.origin);
    url.searchParams.set('token', result.token);
    await deps.send({ email, url: url.toString() });
  }
  return { status: result.status };
}

const pendingGrant = z.strictObject({
  version: z.literal(1),
  email: z.email(),
  status: z.literal('pending'),
  additional: z.boolean(),
  boundUserId: z.uuid().nullable(),
});
function setupDigest(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new IdentityError('ORG_FORBIDDEN', 403);
  return createHash('sha256').update(token).digest('hex');
}
export class AdminSetupService {
  constructor(
    private readonly integration: AuthIntegration,
    private readonly port: OrganizationAuthPort,
  ) {}
  async redeem(token: string): Promise<{ status: 'pending' }> {
    const digest = setupDigest(token);
    return this.integration.transaction(async (tx) => {
      const facts = await tx.call('lexonRedeemAdminSetup', {
        body: { digest },
      });
      if (
        !facts.grant ||
        facts.grant.expiresAt <= new Date() ||
        !pendingGrant.safeParse(JSON.parse(facts.grant.value)).success
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      return { status: 'pending' };
    });
  }
  complete(identity: VerifiedIdentity, token: string): Promise<void> {
    const digest = setupDigest(token);
    return this.port.transaction(identity, async (tx, headers) => {
      const actor = await tx.call('lexonSecurityFacts', { headers });
      if (
        !actor.user?.emailVerified ||
        !actor.user.twoFactorEnabled ||
        !actor.session?.mfaVerifiedAt
      )
        throw new IdentityError('AUTH_2FA_REQUIRED', 403);
      const facts = await tx.call('lexonRedeemAdminSetup', {
        body: { digest, userId: identity.userId },
      });
      if (
        !facts.grant ||
        facts.grant.expiresAt <= new Date() ||
        facts.hasTeamMembership
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const parsed = pendingGrant.safeParse(JSON.parse(facts.grant.value));
      if (
        !parsed.success ||
        parsed.data.email !==
          (
            await tx.call('lexonAccountProfile', {
              body: { userId: identity.userId },
            })
          ).email ||
        (parsed.data.boundUserId !== null &&
          parsed.data.boundUserId !== identity.userId)
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      await tx.call('lexonActivateAdmin', {
        body: {
          digest,
          userId: identity.userId,
          expectedValue: facts.grant.value,
          expectedRole: actor.user.role,
        },
      });
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'platform.admin_activated.v1',
        outcome: 'success',
        actorUserId: identity.userId,
        subjectUserId: identity.userId,
        sessionId: identity.sessionId,
        metadata: { additional: parsed.data.additional },
      });
    });
  }
}
