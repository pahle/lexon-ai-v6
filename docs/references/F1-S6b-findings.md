# F1 S6(b): private Better Auth integration proof

Date: 2026-10-31. Scope: implementation Task 1, before production API mounting.
This establishes the adapter/transaction foundation. It does not declare the
whole F1 authentication or authorization design complete.

## Versions and research notes

| Official source                                                                                                                                                                                                                | Version checked                     | Date read  | Finding used                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Better Auth release](https://github.com/better-auth/better-auth/releases/tag/v1.7.14), [published core](https://registry.npmjs.org/@better-auth/core/1.7.14), [published auth](https://registry.npmjs.org/better-auth/1.7.14) | 1.7.14                              | 2026-10-31 | Public `@better-auth/core/context` exports `runWithAdapter`, `getCurrentAdapter`, and `runWithTransaction`. The latter joins the current core transaction. Inspected published declarations and implementations, including endpoint dispatch and organization adapter. |
| [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [published adapter](https://registry.npmjs.org/@better-auth/drizzle-adapter/1.7.14)                                                                          | 1.7.14                              | 2026-10-31 | `provider: 'pg'`, `schemaName: 'auth'`, explicit generated schema, and `transaction: true` are supported. The public adapter interface includes create/read/update/delete/count/consume/increment and transaction operations.                                          |
| [Drizzle transactions](https://orm.drizzle.team/docs/transactions) and installed declarations                                                                                                                                  | ORM 0.45.4; Kit 0.31.11             | 2026-10-31 | `NodePgDatabase.transaction` supplies the connection-bound transaction used to construct another public Better Auth adapter. No driver or transaction is exposed to domain modules.                                                                                    |
| [Nest adapter](https://github.com/ThallesP/nestjs-better-auth), installed package README/export declarations                                                                                                                   | 2.8.0; Nest 12.3.2                  | 2026-10-31 | Nest 12 peer support, `bodyParser: false` at boot, bounded module JSON parser, and `disableGlobalAuthGuard: true` are supported. The adapter uses the configured Web handler; no custom `toNodeHandler` fallback was needed.                                           |
| [PostgreSQL deferred constraints](https://www.postgresql.org/docs/17/sql-set-constraints.html)                                                                                                                                 | PostgreSQL 17.11                    | 2026-10-31 | A test-only `DEFERRABLE INITIALLY DEFERRED` constraint trigger can fail actual COMMIT after the native endpoint has produced a successful Response.                                                                                                                    |
| [Vitest global setup](https://vitest.dev/config/globalsetup), [Testcontainers](https://node.testcontainers.org/features/containers/) and installed harness                                                                     | Vitest 5.0.5; Testcontainers 12.2.1 | 2026-10-31 | Preserve the existing once-per-run containers and per-file database/key/bucket isolation; add the auth-role URL to that fixture.                                                                                                                                       |

The dependency install pins `better-auth`, `@better-auth/core`,
`@better-auth/drizzle-adapter`, and development CLI `auth` to 1.7.14, and
`@thallesp/nestjs-better-auth` to 2.8.0. Existing framework/TypeScript/Zod
versions and `pnpm-workspace.yaml` settings remain unchanged. New optional-peer
resolution accounts for existing-package lockfile snapshot suffix changes.

## Schema generation

Run from the repository root:

```sh
pnpm --filter @lexon/backend exec auth generate --config src/infrastructure/db/auth/auth-generation.config.ts --output src/infrastructure/db/auth/auth-schema.ts --yes
pnpm --filter @lexon/backend exec drizzle-kit generate --dialect postgresql --schema src/infrastructure/db/auth/auth-schema.ts --out ../.cache/docs/f1/generated-auth --name auth
```

The second command used a fresh scratch output directory, avoiding the existing
snapshot-less foundation migrations. The resulting SQL became `0003_auth.sql`
with only its initial `CREATE SCHEMA auth` removed: migration 0000 already owns
that schema and its default runtime grants. Formatting was applied to the
schema TypeScript. The migration journal gained one entry. No schema push or
runtime migration credentials were used.

Generated tables are `user`, `session`, `account`, `verification`,
`organization`, `member`, `invitation`, and `two_factor`, all under `auth`.
Native identity primary keys and native declared references are UUIDs. The
additional server-owned scalar fields follow the approved design and use
`input: false`. Later migration tasks own Personal/team/channel database
invariants and setup-grant/narrow-function records.

## Runtime evidence

`backend/test/integration/auth-compatibility.spec.ts` passes ten real-database
proofs:

- Nest 12 ESM boots with Organization, Admin, Two-Factor, and Bearer. Native
  signup reads its request body at `/api/auth/sign-up/email`; a normal Nest JSON
  route parses its body and rejects an oversized body. The `/api` global prefix
  does not duplicate the auth base path.
- The auth role is `lexon_auth`; table ownership is `lexon_migrator`; native
  tables exist only in `auth`. The auth role has no `app`/`ops` usage, and the
  application role cannot read the session table.
- Verified native sign-in supports native `getSession` with cookie and Bearer
  credentials. Typed server calls preserve the native Response/header overloads.
- One transaction calls real `signUpEmail` and `createOrganization`; an
  independent connection sees no uncommitted user, and an injected error leaves
  neither write. A retained command capability rejects use after its callback.
- Native TOTP enrollment writes through the base adapter. Injected rollback
  leaves no two-factor row.
- Two overlapping callbacks synchronize after their writes; one aborts and one
  commits. Only the successful callback's user survives.
- A test-only deferred constraint trigger rejects session COMMIT. The native
  handler has already created a 200 Response containing a session cookie, but
  the outer caller receives a rejection and no Response; no new session survives.
- A native after-hook error is converted to an HTTP 400 Response. The boundary
  rolls back the preceding signup and returns that error response only after
  rollback. Its queued verification mail is discarded.
- A server command using native `asResponse: true` also rejects an error
  Response and rolls back its writes and queued mail.
- Injected mail callbacks run only after the true outer COMMIT, and are discarded
  on rollback.

The existing test-bed A/B isolation tests pass alongside these proofs. The
full repository suite passes 33 files and 136 tests. Backend
lint, the 57 boundary checks, typecheck, and clean build pass. A post-build scan
finds no `testing` helpers or generation configuration in `backend/dist`.

## Transaction findings and constraints for later tasks

The public HTTP handler in Better Auth 1.7.14 calls `runWithAdapter` internally.
That resets Better Auth's adapter context even when the application wraps it in
`runWithTransaction`. A facade relying only on `getCurrentAdapter` consequently
recursed during the first implementation attempt. The corrected facade retains
its own private connection scope, routes every base-adapter operation to that
scope, and joins it in `adapter.transaction`. It still uses the public core
transaction exports; there is no package patch, private package import, or
compensating mutation. Native HTTP signup is a regression for this reset.

This reset also means native after-transaction hooks can execute before the
application's outer transaction commits. Signup calls verification delivery
inside its native transaction. A RED test observed the delivery callback before
outer COMMIT. The integration therefore queues its two injected mail callbacks
privately and drains that queue only after Drizzle's actual transaction promise
succeeds. Rollback discards it. This is not a durable mail queue; retry and
post-commit delivery-failure behavior belong to the mail/domain tasks. Other
future hooks must not assume native hook timing equals the outer commit.

Native HTTP dispatch normalizes API errors into Responses. A RED test observed
a user surviving an HTTP 400 after-hook failure. The boundary now rolls back
responses with status >= 400. Attempted-operation audit/security-counter designs
must account for this: failed-attempt records that must survive belong in a
separate deliberate transaction; successful audit belongs in the mutation
transaction. No audit or counter workaround is implemented in this task.

Only `AuthIntegration` and the opaque typed command capability are intended for
future public composition. The native engine, adapter, Drizzle transaction,
connection scope, and mail commit queue remain private database composition.
The transaction-bound Drizzle handle is retained solely for future reviewed,
named narrow-function implementations; no arbitrary SQL capability is exported.

## Explicitly not yet proven or implemented

- Production mounting, endpoint allowlisting, global identity/tenant guard,
  session-channel enforcement, independent hard-expiry Bearer issuance, MFA
  evidence, security response sanitization, and browser flow policy.
- Personal/team owner invariants, provisioning, invitation lifecycle, role
  policy, admin setup, successful/attempted audit, and concrete narrow functions.
- Full TOTP verification/recovery-code lifecycle and security-counter behavior.
- Durable mail delivery or recovery after a post-commit callback failure.

The native cookie/Bearer test intentionally proves plugin compatibility only:
it demonstrates the native plugin accepting a session token through either
transport. Later F1 policy must prohibit that interchangeability and issue
separate constrained Bearer sessions. Nothing is mounted in the production API
root by this task. These limitations prevent calling the entire S6(b)/F1
acceptance matrix complete at this stage.

## Completed F1 follow-through (2026-11-01)

The earlier section records the Task1 compatibility spike, not the final delivery
status. The private transaction bridge is retained; a replacement adapter was not
needed. Final production composition uses the community Nest adapter2.8.0 with
its global native guard disabled, one deny-default raw auth handler and the Lexon
membership/MFA guard. Non-auth JSON parsing remains owned by Nest composition;
auth raw requests are bounded and validated before native dispatch. Guard session
resolution and all four native plugins (organization, admin, two-factor, bearer)
are exercised by actual PostgreSQL integration tests.

`auth-compatibility`, `auth-http`, `auth-privileges`, `personal-organization`,
`two-factor`, `reauthentication`, `tenant-guard`, `bearer-sessions`, and
`identity-runtime` suites replace the spike's former unproven items with
production-path evidence. Rollback after user insertion leaves neither user nor
Personal; successful effects/audits share transactions. TOTP verification and
recovery replacement sessions preserve explicit evidence and Bearer hard caps.
Cookie and Bearer credentials are no longer interchangeable: issuance creates a
separate session with hard expiry, independent selection and immediate revocation.
No auth-role ops DML, arbitrary SQL port, impersonation or native organization
HTTP escape is exposed. Strict pnpm deployment required explicit exact pins for
already-locked Better Auth required peers; singleton TypeScript/Zod enforcement
remains unchanged.

The remaining limitation is deliberate: post-commit SMTP is not durable. F18
handover, F19 renewal, F20 frontend no-egress and F2 shell remain outside F1.
See [acceptance evidence](F1-acceptance.md) for final gates and coverage limits.
