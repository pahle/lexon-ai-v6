import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IdentityError } from './identity-error.js';

export interface SignupFacts {
  invitation: {
    email: string;
    status: string;
    expiresAt: string;
    purpose: string;
    organizationState: string;
  } | null;
  setup: { expiresAt: string; value: string } | null;
}
export interface SignupProof {
  invitationId?: string;
  setupDigest?: string;
}
const setupGrant = z
  .object({
    version: z.literal(1),
    email: z.email(),
    status: z.literal('pending'),
    additional: z.boolean(),
    boundUserId: z.uuid().nullable(),
  })
  .strict();

export class SignupPolicy {
  constructor(
    private readonly options: {
      openSignup: boolean;
      readFacts: (proof: SignupProof) => Promise<SignupFacts>;
    },
  ) {}

  async authorize(input: {
    email: string;
    invitationId?: string;
    setupToken?: string;
  }): Promise<void> {
    if (this.options.openSignup) return;
    const email = input.email.trim().toLowerCase();
    const facts = await this.options.readFacts({
      ...(input.invitationId ? { invitationId: input.invitationId } : {}),
      ...(input.setupToken
        ? {
            setupDigest: createHash('sha256')
              .update(input.setupToken)
              .digest('hex'),
          }
        : {}),
    });
    const invitation = facts.invitation;
    if (
      input.invitationId &&
      invitation?.email.trim().toLowerCase() === email &&
      invitation.status === 'pending' &&
      Date.parse(invitation.expiresAt) > Date.now() &&
      ((invitation.purpose === 'team' &&
        invitation.organizationState === 'active') ||
        (invitation.purpose === 'first_owner' &&
          invitation.organizationState === 'provisioning'))
    )
      return;
    if (
      input.setupToken &&
      facts.setup &&
      Date.parse(facts.setup.expiresAt) > Date.now()
    ) {
      let value: unknown;
      try {
        value = JSON.parse(facts.setup.value);
      } catch {
        value = null;
      }
      const grant = setupGrant.safeParse(value);
      if (grant.success && grant.data.email.trim().toLowerCase() === email)
        return;
    }
    throw new IdentityError('AUTH_REQUIRED', 401);
  }
}
