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
    expect(
      (
        (await (await api.call('/identity', actor.headers)).json()) as {
          platformAdmin: boolean;
        }
      ).platformAdmin,
    ).toBe(false);
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
    const nativeAdmin = await api.user('Native admin without MFA');
    await inspect.makeAdmin(nativeAdmin.profile.id);
    const nativeAdminIdentity = await api.call(
      '/identity',
      nativeAdmin.headers,
    );
    expect(nativeAdminIdentity.status).toBe(403);
    expect(await nativeAdminIdentity.json()).toMatchObject({
      error: { code: 'AUTH_2FA_REQUIRED' },
    });
    const originalSessionHeaders = { ...actor.headers };
    const secondSignIn = await api.call('/auth/sign-in/email', {}, 'POST', {
      email: actor.profile.email,
      password: actor.password,
    });
    expect(secondSignIn.status).toBe(200);
    const enrolledAdmin = {
      ...actor,
      headers: {
        cookie: secondSignIn.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; '),
      },
    };
    await api.enroll(enrolledAdmin);
    expect(
      (
        (await (await api.call('/identity', enrolledAdmin.headers)).json()) as {
          platformAdmin: boolean;
        }
      ).platformAdmin,
    ).toBe(false);
    await inspect.makeAdmin(actor.profile.id);
    const staleIdentity = await api.call('/identity', originalSessionHeaders);
    expect(staleIdentity.status).toBe(403);
    expect(await staleIdentity.json()).toMatchObject({
      error: { code: 'AUTH_2FA_REQUIRED' },
    });
    expect(
      (
        (await (await api.call('/identity', enrolledAdmin.headers)).json()) as {
          platformAdmin: boolean;
        }
      ).platformAdmin,
    ).toBe(true);
    const provisioning = await api.call(
      '/platform/provisioning',
      enrolledAdmin.headers,
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
      const response = await api.call(path, enrolledAdmin.headers);
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

test('the identity summary reports the member count of the active team only', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  try {
    const owner = await api.user('Count owner');
    const colleague = await api.user('Count colleague');
    const third = await api.user('Count third');
    const outsider = await api.user('Count outsider');
    const identity = async (actor: typeof owner) =>
      (await (await api.call('/identity', actor.headers)).json()) as {
        organization: { id: string; kind: string };
        organizationMemberCount: number | null;
      };

    // Personal workspace: no count.
    expect(await identity(owner)).toMatchObject({
      organization: { kind: 'personal' },
      organizationMemberCount: null,
    });

    const created = await api.call('/organizations', owner.headers, 'POST', {
      name: 'Count team',
      slug: 'count-' + randomUUID().slice(0, 8),
    });
    expect(created.status).toBe(201);
    const team = (await created.json()) as { id: string };
    const activate = async (actor: typeof owner) =>
      api.call('/organizations/active', actor.headers, 'POST', {
        organizationId: team.id,
      });
    expect((await activate(owner)).status).toBe(200);
    expect(await identity(owner)).toMatchObject({
      organization: { id: team.id, kind: 'team' },
      organizationMemberCount: 1,
    });

    const join = async (actor: typeof owner) => {
      const invited = await api.call(
        '/organizations/' + team.id + '/invitations',
        owner.headers,
        'POST',
        { email: actor.profile.email, role: 'member' },
      );
      expect(invited.status).toBe(201);
      const invitation = (await invited.json()) as { id: string };
      const accepted = await api.call(
        '/invitations/' + invitation.id + '/accept',
        actor.headers,
        'POST',
      );
      expect(accepted.status).toBe(200);
    };
    await join(colleague);
    // Every member of the team sees the same count.
    expect((await identity(owner)).organizationMemberCount).toBe(2);
    expect(await identity(colleague)).toMatchObject({
      organization: { id: team.id, kind: 'team' },
      organizationMemberCount: 2,
    });

    await join(third);
    expect((await identity(owner)).organizationMemberCount).toBe(3);
    expect((await identity(colleague)).organizationMemberCount).toBe(3);

    // A user outside the team cannot select it and never receives its count.
    expect((await activate(outsider)).status).not.toBe(200);
    expect(await identity(outsider)).toMatchObject({
      organization: { kind: 'personal' },
      organizationMemberCount: null,
    });
  } finally {
    await api.close();
  }
});

// The default per-IP signup and verification limits (10 per 10 minutes) are
// shared by every test in this file; these tests add four more users.
const WIDE_LIMITS = JSON.stringify(
  Object.fromEntries(
    ['signup', 'verification-resend'].map((action) => [
      action,
      { account: 3, ip: 1000, windowSeconds: 600 },
    ]),
  ),
);

type ProfileBody = { id: string; name: string; jobTitle: string | null };

test('the profile endpoint validates, trims, clears, and isolates the job title', async ({
  services,
}) => {
  const api = await identityApiHarness(services, undefined, WIDE_LIMITS);
  const inspect = createAuthInspector(services);
  try {
    const actor = await api.user('Title actor');
    const other = await api.user('Title other');
    const stored = (id: string) => inspect.jobTitle(id);
    const patch = (
      headers: Record<string, string>,
      body: unknown,
      query = '',
    ) => api.call('/identity/profile' + query, headers, 'PATCH', body);
    const profile = async (actorArg: typeof actor) =>
      (await (
        await api.call('/identity/profile', actorArg.headers)
      ).json()) as ProfileBody;

    expect((await profile(actor)).jobTitle).toBeNull();
    const saved = await patch(actor.headers, {
      jobTitle: '  Senior Associate ',
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as ProfileBody).jobTitle).toBe(
      'Senior Associate',
    );
    expect((await profile(actor)).jobTitle).toBe('Senior Associate');
    const summary = (await (
      await api.call('/identity', actor.headers)
    ).json()) as {
      user: ProfileBody;
    };
    expect(summary.user.jobTitle).toBe('Senior Associate');

    // Invalid bodies are rejected and change nothing.
    for (const body of [
      { jobTitle: '' },
      { jobTitle: '   ' },
      { jobTitle: 'a'.repeat(81) },
      { jobTitle: 5 },
      {},
    ]) {
      expect(
        (await patch(actor.headers, body)).status,
        JSON.stringify(body),
      ).toBe(400);
      expect(await stored(actor.profile.id)).toBe('Senior Associate');
    }
    // Boundaries.
    expect(
      (await patch(actor.headers, { jobTitle: 'a'.repeat(80) })).status,
    ).toBe(200);
    expect(await stored(actor.profile.id)).toBe('a'.repeat(80));
    expect((await patch(actor.headers, { jobTitle: 'x' })).status).toBe(200);

    // Name and job title update independently.
    const renamed = await patch(actor.headers, { name: 'New Name' });
    expect(await renamed.json()).toMatchObject({
      name: 'New Name',
      jobTitle: 'x',
    });
    const retitled = await patch(actor.headers, { jobTitle: 'Partner' });
    expect(await retitled.json()).toMatchObject({
      name: 'New Name',
      jobTitle: 'Partner',
    });

    // null clears.
    const cleared = await patch(actor.headers, { jobTitle: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as ProfileBody).jobTitle).toBeNull();
    expect(await stored(actor.profile.id)).toBeNull();

    // Cross-user: the user id comes only from the verified session.
    await patch(actor.headers, { jobTitle: 'Actor title' });
    const hijack = await patch(
      other.headers,
      { jobTitle: 'Hacked' },
      '?userId=' + actor.profile.id,
    );
    // The strict query contract rejects `userId`; nothing is written.
    expect(hijack.status).toBe(400);
    expect(await stored(other.profile.id)).toBeNull();
    expect(await stored(actor.profile.id)).toBe('Actor title');
    expect(
      (
        await patch(other.headers, {
          jobTitle: 'Hacked',
          userId: actor.profile.id,
        })
      ).status,
    ).toBe(400);
    expect(await stored(actor.profile.id)).toBe('Actor title');
    await patch(other.headers, { jobTitle: 'Other title' });
    const otherText = await (
      await api.call('/identity/profile', other.headers)
    ).text();
    expect(otherText).toContain('Other title');
    expect(otherText).not.toContain('Actor title');
    expect(await stored(actor.profile.id)).toBe('Actor title');
  } finally {
    await inspect.close();
    await api.close();
  }
});

test('the job title is the same in every organization and absent from member lists', async ({
  services,
}) => {
  const api = await identityApiHarness(services, undefined, WIDE_LIMITS);
  try {
    const owner = await api.user('Title owner');
    const colleague = await api.user('Title colleague');
    const patched = await api.call(
      '/identity/profile',
      owner.headers,
      'PATCH',
      { jobTitle: 'General Counsel' },
    );
    expect(patched.status).toBe(200);
    const created = await api.call('/organizations', owner.headers, 'POST', {
      name: 'Title team',
      slug: 'title-' + randomUUID().slice(0, 8),
    });
    expect(created.status).toBe(201);
    const team = (await created.json()) as { id: string };
    const identity = async (actor: typeof owner) =>
      (await (await api.call('/identity', actor.headers)).json()) as {
        organization: { kind: string };
        user: { jobTitle: string | null };
      };
    const personal = await identity(owner);
    expect(personal.organization.kind).toBe('personal');
    expect(personal.user.jobTitle).toBe('General Counsel');
    expect(
      (
        await api.call('/organizations/active', owner.headers, 'POST', {
          organizationId: team.id,
        })
      ).status,
    ).toBe(200);
    const inTeam = await identity(owner);
    expect(inTeam.organization.kind).toBe('team');
    expect(inTeam.user.jobTitle).toBe('General Counsel');

    const invited = await api.call(
      '/organizations/' + team.id + '/invitations',
      owner.headers,
      'POST',
      { email: colleague.profile.email, role: 'member' },
    );
    expect(invited.status).toBe(201);
    const invitation = (await invited.json()) as { id: string };
    expect(
      (
        await api.call(
          '/invitations/' + invitation.id + '/accept',
          colleague.headers,
          'POST',
        )
      ).status,
    ).toBe(200);
    const members = await api.call(
      '/organizations/' + team.id + '/members',
      colleague.headers,
    );
    expect(members.status).toBe(200);
    const text = await members.text();
    const body = JSON.parse(text) as { items: Record<string, unknown>[] };
    expect(body.items.length).toBe(2);
    for (const row of body.items) expect(row).not.toHaveProperty('jobTitle');
    expect(text).not.toContain('General Counsel');
  } finally {
    await api.close();
  }
});

test("Better Auth's own update-user endpoint cannot write the job title", async ({
  services,
}) => {
  const api = await identityApiHarness(services, undefined, WIDE_LIMITS);
  const inspect = createAuthInspector(services);
  try {
    const actor = await api.user('Native title actor');
    await api.call('/identity/profile', actor.headers, 'PATCH', {
      jobTitle: 'Stored title',
    });
    for (const body of [{ jobTitle: 'x' }, { name: 'Valid', jobTitle: 'x' }]) {
      const response = await api.call(
        '/auth/update-user',
        actor.headers,
        'POST',
        body,
      );
      // Better Auth rejects the input:false field (FIELD_NOT_ALLOWED); the
      // HTTP error mapper reports it as a generic 400.
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await inspect.jobTitle(actor.profile.id)).toBe('Stored title');
    }
  } finally {
    await inspect.close();
    await api.close();
  }
});
