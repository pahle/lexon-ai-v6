import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { PaginationSchema } from '@lexon/contracts';
import { withVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { OrganizationController } from '../../src/modules/organizations/organization.controller.js';
import {
  OrganizationInvitationController,
  RecipientInvitationController,
} from '../../src/modules/organizations/invitation.controller.js';
import { MembershipController } from '../../src/modules/organizations/membership.controller.js';
import { ProvisioningController } from '../../src/modules/organizations/provisioning.controller.js';

// Characterisation pins (F4.4 task 6): how each paging controller turns a raw
// HTTP query object into the { limit?, cursor? } argument of its service. The
// service double reproduces the downstream contract every real list service
// applies first — PaginationSchema.parse — so a value that today's loose
// controller schema accepts but the bound rejects still rejects here, at the
// same observable point (a ZodError, i.e. 400 VALIDATION_ERROR end-to-end).
const orgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const identity = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  activeOrganizationId: orgId,
  channel: 'cookie' as const,
  platformAdmin: false,
  mfaVerifiedAt: null,
  reauthenticatedAt: null,
};

function pagedService() {
  return vi.fn(async (...args: unknown[]) =>
    PaginationSchema.parse(args[args.length - 1]),
  );
}
function run(call: () => unknown) {
  return withVerifiedIdentity(identity, async () => call());
}

const endpoints: {
  name: string;
  call: (query: unknown) => unknown;
  list: () => ReturnType<typeof pagedService>;
}[] = [];
{
  const list = pagedService();
  const controller = new OrganizationController({ list } as never, {} as never);
  endpoints.push({
    name: 'GET /organizations',
    call: (query) => controller.list(query),
    list: () => list,
  });
}
{
  const listForOrganization = pagedService();
  const controller = new OrganizationInvitationController({
    listForOrganization,
  } as never);
  endpoints.push({
    name: 'GET /organizations/:id/invitations',
    call: (query) => controller.list(orgId, query),
    list: () => listForOrganization,
  });
}
{
  const listMine = pagedService();
  const controller = new RecipientInvitationController({
    listMine,
  } as never);
  endpoints.push({
    name: 'GET /identity/invitations',
    call: (query) => controller.list(query),
    list: () => listMine,
  });
}
{
  const list = pagedService();
  const controller = new MembershipController({ list } as never);
  endpoints.push({
    name: 'GET /organizations/:id/members',
    call: (query) => controller.list(orgId, query),
    list: () => list,
  });
}
{
  const list = pagedService();
  const controller = new ProvisioningController({ list } as never);
  endpoints.push({
    name: 'GET /platform/provisioning',
    call: (query) => controller.list(query),
    list: () => list,
  });
}

for (const endpoint of endpoints) {
  test(`${endpoint.name} coerces a numeric limit and forwards it`, async () => {
    const list = endpoint.list();
    list.mockClear();
    for (const [raw, limit] of [
      [{ limit: '5' }, 5],
      [{ limit: ' 5 ' }, 5],
      [{ limit: '1e2' }, 100],
      [{ limit: '0x10' }, 16],
      [{ limit: ['7'] }, 7],
    ] as const) {
      list.mockClear();
      await run(() => endpoint.call(raw));
      expect(list.mock.calls[0]!.at(-1)).toEqual({ limit });
    }
  });

  test(`${endpoint.name} forwards a uuid cursor`, async () => {
    const list = endpoint.list();
    list.mockClear();
    await run(() => endpoint.call({ cursor: uuid }));
    expect(list.mock.calls[0]!.at(-1)).toEqual({ cursor: uuid });
    list.mockClear();
    await run(() => endpoint.call({ limit: '5', cursor: uuid }));
    expect(list.mock.calls[0]!.at(-1)).toEqual({ limit: 5, cursor: uuid });
  });

  test(`${endpoint.name} forwards an empty query unchanged`, async () => {
    const list = endpoint.list();
    list.mockClear();
    await expect(run(() => endpoint.call({}))).resolves.toEqual({
      limit: 20,
    });
    expect(list.mock.calls[0]!.at(-1)).toEqual({});
  });

  for (const raw of [
    { limit: 'abc' },
    { limit: 'NaN' },
    { limit: 'Infinity' },
    { limit: 'true' },
    { limit: '' },
    { limit: '0' },
    { limit: '-3' },
    { limit: '5.5' },
    { limit: '101' },
    { limit: '0x' },
    { limit: ['5', '6'] },
    { cursor: 'nope' },
    { cursor: '' },
    { foo: '1' },
    { limit: '5', page: '1' },
    { LIMIT: '5' },
  ]) {
    test(`${endpoint.name} rejects ${JSON.stringify(raw)} with a ZodError`, async () => {
      const list = endpoint.list();
      list.mockClear();
      await expect(run(() => endpoint.call(raw))).rejects.toBeInstanceOf(
        z.ZodError,
      );
    });
  }
}
