import { Injectable } from '@nestjs/common';
import {
  AuditRepository,
  appendAuthAuditRecord,
  type TenantSession,
  type AuthCommandSession,
  type AuditWriteRecord,
} from '../../infrastructure/db/index.js';
import {
  validateAuditEvent,
  type AuditEvent,
  type OrgAuditEvent,
} from './audit-event.js';

function writeRecord(event: AuditEvent): AuditWriteRecord {
  const record: AuditWriteRecord = {
    version: event.version,
    eventId: event.eventId,
    type: event.type,
    occurredAt: event.occurredAt,
    outcome: event.outcome,
    metadata: event.metadata,
  };
  for (const key of [
    'actorUserId',
    'subjectUserId',
    'sessionId',
    'orgId',
    'invitationId',
    'memberId',
    'requestId',
  ] as const) {
    if (event[key] !== undefined) record[key] = event[key];
  }
  return record;
}

@Injectable()
export class AuditService {
  private readonly repository = new AuditRepository();
  async append(tx: TenantSession, event: OrgAuditEvent): Promise<void> {
    const validated = validateAuditEvent(event);
    if (!validated.orgId)
      throw new Error('Organization required for tenant audit');
    await this.repository.append(tx, writeRecord(validated));
  }
}
export async function appendAuthAudit(
  tx: AuthCommandSession,
  event: AuditEvent,
): Promise<void> {
  await appendAuthAuditRecord(tx, writeRecord(validateAuditEvent(event)));
}
