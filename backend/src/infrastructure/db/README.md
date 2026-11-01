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

`NULLIF` covers both fresh connections (NULL) and reused connections (empty string after context reset). No context returns zero rows rather than a cast error. The application role is not an owner, cannot bypass RLS, and receives only DML grants, not TRUNCATE/schema alteration. The migrator owns schemas/tables and is never used at runtime. Better Auth uses a separate lexon_auth role/pool; it never shares the application role. Migrations require the named migrator identity.

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

## F1 auth and audit boundary

Better Auth 1.7.14 and its Drizzle adapter own the authoritative auth tables.
Generate their schema with the pinned CLI (from repository root):

```sh
pnpm --filter @lexon/backend exec auth generate --config src/infrastructure/db/auth/auth-generation.config.ts --output src/infrastructure/db/auth/auth-schema.ts --yes
```

Review generated changes before authoring an append-only migrator-owned SQL
migration; never run schema push against runtime databases. Current migrations
live in `backend/drizzle/`. The configured adapter transaction bridge binds native
server APIs and narrow primitives to one callback-lifetime transaction; errors
and unsuccessful native Responses roll back. Post-commit mail callbacks run only
after the real outer commit. Personal creation is enforced by a migrator-owned
trigger in the user insert transaction. Parent-row fencing plus constraints
serialize concurrent last-owner and invitation transitions.

Modules call native server APIs through the opaque AuthCommandSession. Private
plugins perform dumb expected-state primitives; policy stays in modules. Auth SDK
imports live here and runtime factories are limited to API/operator composition.
Workers and the single public evaluation entry load neither auth nor SMTP SDKs.

`lexon_auth` has no ops table privileges. Its audit writer is one fixed-search-path
SECURITY DEFINER function validating event types and allowed metadata keys;
only lexon_auth and lexon_app may execute it. lexon_app may INSERT directly;
runtime roles cannot UPDATE/DELETE/TRUNCATE audit rows. Tenant AuditService.append
requires a TenantSession and org-scoped event. Non-org events use the auth
transaction writer. Unknown failed accounts use normalized-email HMAC correlation,
never raw email/IP. Audit read access is test/later-view specific; F17 must filter
through the authorization predicate builder because ops has no tenant RLS.

The independent lexon_setup operator role has only narrow setup function grants,
no table reads/writes, migrator privilege or direct audit INSERT. Each command
attempt is audited, including pending/refused runs. API redemption and activation
cannot begin grants. No member-departure outbox rows or dispatcher reservation
exist; F18 owns that future mechanism.
