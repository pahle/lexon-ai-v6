import { expect, test, vi } from 'vitest';
import { createIdentityClient } from '../src/lib/identity-client';
import { createServerIdentityClient } from '../src/lib/server-identity-client';
test('browser identity requests use shared input, same-origin credentials and safe errors', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json(
      {
        error: { code: 'AUTH_UNAVAILABLE', message: 'secret database host' },
      },
      { status: 503 },
    ),
  );
  const client = createIdentityClient({ baseUrl: '/api', fetch });
  await expect(client.identity()).rejects.toMatchObject({
    code: 'AUTH_UNAVAILABLE',
    status: 503,
    message: 'Service temporarily unavailable.',
  });
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(
    new Headers(fetch.mock.calls[0]![1]?.headers).has('authorization'),
  ).toBe(false);
  await expect(
    client.createOrganization({
      name: 'Team',
      slug: 'team',
      userId: 'forged',
    } as never),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(() =>
    createIdentityClient({ baseUrl: 'https://outside.example/api' }),
  ).toThrow();
});
test('SSR clients scope cookies to each instance and never cache personalized requests', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 }),
    );
  for (const cookie of ['session=a', 'session=b'])
    await expect(
      createServerIdentityClient({
        cookie,
        baseUrl: 'http://backend:3001/api',
        fetch,
      }).identity(),
    ).rejects.toMatchObject({ status: 401 });
  expect(
    fetch.mock.calls.map((call) => new Headers(call[1]?.headers).get('cookie')),
  ).toEqual(['session=a', 'session=b']);
  expect(fetch.mock.calls.every((call) => call[1]?.cache === 'no-store')).toBe(
    true,
  );
});

test('identity client validates the safe platform eligibility summary field', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json({
      version: 1,
      platformAdmin: true,
      user: {
        version: 1,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'admin@example.test',
        name: 'Admin',
        emailVerified: true,
        twoFactorEnabled: true,
        onboardingCompleted: true,
      },
      organization: {
        version: 1,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        name: 'Personal',
        slug: 'personal-admin',
        kind: 'personal',
        state: 'active',
        require2fa: false,
        role: 'owner',
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    }),
  );
  await expect(
    createIdentityClient({ baseUrl: '/api', fetch }).identity(),
  ).resolves.toMatchObject({ platformAdmin: true });
});

test('browser client emits a verified-fallback refresh hint only for known non-identity response headers', async () => {
  const hints: CustomEvent[] = [];
  const onHint = (event: Event) => hints.push(event as CustomEvent);
  window.addEventListener('lexon:identity-fallback-hint', onHint);
  const page = {
    items: [],
    pageInfo: { nextCursor: null },
  };
  try {
    const known = createIdentityClient({
      baseUrl: '/api',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(page, {
          headers: { 'x-lexon-fallback-reason': 'membership_removed' },
        }),
      ),
    });
    await known.listOrganizations({ limit: 20 });
    expect(hints.map((hint) => hint.detail)).toEqual([
      { reason: 'membership_removed' },
    ]);

    hints.length = 0;
    const unknown = createIdentityClient({
      baseUrl: '/api',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(page, {
          headers: { 'x-lexon-fallback-reason': 'unknown-value' },
        }),
      ),
    });
    await unknown.listOrganizations({ limit: 20 });
    expect(hints).toEqual([]);

    const forbidden = createIdentityClient({
      baseUrl: '/api',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'ORG_FORBIDDEN',
              message: 'Not authorized.',
            },
          },
          {
            status: 403,
            headers: { 'x-lexon-fallback-reason': 'selection_repaired' },
          },
        ),
      ),
    });
    await expect(
      forbidden.listOrganizations({ limit: 20 }),
    ).rejects.toMatchObject({
      code: 'ORG_FORBIDDEN',
      status: 403,
      message: 'Unable to complete the request.',
    });
    expect(hints.map((hint) => hint.detail)).toEqual([
      { reason: 'selection_repaired' },
    ]);
  } finally {
    window.removeEventListener('lexon:identity-fallback-hint', onHint);
  }
});

test('server and identity clients do not re-emit a body-backed fallback hint', async () => {
  const hints: Event[] = [];
  const onHint = (event: Event) => hints.push(event);
  window.addEventListener('lexon:identity-fallback-hint', onHint);
  try {
    const server = createServerIdentityClient({
      cookie: 'session=server-only',
      baseUrl: 'http://backend:3001/api',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(
          {
            version: 1,
            platformAdmin: false,
            user: {
              version: 1,
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 'member@example.test',
              name: 'Member',
              emailVerified: true,
              twoFactorEnabled: false,
              onboardingCompleted: true,
            },
            organization: {
              version: 1,
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              name: 'Personal',
              slug: 'personal',
              kind: 'personal',
              state: 'active',
              require2fa: false,
              role: 'owner',
              createdAt: '2026-11-01T00:00:00.000Z',
            },
            fallbackReason: 'membership_removed',
          },
          { headers: { 'x-lexon-fallback-reason': 'membership_removed' } },
        ),
      ),
    });
    await server.identity();
    expect(hints).toEqual([]);

    const browser = createIdentityClient({
      baseUrl: '/api',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(
          {
            version: 1,
            platformAdmin: false,
            user: {
              version: 1,
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 'member@example.test',
              name: 'Member',
              emailVerified: true,
              twoFactorEnabled: false,
              onboardingCompleted: true,
            },
            organization: {
              version: 1,
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              name: 'Personal',
              slug: 'personal',
              kind: 'personal',
              state: 'active',
              require2fa: false,
              role: 'owner',
              createdAt: '2026-11-01T00:00:00.000Z',
            },
            fallbackReason: 'membership_removed',
          },
          { headers: { 'x-lexon-fallback-reason': 'membership_removed' } },
        ),
      ),
    });
    await browser.identity();
    expect(hints).toEqual([]);
  } finally {
    window.removeEventListener('lexon:identity-fallback-hint', onHint);
  }
});
