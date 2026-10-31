# Database boundary

Runtime modules import only `infrastructure/db/index.ts`. It exposes `TenantDatabase`, opaque callback-lifetime `TenantSession`, the authorization predicate, and module composition. Neither pools nor clients nor Drizzle connections are public. Private implementation files and `testing/` helpers are not runtime APIs.

All tenant access uses `withTenant({orgId,userId}, async tx => ...)`. The wrapper validates UUIDs, acquires one role-specific connection, begins a transaction, sets both context variables transaction-locally, runs the callback, commits/rolls back, expires the session, and releases the connection. The missing user context becomes an empty string deliberately. Never capture a session for work after the callback or execute background work outside its awaited promise. Repositories live inside this boundary and translate the opaque session into parameterized queries/Drizzle operations. Every read includes the central authorization predicate in addition to RLS.

The policy for every tenanted table is:

```sql
ALTER TABLE app.example ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.example FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.example FOR ALL TO lexon_app
USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
```

`NULLIF` covers both fresh connections (NULL) and reused connections (empty string after context reset). No context returns zero rows rather than a cast error. The application role is not an owner, cannot bypass RLS, and receives only DML grants, not TRUNCATE/schema alteration. The migrator owns schemas/tables and is never used at runtime. Better Auth gets a separate role/pool in F1; it never shares the application role. Migrations require the named migrator identity.

The `testing/` helpers alone install fixture tables, inspect privileged state, and probe the same pool outside the tenant wrapper to prove fail-closed behavior. They are not exported by the runtime module and must not enter runtime composition.

Jobs use at-least-once delivery with effectively-once PostgreSQL effects.
`JobExecutor` validates immutable, ID-only metadata, then inserts the outbox-ID
receipt with `ON CONFLICT DO NOTHING RETURNING` before invoking the handler in
the same tenant transaction. A concurrent delivery waits for that transaction:
commit skips the handler; rollback allows the waiting delivery to execute.
Handlers must perform database effects through their supplied `TenantSession`.
This guarantee does not cover external API effects.

`JOB_RECEIPT_RETENTION_SECONDS` defaults to 2592000 (30 days) and must be a
positive integer. It is retention metadata only: F0 never deletes receipts.
A later cleanup implementation must retain receipts beyond every configured
maximum redelivery window, including stalled jobs, retries and operational
replay. Changing this value alone must never remove a receipt.

The dispatcher owns a dedicated `lexon_app` session for the database-scoped
advisory key `(1279613007, 0)` and `LISTEN lexon_outbox`. It commits LISTEN
before the first scan and polls even if a notification is missed. A failed
connection immediately drops cached leadership; a new session must acquire
the lock before work resumes. Standby never claims work.

Claims use a single short autocommit CTE with `FOR UPDATE SKIP LOCKED`. Each
row gets a fresh UUID token, an expiry and an incremented attempt count before
enqueue starts. No transaction stays open during queue I/O. Completion and
rescheduling require the current, unexpired token. Lost leadership, shutdown,
uncertain enqueue outcomes and crashes leave a recoverable lease. Invalid
metadata stays unsent with capped backoff and a fixed `invalid_job` code;
queue failures use only `enqueue_failed`. No payload or exception is stored.
