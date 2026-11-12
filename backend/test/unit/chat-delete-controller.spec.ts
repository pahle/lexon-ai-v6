import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';
import { ChatController } from '../../src/modules/chat/chat.controller.js';

function cookieIdentityHeaders(origin: string) {
  const userId = randomUUID();
  const orgId = randomUUID();
  return {
    identity: {
      userId,
      sessionId: randomUUID(),
      activeOrganizationId: orgId,
      channel: 'cookie' as const,
      platformAdmin: false,
      mfaVerifiedAt: null,
      reauthenticatedAt: null,
    },
    tenant: { orgId, userId, role: 'owner' as const },
    summary: {
      user: { id: userId, name: 'Owner', email: 'owner@example.test' },
      organization: { id: orgId, name: 'Team', slug: 'team' },
    },
    headers: new Headers({ origin }),
  };
}

test('DELETE applies cookie origin guard before invoking deletion service', async () => {
  const origin = 'https://lexon.example';
  const identities = new RequestIdentity();
  const request = {};
  const deletionRequest = vi.fn(async () => undefined);
  const authorization = {
    withActor: async (
      _identity: unknown,
      action: (actor: { orgId: string; userId: string }) => Promise<void>,
    ) => action({ orgId: randomUUID(), userId: randomUUID() }),
  };
  const config = { auth: { origin } };
  const controller = new ChatController(
    {} as never,
    authorization as never,
    {} as never,
    { request: deletionRequest } as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
  );
  const context = cookieIdentityHeaders('https://attacker.example');
  identities.prepare(
    request,
    {
      identity: context.identity,
      tenant: context.tenant,
      summary: context.summary,
    } as Parameters<RequestIdentity['prepare']>[1],
    context.headers,
  );
  await expect(
    identities.run(request, () => controller.delete(randomUUID())),
  ).rejects.toMatchObject<Partial<IdentityError>>({ status: 403 });
  expect(deletionRequest).not.toHaveBeenCalled();
});
