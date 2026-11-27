import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import {
  applyClaimLaneLockTimeout,
  requireSession,
  type TenantSession,
} from './tenant-session.js';

const uuid = z.uuid();

/** Locks an owned live chat before any claim-dependent run or step row lock. */
export class AiChatResourceRepository {
  async lockLiveForRun(tx: TenantSession, runId: string): Promise<boolean> {
    if (!uuid.safeParse(runId).success) return false;
    const { client, ctx } = requireSession(tx);
    await applyClaimLaneLockTimeout(client);
    const runResult = await client.query<{
      owner_user_id: string;
      resource_ids: unknown;
      chat_id: string | null;
    }>(
      `SELECT r.initiating_user_id AS owner_user_id,
              COALESCE(r.resolved_config->'resourceIds','[]'::jsonb) AS resource_ids,
              cr.chat_id
       FROM app.ai_runs r
       LEFT JOIN app.chat_runs cr ON cr.org_id=r.org_id AND cr.run_id=r.id
       WHERE r.org_id=$1 AND r.id=$2`,
      [ctx.orgId, runId],
    );
    const run = runResult.rows[0];
    if (!run || run.owner_user_id !== ctx.userId) return false;
    const resourceIds = Array.isArray(run.resource_ids) ? run.resource_ids : [];
    if (resourceIds.length === 0) return run.chat_id === null;
    if (
      !ctx.userId ||
      resourceIds.length !== 1 ||
      typeof resourceIds[0] !== 'string' ||
      !uuid.safeParse(resourceIds[0]).success ||
      resourceIds[0].toLowerCase() !== run.chat_id?.toLowerCase()
    )
      return false;
    // Owner+access scope (§5 row 6 analogue): a denied/removed member cannot
    // take the write fence on their own project chat.
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const chat = await client.query(
      `SELECT 1 FROM app.chats c
       WHERE ${scope.where('c', '$1', '$3')} AND c.id=$2
       FOR UPDATE`,
      [scope.orgId, run.chat_id, scope.userId],
    );
    return chat.rowCount === 1;
  }
}
