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
