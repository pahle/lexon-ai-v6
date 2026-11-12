import {
  CHAT_SEARCH_SQL,
  type ChatSearchCursor,
} from '../chat-search.repository.js';
import { buildAuthorizationPredicate } from '../authorization-predicate.js';
import { requireSession, type TenantSession } from '../tenant-session.js';

export async function explainChatSearch(
  tx: TenantSession,
  queryText: string,
  cursor: ChatSearchCursor | null,
  limit: number,
) {
  const { client, ctx } = requireSession(tx);
  if (!ctx.userId) throw new Error('Search plan needs an owner scope');
  const scope = buildAuthorizationPredicate({
    scope: 'owned-chat',
    orgId: ctx.orgId,
    userId: ctx.userId,
    excludeDeleted: true,
  });
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
    [
      [
        'effective_cache_size',
        'effective_io_concurrency',
        'jit',
        'max_parallel_workers_per_gather',
        'random_page_cost',
        'seq_page_cost',
        'shared_buffers',
        'statement_timeout',
        'work_mem',
      ],
    ],
  );
  const plan = await client.query(`EXPLAIN (FORMAT JSON) ${CHAT_SEARCH_SQL}`, [
    scope.orgId,
    scope.userId,
    queryText,
    cursor?.score ?? null,
    cursor?.activityAt ?? null,
    cursor?.chatId ?? null,
    limit,
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
    plan,
  };
}
