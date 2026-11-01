// Database-owned transport shape; event policy/schema belongs to modules/audit.
export interface AuditWriteRecord {
  version: 1;
  eventId: string;
  type: string;
  occurredAt: string;
  outcome: 'success' | 'failure' | 'refused';
  actorUserId?: string;
  subjectUserId?: string;
  sessionId?: string;
  orgId?: string;
  invitationId?: string;
  memberId?: string;
  requestId?: string;
  metadata: Readonly<Record<string, unknown>>;
}
