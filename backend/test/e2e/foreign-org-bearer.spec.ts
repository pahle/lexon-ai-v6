import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

// A-17: a real bearer token of user A against organization B's resources.
test("user A's bearer token is refused on organization B's members, chats and settings", async ({
  playwright,
}) => {
  test.setTimeout(90_000);
  const stack = descriptor();
  const userA = await playwright.request.newContext();
  const userB = await playwright.request.newContext();
  let bearer: Awaited<ReturnType<typeof playwright.request.newContext>> | null =
    null;
  try {
    const headersA = await authenticateApi(userA, {
      email: `a-${randomUUID()}@example.test`,
    });
    const headersB = await authenticateApi(userB, {
      email: `b-${randomUUID()}@example.test`,
    });
    const orgB = (
      (await (await userB.get(stack.apiUrl + '/api/identity')).json()) as {
        organization: { id: string };
      }
    ).organization.id;
    expect(
      (
        await userB.post(`${stack.apiUrl}/api/identity/onboarding/complete`, {
          headers: headersB,
          data: {},
        })
      ).status(),
    ).toBe(204);
    const chatB = randomUUID();
    expect(
      (
        await userB.post(`${stack.apiUrl}/api/chats`, {
          headers: headersB,
          data: {
            chatId: chatB,
            userMessageId: randomUUID(),
            requestId: randomUUID(),
            text: 'Organization B private chat.',
            effort: 'high',
          },
        })
      ).status(),
    ).toBe(201);

    const issued = (await (
      await userA.post(stack.apiUrl + '/api/identity/bearer-sessions', {
        headers: headersA,
        data: {},
      })
    ).json()) as { token: string };
    bearer = await playwright.request.newContext({
      extraHTTPHeaders: { authorization: 'Bearer ' + issued.token },
    });
    expect((await bearer.get(stack.apiUrl + '/api/identity')).status()).toBe(
      200,
    );

    const members = await bearer.get(
      `${stack.apiUrl}/api/organizations/${orgB}/members`,
    );
    const chats = await bearer.get(`${stack.apiUrl}/api/chats/${chatB}`);
    const settings = await bearer.patch(
      `${stack.apiUrl}/api/organizations/${orgB}/settings`,
      { data: { name: 'Taken over' } },
    );
    // A chat of another organization is indistinguishable from a missing one.
    expect(chats.status()).toBe(404);
    // Organization-scoped identity endpoints keep their ORG_FORBIDDEN 403
    // contract (LEX-ARC-001 identity errors); neither leaks any data.
    for (const response of [members, settings]) {
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: 'ORG_FORBIDDEN' },
      });
    }
  } finally {
    await Promise.all([bearer?.dispose(), userA.dispose(), userB.dispose()]);
  }
});
