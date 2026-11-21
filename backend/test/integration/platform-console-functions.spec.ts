import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  createPlatformPools,
  type Pool,
  type PoolClient,
  platformFunctions,
  UUID,
} from '../../src/infrastructure/db/testing/platform-console-fixture.js';

type Seed = {
  name?: string;
  email?: string;
  verified?: boolean;
  banned?: boolean;
  twoFactor?: boolean;
  role?: string | null;
  createdAt?: string;
};

const pools = createPlatformPools;

async function user(pool: Pool | PoolClient, seed: Seed = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO auth."user"(id,name,email,email_verified,banned,two_factor_enabled,role,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamp,now()))`,
    [
      id,
      seed.name ?? 'Person',
      (seed.email ?? `${id}@example.test`).toLowerCase(),
      seed.verified ?? true,
      seed.banned ?? false,
      seed.twoFactor ?? false,
      seed.role ?? null,
      seed.createdAt ?? null,
    ],
  );
  return id;
}

async function team(
  pool: Pool,
  options: { name?: string; owners?: { id: string; at: string }[] } = {},
) {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO auth.organization(id,name,slug,created_at,kind,state) VALUES ($1,$2,$3,now(),'team','active')`,
      [id, options.name ?? 'Team', `team-${id}`],
    );
    for (const owner of options.owners ?? []) {
      await client.query(
        `INSERT INTO auth.member(organization_id,user_id,role,created_at) VALUES ($1,$2,'owner',$3::timestamp)`,
        [id, owner.id, owner.at],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return id;
}

async function columns(pool: Pool, sql: string) {
  const result = await pool.query(sql);
  return result.fields.map((field) => field.name);
}

test('each function runs under lexon_auth', async ({ services }) => {
  const p = pools(services);
  try {
    const admin = await user(p.migrator, { role: 'admin' });
    for (const [name, { args: template }] of Object.entries(
      platformFunctions,
    )) {
      const args = template.replaceAll(UUID, admin);
      const client = await p.auth.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT * FROM auth.${name}(${args})`);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  } finally {
    await p.close();
  }
});

test('read functions return exactly the contract columns', async ({
  services,
}) => {
  const p = pools(services);
  const id = `'${randomUUID()}'::uuid`;
  try {
    const expected: Record<string, string[]> = {
      [`lexon_platform_accounts(NULL,NULL,NULL,10,0)`]: [
        'id',
        'name',
        'email',
        'status',
        'two_factor_enabled',
        'is_platform_administrator',
        'team_count',
        'created_at',
        'last_active_at',
        'total',
      ],
      [`lexon_platform_account(${id})`]: [
        'id',
        'name',
        'email',
        'status',
        'two_factor_enabled',
        'is_platform_administrator',
        'team_count',
        'created_at',
        'last_active_at',
        'email_verified',
        'active_session_count',
      ],
      [`lexon_platform_account_teams(${id})`]: [
        'organization_id',
        'name',
        'slug',
        'role',
      ],
      [`lexon_platform_organizations(NULL,NULL,10,0)`]: [
        'id',
        'name',
        'slug',
        'state',
        'member_count',
        'owner_email',
        'created_at',
        'total',
      ],
      [`lexon_platform_organization(${id})`]: [
        'id',
        'name',
        'slug',
        'state',
        'member_count',
        'owner_email',
        'created_at',
        'require2fa',
        'invitation_id',
        'invitation_status',
        'invitation_expires_at',
      ],
      [`lexon_platform_members(${id},10,0)`]: [
        'user_id',
        'name',
        'email',
        'role',
        'joined_at',
        'total',
      ],
      [`lexon_platform_account_invitations(NULL,NULL,10,0)`]: [
        'id',
        'email',
        'name',
        'status',
        'invited_by_name',
        'sent_at',
        'expires_at',
        'total',
      ],
      [`lexon_platform_lock_enabled_admins()`]: ['id'],
      [`lexon_platform_accounts_total(NULL,NULL,NULL)`]: [
        'lexon_platform_accounts_total',
      ],
    };
    for (const [call, names] of Object.entries(expected)) {
      expect(await columns(p.auth, `SELECT * FROM auth.${call}`), call).toEqual(
        names,
      );
    }
  } finally {
    await p.close();
  }
});

test('status derivation, facets, and last activity', async ({ services }) => {
  const p = pools(services);
  const tag = randomUUID().slice(0, 8);
  try {
    const banned = await user(p.migrator, {
      name: `S ${tag} banned`,
      banned: true,
      verified: false,
    });
    const unverified = await user(p.migrator, {
      name: `S ${tag} unverified`,
      verified: false,
    });
    const active = await user(p.migrator, {
      name: `S ${tag} active`,
      twoFactor: true,
    });
    const active2 = await user(p.migrator, {
      name: `S ${tag} active2`,
      twoFactor: true,
      role: 'admin',
    });
    const plain = await user(p.migrator, { name: `S ${tag} plain` });
    const disabled2fa = await user(p.migrator, {
      name: `S ${tag} off`,
      banned: true,
      twoFactor: true,
    });
    const list = async (statuses: string[] | null, tf: boolean[] | null) =>
      (
        await p.auth.query(
          `SELECT * FROM auth.lexon_platform_accounts($1,$2,$3,50,0)`,
          [tag, statuses, tf],
        )
      ).rows;
    const all = await list(null, null);
    const byId = new Map(all.map((row) => [row.id, row]));
    expect(byId.get(banned).status).toBe('disabled');
    expect(byId.get(unverified).status).toBe('unverified');
    expect(byId.get(active).status).toBe('active');
    expect(byId.get(active2).is_platform_administrator).toBe(true);
    expect(byId.get(plain).is_platform_administrator).toBe(false);
    expect(byId.get(plain).last_active_at).toBeNull();
    const both = await list(['active', 'disabled'], [true]);
    expect(both.map((row) => row.id).sort()).toEqual(
      [active, active2, disabled2fa].sort(),
    );
    expect(
      (await list(['active'], [true])).map((row) => row.id).sort(),
    ).toEqual([active, active2].sort());
    // last_active_at is the max session.updated_at
    await p.migrator.query(
      `INSERT INTO auth.session(expires_at,token,updated_at,user_id) VALUES (now()+interval '1 day',$1,'2026-01-01T00:00:00',$3),(now()+interval '1 day',$2,'2026-03-01T00:00:00',$3)`,
      [randomUUID(), randomUUID(), active],
    );
    const row = (await list(['active'], [true])).find((r) => r.id === active);
    // timestamp without time zone is parsed in the client's local zone
    expect(new Date(row.last_active_at).getTime()).toBe(
      new Date('2026-03-01T00:00:00').getTime(),
    );
  } finally {
    await p.close();
  }
});

test('pages are disjoint and complete with equal created_at; beyond-last is empty', async ({
  services,
}) => {
  const p = pools(services);
  const tag = randomUUID().slice(0, 8);
  try {
    for (let i = 0; i < 25; i++)
      await user(p.migrator, {
        name: `P ${tag} ${i}`,
        createdAt: '2026-02-02T10:00:00',
      });
    const ids: string[] = [];
    for (const offset of [0, 10, 20]) {
      const rows = (
        await p.auth.query(
          `SELECT * FROM auth.lexon_platform_accounts($1,NULL,NULL,10,$2)`,
          [tag, offset],
        )
      ).rows;
      for (const row of rows) expect(Number(row.total)).toBe(25);
      ids.push(...rows.map((row) => row.id));
    }
    expect(new Set(ids).size).toBe(25);
    expect(ids).toHaveLength(25);
    const beyond = await p.auth.query(
      `SELECT * FROM auth.lexon_platform_accounts($1,NULL,NULL,10,30)`,
      [tag],
    );
    expect(beyond.rows).toEqual([]);
    const total = await p.auth.query(
      `SELECT auth.lexon_platform_accounts_total($1,NULL,NULL) AS n`,
      [tag],
    );
    expect(Number(total.rows[0].n)).toBe(25);
    expect(typeof total.rows[0].n).toBe('string'); // bigint
  } finally {
    await p.close();
  }
});

test('organizations: personal hidden, owner email rules, members, detail', async ({
  services,
}) => {
  const p = pools(services);
  const tag = randomUUID().slice(0, 8);
  try {
    const first = await user(p.migrator, {
      email: `first-${tag}@example.test`,
    });
    const second = await user(p.migrator, {
      email: `second-${tag}@example.test`,
    });
    const orgId = await team(p.migrator, {
      name: `Org ${tag} active`,
      owners: [
        { id: second, at: '2026-02-02T00:00:00' },
        { id: first, at: '2026-01-01T00:00:00' },
      ],
    });
    // provisioning team with its first-owner invitation
    const provisioning = randomUUID();
    const invitation = randomUUID();
    const client = await p.migrator.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO auth.organization(id,name,slug,created_at,kind,state) VALUES ($1,$2,$3,now(),'team','provisioning')`,
        [provisioning, `Org ${tag} provisioning`, `prov-${provisioning}`],
      );
      await client.query(
        `INSERT INTO auth.invitation(id,organization_id,email,role,status,expires_at,inviter_id,purpose)
         VALUES ($1,$2,$3,'owner','pending',now()+interval '1 day',$4,'first_owner')`,
        [invitation, provisioning, `owner-${tag}@example.test`, first],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const orgs = (
      await p.auth.query(
        `SELECT * FROM auth.lexon_platform_organizations($1,NULL,50,0)`,
        [tag],
      )
    ).rows;
    expect(orgs).toHaveLength(2);
    const active = orgs.find((row) => row.id === orgId);
    expect(active.owner_email).toBe(`first-${tag}@example.test`);
    expect(Number(active.member_count)).toBe(2);
    expect(orgs.find((row) => row.id === provisioning).owner_email).toBe(
      `owner-${tag}@example.test`,
    );
    const personal = await p.auth.query(
      `SELECT * FROM auth.lexon_platform_organizations('Personal',NULL,50,0)`,
    );
    expect(personal.rows).toEqual([]);
    expect(
      (
        await p.auth.query(
          `SELECT * FROM auth.lexon_platform_organizations($1,ARRAY['provisioning'],50,0)`,
          [tag],
        )
      ).rows.map((row) => row.id),
    ).toEqual([provisioning]);
    const detail = (
      await p.auth.query(`SELECT * FROM auth.lexon_platform_organization($1)`, [
        provisioning,
      ])
    ).rows[0];
    expect(detail.invitation_id).toBe(invitation);
    expect(detail.invitation_status).toBe('pending');
    expect(detail.require2fa).toBeNull();
    const activeDetail = (
      await p.auth.query(`SELECT * FROM auth.lexon_platform_organization($1)`, [
        orgId,
      ])
    ).rows[0];
    expect(activeDetail.require2fa).toBe(false);
    expect(activeDetail.invitation_id).toBeNull();
    const members = (
      await p.auth.query(`SELECT * FROM auth.lexon_platform_members($1,10,0)`, [
        orgId,
      ])
    ).rows;
    expect(members.map((row) => row.user_id)).toEqual([first, second]);
    expect(Number(members[0].total)).toBe(2);
    const teams = (
      await p.auth.query(
        `SELECT * FROM auth.lexon_platform_account_teams($1)`,
        [first],
      )
    ).rows;
    expect(teams.map((row) => row.organization_id)).toEqual([orgId]);
    const account = (
      await p.auth.query(`SELECT * FROM auth.lexon_platform_account($1)`, [
        first,
      ])
    ).rows[0];
    expect(Number(account.team_count)).toBe(1);
  } finally {
    await p.close();
  }
});

test('active_session_count excludes expired and hard-expired', async ({
  services,
}) => {
  const p = pools(services);
  try {
    const id = await user(p.migrator);
    const insert = (expires: string, hard: string | null) =>
      p.migrator.query(
        `INSERT INTO auth.session(expires_at,token,updated_at,user_id,channel,hard_expires_at)
         VALUES (now()+${expires}::interval,$1,now(),$2,$3,${hard === null ? 'NULL' : `now()+${hard}::interval`})`,
        [randomUUID(), id, hard === null ? 'cookie' : 'bearer'],
      );
    await insert(`'1 day'`, null); // live
    await insert(`'-1 day'`, null); // expired
    await insert(`'1 day'`, `'2 days'`); // live bearer
    // Future expires_at with a past hard_expires_at: the 0007 trigger clamps
    // expires_at on insert, so it is disabled for this one insert only to
    // isolate the hard_expires_at clause of the count.
    const hardExpired = randomUUID();
    const client = await p.migrator.connect();
    try {
      await client.query(
        'ALTER TABLE auth.session DISABLE TRIGGER lexon_protect_session_security',
      );
      try {
        await client.query(
          `INSERT INTO auth.session(expires_at,token,updated_at,user_id,channel,hard_expires_at)
           VALUES (now()+interval '1 day',$1,now(),$2,'bearer',now()-interval '1 hour')`,
          [hardExpired, id],
        );
      } finally {
        await client.query(
          'ALTER TABLE auth.session ENABLE TRIGGER lexon_protect_session_security',
        );
      }
    } finally {
      client.release();
    }
    const stored = await p.migrator.query(
      `SELECT expires_at > now() AS future, hard_expires_at < now() AS hard_past
       FROM auth.session WHERE token=$1`,
      [hardExpired],
    );
    expect(stored.rows).toEqual([{ future: true, hard_past: true }]);
    const row = (
      await p.auth.query(`SELECT * FROM auth.lexon_platform_account($1)`, [id])
    ).rows[0];
    expect(Number(row.active_session_count)).toBe(2);
  } finally {
    await p.close();
  }
});

test('no function selects ip_address or user_agent', async ({ services }) => {
  const p = pools(services);
  try {
    const rows = (
      await p.migrator.query<{ def: string }>(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
         WHERE p.pronamespace='auth'::regnamespace AND p.proname = ANY($1)`,
        [Object.keys(platformFunctions)],
      )
    ).rows;
    expect(rows).toHaveLength(17);
    for (const row of rows)
      expect(row.def).not.toMatch(/ip_address|user_agent/);
  } finally {
    await p.close();
  }
});

test('invitation lifecycle', async ({ services }) => {
  const p = pools(services);
  const tag = randomUUID().slice(0, 8);
  try {
    const admin = await user(p.migrator, {
      name: `Admin ${tag}`,
      role: 'admin',
    });
    const create = async (email: string, digest: string) =>
      (
        await p.auth.query(
          `SELECT * FROM auth.lexon_create_account_invitation($1,$2,$3,$4)`,
          [email, 'Invited', digest, admin],
        )
      ).rows;
    const email = `Invitee-${tag}@Example.test`;
    const created = await create(email, `d1-${tag}`);
    expect(created).toHaveLength(1);
    expect(created[0].email).toBe(email.toLowerCase());
    expect(created[0].status).toBe('pending');
    expect(created[0].invited_by_name).toBe(`Admin ${tag}`);
    expect(
      Math.round(
        (new Date(created[0].expires_at).getTime() -
          new Date(created[0].sent_at).getTime()) /
          86_400_000,
      ),
    ).toBe(7);
    // existing account and pending invitation refuse identically
    const existing = await user(p.migrator, {
      email: `have-${tag}@example.test`,
    });
    expect(existing).toBeTruthy();
    expect(await create(`have-${tag}@example.test`, `d2-${tag}`)).toEqual([]);
    expect(await create(email.toUpperCase(), `d3-${tag}`)).toEqual([]);
    // listing shows the pending row and the total
    const listed = (
      await p.auth.query(
        `SELECT * FROM auth.lexon_platform_account_invitations($1,ARRAY['pending'],10,0)`,
        [tag],
      )
    ).rows;
    expect(listed.map((row) => row.id)).toEqual([created[0].id]);
    // expired pending is superseded
    await p.migrator.query(
      `UPDATE auth.lexon_account_invitation SET expires_at=now()-interval '1 minute' WHERE id=$1`,
      [created[0].id],
    );
    expect(
      (
        await p.auth.query(
          `SELECT status FROM auth.lexon_platform_account_invitations($1,NULL,10,0)`,
          [tag],
        )
      ).rows[0].status,
    ).toBe('expired');
    const replacement = await create(email, `d4-${tag}`);
    expect(replacement).toHaveLength(1);
    const old = await p.migrator.query(
      `SELECT status FROM auth.lexon_account_invitation WHERE id=$1`,
      [created[0].id],
    );
    expect(old.rows[0].status).toBe('cancelled');
    // resend: old digest stops working, new works, accept is single-use
    const resent = (
      await p.auth.query(
        `SELECT * FROM auth.lexon_resend_account_invitation($1,$2)`,
        [replacement[0].id, `d5-${tag}`],
      )
    ).rows;
    expect(resent).toHaveLength(1);
    const invitee = await user(p.migrator, {
      email: email.toLowerCase(),
      verified: false,
    });
    const accept = async (digest: string) =>
      (
        await p.auth.query(
          `SELECT auth.lexon_accept_account_invitation($1,$2) AS ok`,
          [digest, invitee],
        )
      ).rows[0].ok;
    const facts = await p.auth.query(
      `SELECT * FROM auth.lexon_account_invitation_signup_facts($1)`,
      [`d5-${tag}`],
    );
    expect(facts.rows[0]).toMatchObject({
      id: replacement[0].id,
      email: email.toLowerCase(),
      usable: true,
    });
    expect(await accept(`d4-${tag}`)).toBe(false);
    expect(await accept(`d5-${tag}`)).toBe(true);
    expect(
      (
        await p.migrator.query(
          `SELECT email_verified FROM auth."user" WHERE id=$1`,
          [invitee],
        )
      ).rows[0].email_verified,
    ).toBe(true);
    expect(await accept(`d5-${tag}`)).toBe(false);
    const accepted = await p.migrator.query(
      `SELECT status,accepted_user_id FROM auth.lexon_account_invitation WHERE id=$1`,
      [replacement[0].id],
    );
    expect(accepted.rows[0]).toEqual({
      status: 'accepted',
      accepted_user_id: invitee,
    });
    // resend and cancel of non-pending or unknown give nothing
    expect(
      (
        await p.auth.query(
          `SELECT * FROM auth.lexon_resend_account_invitation($1,$2)`,
          [replacement[0].id, `d6-${tag}`],
        )
      ).rows,
    ).toEqual([]);
    const cancel = async (id: string) =>
      (
        await p.auth.query(
          `SELECT auth.lexon_cancel_account_invitation($1) AS ok`,
          [id],
        )
      ).rows[0].ok;
    expect(await cancel(replacement[0].id)).toBe(false);
    expect(await cancel(randomUUID())).toBe(false);
    const fresh = await create(`fresh-${tag}@example.test`, `d7-${tag}`);
    expect(await cancel(fresh[0].id)).toBe(true);
    expect(await cancel(fresh[0].id)).toBe(false);
  } finally {
    await p.close();
  }
});

test('audit validator accepts the seven new types and rejects an email in metadata', async ({
  services,
}) => {
  const p = pools(services);
  try {
    const actor = await user(p.migrator);
    const subject = await user(p.migrator);
    const org = await team(p.migrator, {
      owners: [{ id: actor, at: '2026-01-01T00:00:00' }],
    });
    const invitationId = randomUUID();
    const base = () => ({
      eventId: randomUUID(),
      version: 1,
      occurredAt: new Date().toISOString(),
      outcome: 'success',
      actorUserId: actor,
    });
    const append = (event: unknown) =>
      p.auth.query('SELECT auth.lexon_append_audit($1::jsonb)', [
        JSON.stringify(event),
      ]);
    const valid = [
      {
        type: 'platform.user_sessions_revoked.v1',
        subjectUserId: subject,
        metadata: {},
      },
      {
        type: 'platform.verification_email_resent.v1',
        subjectUserId: subject,
        metadata: {},
      },
      {
        type: 'platform.organization_members_viewed.v1',
        orgId: org,
        metadata: { page: 2 },
      },
      {
        type: 'platform.account_invitation_created.v1',
        invitationId,
        metadata: {},
      },
      {
        type: 'platform.account_invitation_resent.v1',
        invitationId,
        metadata: {},
      },
      {
        type: 'platform.account_invitation_cancelled.v1',
        invitationId,
        metadata: {},
      },
      {
        type: 'platform.account_invitation_accepted.v1',
        actorUserId: subject,
        subjectUserId: subject,
        metadata: { invitationId },
      },
    ];
    for (const extra of valid) await append({ ...base(), ...extra });
    await expect(
      append({
        ...base(),
        type: 'platform.account_invitation_created.v1',
        invitationId,
        metadata: { email: 'x@example.test' },
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      append({
        ...base(),
        type: 'platform.organization_members_viewed.v1',
        orgId: org,
        metadata: { page: 0 },
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      append({
        ...base(),
        type: 'platform.user_sessions_revoked.v1',
        subjectUserId: subject,
        metadata: { userIds: [subject] },
      }),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await p.close();
  }
});
