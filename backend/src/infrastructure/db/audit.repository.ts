import { requireSession, type TenantSession } from './tenant-session.js';
import type { AuditWriteRecord } from './audit-write-record.js';

export class AuditRepository {
  async append(tx: TenantSession, event: AuditWriteRecord): Promise<void> {
    const { client, ctx } = requireSession(tx);
    if (!event.orgId || event.orgId !== ctx.orgId)
      throw new Error('Audit organization differs from tenant session');
    await client.query(
      `INSERT INTO ops.audit_events
      (event_id,version,type,occurred_at,outcome,actor_user_id,subject_user_id,session_id,org_id,invitation_id,member_id,request_id,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        event.eventId,
        event.version,
        event.type,
        event.occurredAt,
        event.outcome,
        event.actorUserId ?? null,
        event.subjectUserId ?? null,
        event.sessionId ?? null,
        event.orgId,
        event.invitationId ?? null,
        event.memberId ?? null,
        event.requestId ?? null,
        JSON.stringify(event.metadata),
      ],
    );
  }
}
