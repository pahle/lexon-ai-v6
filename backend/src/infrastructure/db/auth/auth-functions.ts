import type { AuthCommandSession } from './auth-types.js';
import type { AuditWriteRecord } from '../audit-write-record.js';

const sessions = new WeakMap<
  AuthCommandSession,
  (event: AuditWriteRecord) => Promise<void>
>();

// Private bindings: no SQL/adapter/connection capability reaches callers.
export function bindAuthAudit(
  session: AuthCommandSession,
  append: (event: AuditWriteRecord) => Promise<void>,
): void {
  sessions.set(session, append);
}
export function endAuthAudit(session: AuthCommandSession): void {
  sessions.delete(session);
}

export async function appendAuthAuditRecord(
  session: AuthCommandSession,
  event: AuditWriteRecord,
): Promise<void> {
  const append = sessions.get(session);
  if (!append) throw new Error('Auth command session expired');
  await append(event);
}
