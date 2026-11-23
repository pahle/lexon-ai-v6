import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
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

// A 304 response must end the request and hand nothing back to the framework:
// returning the Response object lets the transport try to write a body on an
// already-ended response (ERR_HTTP_HEADERS_SENT).
test('GET chat returns undefined after ending a 304 response', async () => {
  const chatId = randomUUID();
  const identities = new RequestIdentity();
  const request = {};
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    ended: false,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  const chats = {
    get: vi.fn(async () => ({ notModified: true, etag: 'W/"v1.tag"' })),
  };
  const authorization = {
    withActor: async (
      _identity: unknown,
      action: (actor: { orgId: string; userId: string }) => Promise<unknown>,
    ) => action({ orgId: randomUUID(), userId: randomUUID() }),
  };
  const controller = new ChatController(
    chats as never,
    authorization as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const context = cookieIdentityHeaders('https://lexon.example');
  identities.prepare(
    request,
    {
      identity: context.identity,
      tenant: context.tenant,
      summary: context.summary,
    } as Parameters<RequestIdentity['prepare']>[1],
    context.headers,
  );
  const result = await identities.run(request, () =>
    controller.get(chatId, 'W/"v1.tag"', response as never),
  );
  expect(result).toBeUndefined();
  expect(response.statusCode).toBe(304);
  expect(response.ended).toBe(true);
  expect(headers).toEqual({
    etag: 'W/"v1.tag"',
    'cache-control': 'no-store',
  });
});
