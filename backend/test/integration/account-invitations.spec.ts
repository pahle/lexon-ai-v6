import { createHash, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { AccountInvitationSchema } from '@lexon/contracts';
import { unlimitedLimiter } from '../setup/unlimited-limiter.js';
import {
  createAuthLimiter,
  type AuthLimiter,
} from '../../src/infrastructure/queue/index.js';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { AccountInvitationsService } from '../../src/modules/platform-console/account-invitations.service.js';
import { securityHarness } from '../setup/security-harness.js';

const password = 'Account-invite-42!';
const CONFLICT =
  'This address already has a Lexon account or a pending invitation.';
type Services = {
  authUrl: string;
  migratorUrl: string;
  appUrl?: string;
  valkey: { limiterUrl: string };
  queuePrefix: string;
};

async function world(
  services: Services,
  limiter: Pick<AuthLimiter, 'consume'> = unlimitedLimiter,
) {
  const sent: { to: string; subject: string; text: string; html: string }[] =
    [];
  const proof = await createAuthFixture(services, {
    mailTransport: {
      sendMail: async (o) => {
        sent.push({
          to: String(o.to),
          subject: String(o.subject),
          text: String(o.text),
          html: String(o.html),
        });
      },
    },
  });
  const harness = securityHarness(proof);
  const service = new AccountInvitationsService(
    new OrganizationAuthPort(proof.integration),
    { reauthSeconds: 300 },
    limiter,
  );
  const migrator = {
    query: async (text: string, params: unknown[] = []) => ({
      rows: await proof.inspect.migratorQuery(text, params),
    }),
  };
  const admin = async (label = 'Invite admin') => {
    const email = `${randomUUID()}@example.test`;
    const u = await proof.signIn({ body: { name: label, email, password } });
    await proof.inspect.makeAdmin(u.userId);
    const full = await harness.enroll(email, password);
    return { id: u.userId, headers: full.headers };
  };
  const as = <T>(
    a: { headers: Headers },
    work: Parameters<typeof harness.identity<T>>[1],
  ) => harness.identity(a.headers, work);
  const outcome = async (p: Promise<unknown>) =>
    p.then(
      (body) => ({ status: 201, body }),
      (e: { status: number; code: string; issues?: unknown }) => ({
        status: e.status,
        body: { code: e.code, issues: e.issues },
      }),
    );
  return {
    proof,
    service,
    migrator,
    admin,
    as,
    outcome,
    sent,
    close: async () => {
      await proof.close();
    },
  };
}
const tokenOf = (text: string) =>
  new URL(/Continue: (\S+)/.exec(text)![1]!).searchParams.get(
    'accountInvitation',
  )!;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

test('duplicate refusal parity; 201 body parses; email has no organization content', async ({
  services,
}) => {
  const w = await world(services);
  try {
    const a = await w.admin();
    const existing = `${randomUUID()}@example.test`;
    await w.proof.signIn({
      body: { name: 'Existing', email: existing, password },
    });
    const pending = `${randomUUID()}@example.test`;
    const created = await w.as(a, (i) =>
      w.service.create(i, { email: pending.toUpperCase(), name: 'Pat' }),
    );
    expect(AccountInvitationSchema.strict().parse(created)).toMatchObject({
      email: pending,
      status: 'pending',
      invitedBy: 'Invite admin',
    });
    const mail = w.sent.find((m) => m.to === pending)!;
    expect(mail.text).toContain('/sign-up?accountInvitation=');
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toMatch(
      /organi[sz]ation/i,
    );
    const first = await w.as(a, (i) =>
      w.outcome(w.service.create(i, { email: existing })),
    );
    const second = await w.as(a, (i) =>
      w.outcome(w.service.create(i, { email: pending })),
    );
    expect(first).toEqual(second);
    expect(first).toEqual({
      status: 409,
      body: {
        code: 'PLATFORM_INVITATION_CONFLICT',
        issues: [{ path: 'email', message: CONFLICT }],
      },
    });
  } finally {
    await w.close();
  }
});

test('concurrent invites of one address: one 201, one 409; expired invitation is superseded', async ({
  services,
}) => {
  const w = await world(services);
  try {
    const a = await w.admin();
    const email = `${randomUUID()}@example.test`;
    const results = await Promise.all(
      [0, 1].map(() =>
        w.as(a, (i) => w.outcome(w.service.create(i, { email }))),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    await w.migrator.query(
      "UPDATE auth.lexon_account_invitation SET expires_at = now() - interval '1 minute' WHERE email = $1",
      [email],
    );
    const again = await w.as(a, (i) => w.service.create(i, { email }));
    const rows = await w.migrator.query(
      'SELECT id, status FROM auth.lexon_account_invitation WHERE email = $1 ORDER BY created_at',
      [email],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(['cancelled', 'pending']);
    expect(rows.rows[1]!.id).toBe(again.id);
  } finally {
    await w.close();
  }
});

test('resend rotates the token; resend/cancel of accepted, cancelled, unknown are 404', async ({
  services,
}) => {
  const w = await world(services);
  try {
    const a = await w.admin();
    const email = `${randomUUID()}@example.test`;
    const inv = await w.as(a, (i) => w.service.create(i, { email }));
    const oldToken = tokenOf(w.sent.at(-1)!.text);
    await w.as(a, (i) => w.service.resend(i, inv.id));
    const newToken = tokenOf(w.sent.at(-1)!.text);
    expect(newToken).not.toBe(oldToken);
    const facts = async (token: string) =>
      (
        await w.migrator.query(
          'SELECT * FROM auth.lexon_account_invitation_signup_facts($1)',
          [sha(token)],
        )
      ).rows;
    expect(await facts(oldToken)).toEqual([]);
    expect(await facts(newToken)).toMatchObject([{ usable: true }]);
    await w.as(a, (i) => w.service.cancel(i, inv.id));
    const notFound = { status: 404, body: { code: 'NOT_FOUND' } };
    for (const run of [
      (i: Parameters<typeof w.service.resend>[0], id: string) =>
        w.service.resend(i, id),
      (i: Parameters<typeof w.service.cancel>[0], id: string) =>
        w.service.cancel(i, id),
    ])
      for (const id of [inv.id, randomUUID()])
        expect(await w.as(a, (i) => w.outcome(run(i, id)))).toMatchObject(
          notFound,
        );
    const accepted = `${randomUUID()}@example.test`;
    const acc = await w.as(a, (i) => w.service.create(i, { email: accepted }));
    await w.migrator.query(
      "UPDATE auth.lexon_account_invitation SET status='accepted' WHERE id=$1",
      [acc.id],
    );
    expect(
      await w.as(a, (i) => w.outcome(w.service.resend(i, acc.id))),
    ).toMatchObject(notFound);
    expect(
      await w.as(a, (i) => w.outcome(w.service.cancel(i, acc.id))),
    ).toMatchObject(notFound);
  } finally {
    await w.close();
  }
});

test('limits: 21st invite and 4th resend are 429', async ({ services }) => {
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:rl:auth:`,
  });
  const w = await world(services, limiter);
  try {
    const a = await w.admin();
    let first = '';
    for (let n = 1; n <= 20; n++) {
      const inv = await w.as(a, (i) =>
        w.service.create(i, { email: `${randomUUID()}@example.test` }),
      );
      first ||= inv.id;
    }
    expect(
      await w.as(a, (i) =>
        w.outcome(
          w.service.create(i, { email: `${randomUUID()}@example.test` }),
        ),
      ),
    ).toMatchObject({ status: 429, body: { code: 'AUTH_RATE_LIMITED' } });
    for (let n = 1; n <= 3; n++)
      await w.as(a, (i) => w.service.resend(i, first));
    expect(
      await w.as(a, (i) => w.outcome(w.service.resend(i, first))),
    ).toMatchObject({
      status: 429,
    });
  } finally {
    await limiter.close();
    await w.close();
  }
});

test('audit rows carry no email', async ({ services }) => {
  const w = await world(services);
  try {
    const a = await w.admin();
    const email = `${randomUUID()}@example.test`;
    const inv = await w.as(a, (i) =>
      w.service.create(i, { email, name: 'Audited' }),
    );
    await w.as(a, (i) => w.service.resend(i, inv.id));
    await w.as(a, (i) => w.service.cancel(i, inv.id));
    const rows = await w.migrator.query(
      "SELECT to_jsonb(a) AS row FROM ops.audit_events a WHERE type LIKE 'platform.account_invitation_%' AND invitation_id = $1",
      [inv.id],
    );
    expect(rows.rows).toHaveLength(3);
    for (const { row } of rows.rows) {
      expect((row as { metadata: unknown }).metadata).toEqual({});
      expect(JSON.stringify(row)).not.toContain(email);
      expect(JSON.stringify(row)).not.toContain('Audited');
    }
  } finally {
    await w.close();
  }
});
