import type { Queryable } from './project-fixture.js';
import { buildAuthorizationPredicate } from '../authorization-predicate.js';
import { projectListSql, projectOrgListSql } from '../project.repository.js';
import { chatListSql } from '../chat-search.repository.js';

/**
 * F6 §14 list-gate helpers. Mirrors `chat-search-benchmark.ts`: the spec runs
 * the real repository SQL through `withTenant` (lexon_app claims + RLS) and
 * records the FORMAT JSON plans plus session/RLS evidence. `EXPLAIN` is used
 * without ANALYZE here — per-statement exec costs come from the p95 wall-clock
 * samples and the post-0043 re-measure block (EXPLAIN ANALYZE in savepoints).
 */
export const LIST_GATE_POLICY = {
  expectedSampleCount: 30,
  warningP95Ms: 300,
  blockingP95Ms: 1000,
} as const;

export interface ListGatePolicy {
  readonly expectedSampleCount: number;
  readonly warningP95Ms: number;
  readonly blockingP95Ms: number;
}

const GATE_SETTINGS = [
  'effective_cache_size',
  'effective_io_concurrency',
  'jit',
  'max_parallel_workers_per_gather',
  'random_page_cost',
  'seq_page_cost',
  'shared_buffers',
  'statement_timeout',
  'work_mem',
];

/** The §14 gate surfaces — the real repository SQL, built here so the spec
 * never reaches into db internals (the repository and the benchmark share
 * these builders, so EXPLAIN evidence always covers the production text). */
export function listGateSurfaces(ctx: {
  orgId: string;
  userId: string;
}): Array<{
  name: string;
  text: string;
  params: unknown[];
  expectIndex: string | string[];
}> {
  return [
    {
      name: 'matters-activity',
      text: projectListSql({
        filter: 'all',
        sort: 'activity',
        hasCursor: false,
      }),
      params: [ctx.orgId, ctx.userId, 50],
      expectIndex: 'projects_org_activity',
    },
    {
      name: 'matters-name',
      text: projectListSql({
        filter: 'all',
        sort: 'name',
        hasCursor: false,
      }),
      params: [ctx.orgId, ctx.userId, 50],
      expectIndex: 'projects_org_name',
    },
    {
      name: 'org-projects',
      text: projectOrgListSql({ hasQ: false, hasCursor: false }),
      params: [ctx.orgId, 50],
      expectIndex: 'projects_org_name',
    },
    {
      name: 'org-projects-search',
      text: projectOrgListSql({ hasQ: true, hasCursor: false }),
      params: [ctx.orgId, 50, '%Gate%'],
      expectIndex: [
        'projects_org_id_id',
        'projects_name_trgm',
        'projects_org_name',
      ],
    },
    {
      name: 'chats-own',
      text: chatListSql(
        buildAuthorizationPredicate({
          scope: 'owned-chat',
          orgId: ctx.orgId,
          userId: ctx.userId,
          excludeDeleted: true,
        }),
      ),
      params: [ctx.orgId, ctx.userId, null, null, 50],
      expectIndex: 'chats_owner_activity',
    },
    {
      name: 'chats-shared',
      text: chatListSql(
        buildAuthorizationPredicate({
          scope: 'shared-chat',
          orgId: ctx.orgId,
          userId: ctx.userId,
          excludeDeleted: true,
        }),
      ),
      params: [ctx.orgId, ctx.userId, null, null, 50],
      expectIndex: [
        'chats_org_id_id_key',
        'chats_pkey',
        'chats_owner_activity',
      ],
    },
  ];
}

/** `chat-read` predicate WHERE fragment for the post-0043 re-measure texts —
 * parameterized on the alias/param slots the caller's statement uses. */
export function chatReadWhere(
  alias: string,
  orgParam: string,
  userParam: string,
  ctx: { orgId: string; userId: string },
): string {
  return buildAuthorizationPredicate({
    scope: 'chat-read',
    orgId: ctx.orgId,
    userId: ctx.userId,
    excludeDeleted: true,
  }).where(alias, orgParam, userParam);
}

export async function explainListSurface(
  scope: { client: Queryable; ctx: { orgId: string; userId: string } },
  surface: { readonly text: string; readonly params: readonly unknown[] },
  evidence: {
    readonly relations: readonly string[];
    readonly indexNames: readonly string[];
  },
) {
  const { client, ctx } = scope;
  const session = await client.query<{
    role: string;
    org_id: string | null;
    user_id: string | null;
    enable_seqscan: string;
    statement_timeout: string;
  }>(
    `SELECT current_user AS role,
      current_setting('app.org_id',true) AS org_id,
      current_setting('app.user_id',true) AS user_id,
      current_setting('enable_seqscan') AS enable_seqscan,
      current_setting('statement_timeout') AS statement_timeout`,
  );
  const settings = await client.query(
    `SELECT name,setting,unit FROM pg_settings
     WHERE name=ANY($1::text[]) ORDER BY name`,
    [GATE_SETTINGS],
  );
  const rowSecurity = await client.query<{
    relation: string;
    enabled: boolean;
    forced: boolean;
  }>(
    `SELECT n.nspname||'.'||c.relname AS relation,
        c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.oid=ANY($1::regclass[]) ORDER BY relation`,
    [evidence.relations],
  );
  const indexes = await client.query<{
    index: string;
    predicate: string | null;
  }>(
    `SELECT indexrelid::regclass::text AS index,
        pg_get_expr(index_meta.indpred,index_meta.indrelid) AS predicate
     FROM pg_index index_meta
     WHERE indexrelid::regclass::text=ANY($1::text[]) ORDER BY index`,
    [
      evidence.indexNames.map((name) =>
        name.includes('.') ? name : `app.${name}`,
      ),
    ],
  );
  const plan = await client.query(`EXPLAIN (FORMAT JSON) ${surface.text}`, [
    ...surface.params,
  ]);
  const row = session.rows[0]!;
  return {
    session: {
      role: row.role,
      tenantOrgSet: row.org_id === ctx.orgId,
      tenantUserSet: row.user_id === ctx.userId,
      enableSeqscan: row.enable_seqscan,
      statementTimeout: row.statement_timeout,
    },
    settings: settings.rows,
    rowSecurity: rowSecurity.rows,
    indexes: indexes.rows,
    plan,
  };
}

export function formatListGateMarkdown(
  assessments: Readonly<
    Record<
      string,
      {
        p95Ms: number | null;
        successfulSamples: number;
        warning: boolean;
        blockingStatus: 'pass' | 'fail';
      }
    >
  >,
  policy: ListGatePolicy,
): string {
  const rows = Object.entries(assessments).map(
    ([surface, assessment]) =>
      `| ${surface} | ${assessment.successfulSamples}/${policy.expectedSampleCount} | ${assessment.p95Ms === null ? 'n/a' : `${assessment.p95Ms} ms`} | ${assessment.warning ? 'WARNING' : 'NONE'} | ${assessment.blockingStatus.toUpperCase()} |`,
  );
  return [
    `List gate policy: warning target <${policy.warningP95Ms} ms; blocking limit <${policy.blockingP95Ms} ms; ${policy.expectedSampleCount} successful samples per surface.`,
    '',
    '| Surface | Successful samples | p95 | Warning target | Blocking gate |',
    '| --- | ---: | ---: | --- | --- |',
    ...rows,
  ].join('\n');
}
