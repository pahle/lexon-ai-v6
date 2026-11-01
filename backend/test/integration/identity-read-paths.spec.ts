import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { identityApiHarness } from '../setup/identity-api-harness.js';
import { createAuthInspector } from '../../src/infrastructure/db/testing/auth-inspect.js';
test('identity read inventory isolates account organization invitation session and platform scopes', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const inspect = createAuthInspector(services);
  try {
    const actor = await api.user('Read actor');
    const other = await api.user('Read outsider');
    for (const path of [
      '/identity',
      '/identity/profile',
      '/identity/security',
      '/identity/sessions',
      '/identity/invitations',
      '/organizations',
    ]) {
      const response = await api.call(path, actor.headers);
      expect(response.status, path).toBe(200);
      const text = await response.text();
      expect(
        text.includes(other.profile.id) || text.includes(other.profile.email),
      ).toBe(false);
    }
    for (const path of [
      '/identity/profile',
      '/identity/sessions',
      '/identity/invitations',
    ])
      expect(
        (await api.call(path + '?userId=' + other.profile.id, actor.headers))
          .status,
        path,
      ).toBe(400);
    const created = await api.call('/organizations', actor.headers, 'POST', {
      name: 'Read team',
      slug: 'read-' + randomUUID().slice(0, 8),
    });
    expect(created.status).toBe(201);
    const team = (await created.json()) as { id: string };
    const organizations = (await (
      await api.call('/organizations', actor.headers)
    ).json()) as { items: { id: string; kind: string }[] };
    const personal = organizations.items.find(
      (org) => org.kind === 'personal',
    )!;
    for (const suffix of ['/members', '/invitations']) {
      expect(
        (await api.call('/organizations/' + team.id + suffix, actor.headers))
          .status,
      ).toBe(200);
      expect(
        (await api.call('/organizations/' + team.id + suffix, other.headers))
          .status,
      ).toBe(403);
      expect(
        (
          await api.call(
            '/organizations/' + personal.id + suffix,
            other.headers,
          )
        ).status,
      ).toBe(403);
    }
    const invite = await api.call(
      '/organizations/' + team.id + '/invitations',
      actor.headers,
      'POST',
      { email: other.profile.email, role: 'member' },
    );
    expect(invite.status).toBe(201);
    const mine = (await (
      await api.call('/identity/invitations', other.headers)
    ).json()) as { items: { organizationId: string }[] };
    expect(mine.items.some((row) => row.organizationId === team.id)).toBe(true);
    const notMine = (await (
      await api.call('/identity/invitations', actor.headers)
    ).json()) as { items: unknown[] };
    expect(notMine.items.length).toBe(0);
    await api.enroll(actor);
    await inspect.makeAdmin(actor.profile.id);
    const provisioning = await api.call(
      '/platform/provisioning',
      actor.headers,
      'POST',
      {
        name: 'Metadata only',
        slug: 'metadata-' + randomUUID().slice(0, 8),
        ownerEmail: other.profile.email,
      },
    );
    expect(provisioning.status).toBe(201);
    const provisioned = (await provisioning.json()) as { id: string };
    for (const path of [
      '/platform/provisioning',
      '/platform/provisioning/' + provisioned.id,
    ]) {
      const response = await api.call(path, actor.headers);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(
        ['password', 'token', 'members', 'content'].some((value) =>
          text.includes('"' + value + '"'),
        ),
      ).toBe(false);
      expect((await api.call(path, other.headers)).status).toBe(403);
    }
    const outsiderOrgs = (await (
      await api.call('/organizations', other.headers)
    ).json()) as { items: { id: string }[] };
    expect(
      outsiderOrgs.items.some(
        (org) =>
          org.id === personal.id ||
          org.id === provisioned.id ||
          org.id === team.id,
      ),
    ).toBe(false);
    for (const path of [
      '/audit/events',
      '/ops/audit_events',
      '/identity/audit',
      '/identity/sessions/' + randomUUID(),
    ])
      expect((await api.call(path, other.headers)).status, path).toBe(404);
  } finally {
    await api.close();
    await inspect.close();
  }
});
