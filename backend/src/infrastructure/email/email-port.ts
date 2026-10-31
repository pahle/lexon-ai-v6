type EmailFields = { to: string; actionUrl: string; displayName?: string };
export type SecurityNotice =
  | 'password_changed'
  | 'email_changed'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'sessions_revoked';
export type TransactionalEmail = EmailFields &
  (
    | { kind: 'verification' | 'reset' | 'email-change' | 'admin-setup' }
    | { kind: 'invitation'; organizationName: string }
    | { kind: 'security'; reason: SecurityNotice }
  );
export interface EmailPort {
  send(message: TransactionalEmail): Promise<{ messageId: string }>;
  drain(timeoutMs: number): Promise<void>;
}
export const EMAIL_PORT = Symbol('EmailPort');
