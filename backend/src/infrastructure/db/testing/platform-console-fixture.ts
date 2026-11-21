import { Pool, type PoolClient } from 'pg';

export type { Pool, PoolClient };

export const UUID = '00000000-0000-4000-8000-000000000001';

// Every function of migration 0040 with a call that is valid by signature.
export const platformFunctions: Record<
  string,
  { args: string; volatility: 's' | 'v' }
> = {
  lexon_platform_accounts: {
    args: `NULL::text,NULL::text[],NULL::boolean[],10,0`,
    volatility: 's',
  },
  lexon_platform_accounts_total: {
    args: `NULL::text,NULL::text[],NULL::boolean[]`,
    volatility: 's',
  },
  lexon_platform_account: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_account_teams: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_organizations: {
    args: `NULL::text,NULL::text[],10,0`,
    volatility: 's',
  },
  lexon_platform_organizations_total: {
    args: `NULL::text,NULL::text[]`,
    volatility: 's',
  },
  lexon_platform_organization: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_members: { args: `'${UUID}'::uuid,10,0`, volatility: 's' },
  lexon_platform_members_total: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_account_invitations: {
    args: `NULL::text,NULL::text[],10,0`,
    volatility: 's',
  },
  lexon_platform_account_invitations_total: {
    args: `NULL::text,NULL::text[]`,
    volatility: 's',
  },
  lexon_platform_lock_enabled_admins: { args: ``, volatility: 'v' },
  lexon_create_account_invitation: {
    args: `'a@example.test','A','digest-x','${UUID}'::uuid`,
    volatility: 'v',
  },
  lexon_resend_account_invitation: {
    args: `'${UUID}'::uuid,'digest-y'`,
    volatility: 'v',
  },
  lexon_cancel_account_invitation: { args: `'${UUID}'::uuid`, volatility: 'v' },
  lexon_account_invitation_signup_facts: {
    args: `'digest-x'`,
    volatility: 's',
  },
  lexon_accept_account_invitation: {
    args: `'digest-x','${UUID}'::uuid`,
    volatility: 'v',
  },
};

/** One pool per role used by the platform console tests. */
export function createPlatformPools(urls: {
  appUrl: string;
  authUrl: string;
  migratorUrl: string;
}) {
  const app = new Pool({ connectionString: urls.appUrl });
  const auth = new Pool({ connectionString: urls.authUrl });
  const migrator = new Pool({ connectionString: urls.migratorUrl });
  return {
    app,
    auth,
    migrator,
    async close() {
      await Promise.all([app.end(), auth.end(), migrator.end()]);
    },
  };
}

export const SCALE = {
  accounts: 10_000,
  organizations: 2_000,
  invitations: 500,
  bigOrganizationMembers: 1_000,
} as const;

/** Seeds the scale-check corpus with generate_series and runs ANALYZE. */
export async function seedPlatformScale(pool: Pool) {
  const existing = await pool.query(
    `SELECT (SELECT id FROM auth.organization WHERE slug = 'team-1') AS big_org`,
  );
  if ((existing.rows[0] as { big_org: string | null }).big_org)
    return { bigOrgId: (existing.rows[0] as { big_org: string }).big_org };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO auth."user"(id,name,email,email_verified,banned,two_factor_enabled,role,created_at)
       SELECT gen_random_uuid(),
         CASE WHEN i % 200 = 0 THEN 'Zelda Quill ' || i ELSE 'Person ' || md5(i::text) END,
         'user' || i || '@example.test',
         i % 7 <> 0, i % 10 = 0, i % 3 = 0,
         CASE WHEN i % 2500 = 1 THEN 'admin' END,
         timestamp '2026-01-01' + (i || ' minutes')::interval
       FROM generate_series(1, ${SCALE.accounts}) i`,
    );
    await client.query(
      `CREATE TEMP TABLE scale_users ON COMMIT DROP AS
         SELECT id, row_number() OVER (ORDER BY created_at) AS n
           FROM auth."user" WHERE role IS DISTINCT FROM 'admin'`,
    );
    await client.query(
      `INSERT INTO auth.organization(id,name,slug,created_at,kind,state)
       SELECT gen_random_uuid(),
         CASE WHEN i % 100 = 0 THEN 'Quillworks ' || i ELSE 'Team ' || md5(i::text) END,
         'team-' || i,
         timestamp '2026-01-01' + (i || ' minutes')::interval, 'team', 'active'
       FROM generate_series(1, ${SCALE.organizations}) i`,
    );
    await client.query(
      `CREATE TEMP TABLE scale_orgs ON COMMIT DROP AS
         SELECT id, row_number() OVER (ORDER BY created_at) AS n
         FROM auth.organization WHERE kind = 'team'`,
    );
    await client.query(
      `INSERT INTO auth.member(organization_id,user_id,role,created_at)
       SELECT o.id, u.id, CASE WHEN k = 0 THEN 'owner' ELSE 'member' END,
         timestamp '2026-02-01' + (k || ' minutes')::interval
       FROM scale_orgs o
       CROSS JOIN generate_series(0, 4) k
       JOIN scale_users u ON u.n = ((o.n * 5 + k) % (SELECT count(*) FROM scale_users)) + 1
       WHERE o.n > 1
       UNION ALL
       SELECT o.id, u.id, CASE WHEN u.n = 1 THEN 'owner' ELSE 'member' END,
         timestamp '2026-02-01' + (u.n || ' minutes')::interval
       FROM scale_orgs o JOIN scale_users u ON u.n <= ${SCALE.bigOrganizationMembers}
       WHERE o.n = 1`,
    );
    await client.query(
      `INSERT INTO auth.lexon_account_invitation(email,name,token_digest,invited_by,status,sent_at,expires_at)
       SELECT 'invitee' || i || '@example.test',
         CASE WHEN i % 50 = 0 THEN 'Zelda Invitee ' || i ELSE 'Invitee ' || i END,
         'digest-' || i, (SELECT id FROM auth."user" WHERE role = 'admin' LIMIT 1), 'pending',
         now() - (i || ' minutes')::interval,
         CASE WHEN i % 5 = 0 THEN now() - interval '1 day' ELSE now() + interval '6 days' END
       FROM generate_series(1, ${SCALE.invitations}) i`,
    );
    const ids = await client.query(
      `SELECT (SELECT id FROM scale_orgs WHERE n = 1) AS big_org`,
    );
    await client.query('COMMIT');
    await client.query(
      'ANALYZE auth."user", auth.organization, auth.member, auth.lexon_account_invitation, auth.session',
    );
    return { bigOrgId: (ids.rows[0] as { big_org: string }).big_org };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
};

export const SCANNED_RELATIONS = [
  'user',
  'organization',
  'member',
  'lexon_account_invitation',
];

export function seqScans(node: PlanNode, out: string[] = []): string[] {
  if (
    node['Node Type'] === 'Seq Scan' &&
    SCANNED_RELATIONS.includes(node['Relation Name'] ?? '')
  )
    out.push(node['Relation Name'] as string);
  for (const child of node.Plans ?? []) seqScans(child, out);
  return out;
}

export function planNodes(node: PlanNode, out: string[] = []): string[] {
  out.push(
    `${node['Node Type']}${node['Relation Name'] ? ` on ${node['Relation Name']}` : ''}${node['Index Name'] ? ` using ${node['Index Name']}` : ''}`,
  );
  for (const child of node.Plans ?? []) planNodes(child, out);
  return out;
}

/**
 * EXPLAIN (ANALYZE) of a SQL function's body. A call to a SQL function shows
 * only a Function Scan, so the body (pg_proc.prosrc) is prepared with its named
 * parameters rewritten to $n and executed with the literal arguments under a
 * custom plan, which is what a call with those arguments plans.
 */
export async function explainFunctionBody(
  pool: Pool,
  fn: string,
  literals: string[],
  options: { seqScan?: boolean; indexScan?: boolean } = {},
) {
  const client = await pool.connect();
  try {
    const meta = await client.query(
      `SELECT p.prosrc, p.proargnames AS names,
              pg_get_function_identity_arguments(p.oid) AS identity,
              string_to_array(oidvectortypes(p.proargtypes), ', ') AS types
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'auth' AND p.proname = $1`,
      [fn],
    );
    const row = meta.rows[0] as {
      prosrc: string;
      names: string[];
      types: string[];
    };
    let body = row.prosrc;
    row.names.slice(0, row.types.length).forEach((name, index) => {
      body = body.replace(
        new RegExp(`(?<![\\w.])${name}(?!\\w)`, 'g'),
        () => `$${index + 1}`,
      );
    });
    await client.query('SET plan_cache_mode = force_custom_plan');
    if (options.seqScan === false)
      await client.query('SET enable_seqscan = off');
    if (options.indexScan === false)
      await client.query('SET enable_indexscan = off');
    await client.query(`PREPARE scale_plan(${row.types.join(',')}) AS ${body}`);
    const result = await client.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) EXECUTE scale_plan(${literals.join(',')})`,
    );
    const json = (
      result.rows[0] as {
        'QUERY PLAN': {
          Plan: PlanNode;
          'Execution Time': number;
        }[];
      }
    )['QUERY PLAN'][0]!;
    return { plan: json.Plan, executionMs: json['Execution Time'] };
  } finally {
    await client.query('DISCARD ALL');
    client.release();
  }
}

/** Plans of the same body with the trigram index dropped, rolled back. */
export async function explainWithoutIndex(
  pool: Pool,
  index: string,
  fn: string,
  literals: string[],
  options: { bitmapScan?: boolean } = {},
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP INDEX auth.${index}`);
    const meta = await client.query(
      `SELECT p.prosrc, p.proargnames AS names, string_to_array(oidvectortypes(p.proargtypes), ', ') AS types
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'auth' AND p.proname = $1`,
      [fn],
    );
    const row = meta.rows[0] as {
      prosrc: string;
      names: string[];
      types: string[];
    };
    let body = row.prosrc;
    row.names.slice(0, row.types.length).forEach((name, i) => {
      body = body.replace(
        new RegExp(`(?<![\\w.])${name}(?!\\w)`, 'g'),
        () => `$${i + 1}`,
      );
    });
    await client.query('SET LOCAL plan_cache_mode = force_custom_plan');
    await client.query('SET LOCAL enable_seqscan = off');
    await client.query('SET LOCAL enable_indexscan = off');
    if (options.bitmapScan === false)
      await client.query('SET LOCAL enable_bitmapscan = off');
    await client.query(`PREPARE scale_plan(${row.types.join(',')}) AS ${body}`);
    const result = await client.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) EXECUTE scale_plan(${literals.join(',')})`,
    );
    return (result.rows[0] as { 'QUERY PLAN': { Plan: PlanNode }[] })[
      'QUERY PLAN'
    ][0]!.Plan;
  } finally {
    await client.query('ROLLBACK');
    await client.query('DISCARD ALL');
    client.release();
  }
}
