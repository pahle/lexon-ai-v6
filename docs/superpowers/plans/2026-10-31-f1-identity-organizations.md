# F1 Identity and Organizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lexon verified accounts, personal and team organizations, secure session selection, and one enforceable identity policy for later slices.

**Architecture:** Better Auth owns all identity, membership, invitation, and session records. Lexon organization services call its server API through a transaction-bound integration; PostgreSQL enforces Personal and owner invariants. Only the API runtime loads authentication, with an explicit HTTP allowlist and one tenant guard for cookie and Bearer sessions.

**Tech Stack:** Existing Node24/TS6/Nest12/Next16/React19/Zod4/Drizzle/PostgreSQL17/Valkey9 workspace; Better Auth1.7.14, Nest adapter2.8.0, Nodemailer10.3.1, rate-limiter-flexible11.2.3, shadcn4.23.0/base-nova.

**Spec:** [Approved F1 design](../specs/2026-10-31-f1-identity-organizations-design.md), approved amendment commit `8626eef`; also read the [F1 brief](../../briefs/F1-identity-organizations.md) and root `AGENTS.md`.

## Global Constraints

- Work on `f1-identity-organizations`, never commit to `main`; no excluded branch or legal-AI product source access.
- Better Auth's tables are the single source of truth; no parallel membership model. No application SQL against auth tables except calls to reviewed migrator-owned narrow functions; SQL assertions belong in DB testing helpers.
- Preserve `infrastructure-domain`: infrastructure never imports modules; plugins only lock/read/write with explicit expected-state preconditions and return facts. Domain modules own policy decisions.
- `AuditService.append(TenantSession, ...)` is org-scoped only; non-org events use the auth-transaction writer function.
- Database driver/Drizzle imports stay inside `backend/src/infrastructure/db`; runtime cross-module imports use public `index.ts`. No raw connection/adapter/context export.
- Auth tables use `lexon_auth`; all `app` access uses F0 `withTenant`. No runtime migrator credentials, RLS bypass, or frontend secrets.
- Minimum password length 12. English copy. Generic signup/reset responses. Never log passwords, tokens, codes, emails/IPs as audit free text, or full security links.
- Default cookie expiry 604800 seconds, refresh interval 86400 seconds, reauthentication window 300 seconds, setup link 86400 seconds, Bearer hard expiry 900 seconds, invitation expiry 1209600 seconds. All durations are boot-validated configuration values.
- Cookie-only Bearer issuance after full authentication; no automatic Bearer extension/renewal, trusted-device bypass, or frontend Bearer use. Preserve the current organization until target 2FA requirements are met.
- Departure writes only the ID-only audit event in the same transaction. No departure outbox entries, dispatcher changes, dispatch metadata, or auth-role outbox function.
- Runtime audit writers have INSERT only, never UPDATE/DELETE/TRUNCATE; no runtime SELECT by default. Auth-role writes use one narrow, validated function.
- Exact pins; existing TypeScript6.0.3/Zod4.6.7 singleton overrides and all pnpm settings remain in `pnpm-workspace.yaml`. Do not upgrade unrelated dependencies.
- TDD: failing assertions before production changes or CLI generation. Each task ends with focused GREEN checks and a commit. Commit commands below name the message; stage only that task's listed files and necessary generated lock/journal changes.
- Integration tests start once-per-run Testcontainers with per-file DB/prefix/bucket isolation; no pre-started stack, default reuse, or CI reuse. Compose remains a separate `pnpm test:e2e` layer.
- Signin/signup start from the product owner's `login-02`/`signup-02` choice via the shadcn CLI, style `base-nova`. Remove social/decorative content. Other auth pages use card/field, 2FA also input-otp. RHF/shared Zod, LEX-DS-001 tokens, axe. F2 owns shell/navigation/full design system.

## Approved execution clarifications

- Preserve `infrastructure-domain`: `backend/src/infrastructure/**` cannot import
  `backend/src/modules/**`, including indirect policy/schema imports through barrels.
  Better Auth server plugins are dumb transactional primitives: lock/read/write,
  validate explicit expected-state preconditions, and return facts. They do not
  compute role floors, acceptance classification, authorization matrices, setup
  eligibility, organization selection eligibility or session-issuance policy.
- Domain services in organizations/identity-access read the locked facts, compute
  those decisions, and pass explicit resulting roles/actions/selection/expiry
  values to the primitive inside the same auth transaction. State-version/identity
  preconditions reject races; a conflict re-runs the domain decision, never a
  weaker infrastructure fallback. Do not inject a policy callback into a plugin
  as a workaround for the import rule. Database invariants remain in migrations.
- `AuditService.append(TenantSession, ...)` accepts only org-scoped events whose
  orgId matches that tenant transaction. Sign-in attempts, platform actions and
  admin setup without an organization use the auth-transaction writer function.
  Org membership mutations also use that function when their state is in the
  auth transaction, preserving atomicity across membership and audit. Never use
  a fabricated Personal tenant to record an event without an organization.
- Infrastructure audit repositories consume a low-level write-record type owned
  by the database boundary, never modules/audit types. Domain audit validation
  maps to that record; the narrow SQL function independently validates its input.
- Execution is inline/native, as requested on 2026-11-01, preserving existing
  Task 1 work. After each task passes verification and self-review, commit
  completion bookkeeping and push `f1-identity-organizations` to origin. Never
  push to main. When all tasks and final review pass, open a PR from this branch
  to main; do not merge it.

## Review Focus

1. Email normalization and later email changes must not let a different account consume or replay an invitation; bind acceptance to user ID (Tasks 8, 12).
2. Encoded paths, duplicate credentials, forged proxy headers, and oversized input must not bypass endpoint policy, rate limits, or safe logging (Tasks 6, 7, 14, 23).
3. Concurrent actor demotion, owner departure, acceptance, and switching must use current permissions and preserve database invariants (Tasks 10–13, 15).
4. Repeated/concurrent admin setup and post-commit email failure must not create duplicate grants, activate rights early, or undo ordinary user access (Tasks 5, 16).
5. Stale cookies, dependency 503s, and late responses from an old organization must not cause redirect loops or render old tenant data (Tasks 11, 18, 21).

## Structure and integration decisions

One plan is intentional: sessions, organization policy, and audit share security and transaction boundaries and cannot ship as independent subsystems.

| Area                     | Files and responsibility                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private auth persistence | `backend/src/infrastructure/db/auth/`: generated schema, factory, transaction bridge, custom server plugin and narrow-function invocation; no exported driver |
| Identity                 | `backend/src/modules/identity-access/`: account/session policies, HTTP transport, guard, security services, typed organization-auth facade                    |
| Organizations            | `backend/src/modules/organizations/`: team/invitation/provisioning services and thin controllers                                                              |
| Audit                    | `backend/src/modules/audit/`: strict versioned event schema, HMAC subject correlation, append capability                                                      |
| Mail                     | `backend/src/infrastructure/email/`: SMTP transport, templates, bounded delivery tracking; in-process transport injection for tests                           |
| Shared                   | `shared/src/auth.ts`, `organizations.ts`, `security.ts`: browser-safe contracts only                                                                          |
| Frontend                 | `frontend/src/app/(auth)/`, `(workspace)/`; small owned form components and typed clients                                                                     |
| Proofs                   | Existing Vitest global setup and file fixtures, private DB test helpers, Compose test-only mail IPC and Playwright identity projects                          |

Use migration numbers `0003_auth.sql`, `0004_personal.sql`, `0005_audit.sql`,
`0006_session_security.sql`, `0007_org_invariants.sql`, `0008_admin_setup.sql`.
Generate auth schema through `auth@1.7.14`, not the deprecated
`@better-auth/cli@1.4.21`. Drizzle generation uses existing 0.31.11; SQL migrations
run as `lexon_migrator`. Do not import the v1.0 Drizzle Relations v2 adapter.

Schema-generation commands (run only during the implementing task after RED):

```bash
pnpm --filter @lexon/backend exec auth generate --config src/infrastructure/db/auth/auth-generation.config.ts --adapter drizzle --dialect postgresql --output src/infrastructure/db/auth/auth-schema.ts --yes
pnpm --filter @lexon/backend exec drizzle-kit generate --schema src/infrastructure/db/auth/auth-schema.ts --dialect postgresql --out ../.cache/f1-auth-ddl --name auth --breakpoints
```

The generation-only config exports the same plugin/additional-field options,
without a listener or production credentials; exclude it from production output.
Review the isolated auth-only DDL, copy only the required new statements into
the named versioned migration, and append the journal entry. F0 has SQL/journal
migrations without a full schema snapshot: never regenerate the ops tables or
rewrite its existing journal. Repeat isolated generation for later schema changes.

Auth integration interface, defined in Task 1 and extended only at named tasks:

```ts
interface AuthIntegration {
  handle(request: Request): Promise<Response>; // private framework composition
  transaction<T>(work: (tx: AuthCommandSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
// Opaque, callback-lifetime capability. Native calls retain inferred BA types.
// It exposes selected auth.api operations, never $context/adapter/connection.
interface AuthCommandSession {
  call<K extends keyof LexonServerApi>(
    operation: K,
    input: Parameters<LexonServerApi[K]>[0],
  ): ReturnType<LexonServerApi[K]>;
}
```

`LexonServerApi` is a selected/inferred API type from the private configured
Better Auth factory plus the explicitly named custom plugin endpoints below.
It is not a generic database CRUD API. Domain services obtain only their selected
capability via `identity-access/index.ts`. AuthCommandSession expires on callback
exit. The private transaction bridge binds narrow SQL-function calls to the
same Drizzle transaction as BA's public `runWithTransaction`; an independent
pool query never substitutes for transaction ownership.

The adapter facade must route both current-adapter-aware methods and direct
base-adapter calls through the active transaction. The pinned 2FA plugin has
direct `ctx.context.adapter` calls; wrapping only organization operations is
insufficient. Construct this facade around public adapter interfaces, not by
patching package internals. Task 1 proves native 2FA writes roll back as well.

`VerifiedIdentity` is a request-lifetime branded capability backed by a private
credential binding; callers cannot construct or spread a plain object to gain
authority. Its public fields contain no token/header. The organization port
resolves the binding and injects trusted native headers into calls, ignoring
client-supplied actor/credential overrides. Pure policy unit tests use ordinary
role/evidence input data, not forged VerifiedIdentity instances.

Custom plugin methods have no public HTTP path (`scope: 'server'`/unpathed
endpoint, as supported by the pinned package). The native `verifyPassword`
method is also server-only in1.7.14. It stays an internal reauthentication
dependency; do not synthesize `/api/auth/verify-password` or expose it simply
because an earlier design allowlist listed its name. The web uses the explicit
Lexon reauthentication route.

Shared test fixture from Task 1: `createAuthFixture(services, options?)` returns
`{ integration, nativeApi, mail, inspect, close }`. `nativeApi`/privileged
`inspect` are test-only; mail captures flow messages in memory. `inspect` lives
in DB `testing/`, not runtime exports. Tests create users through native signup
and consume captured verification links; no public bypass endpoint. Task 17 adds
the real application HTTP fixture and Compose mail control channel.

The fixture's inspection capability has explicit test-only methods
`countUsers(email):Promise<number>`, `personalFor(userId):Promise<{orgId,userId,role,memberCount}|null>`,
`ownerCount(orgId):Promise<number>`, `member(userId,orgId):Promise<{id,role}|null>`,
`auditCount(type):Promise<number>`, `outboxCount():Promise<number>` and
`setupCount(email):Promise<number>`; add them in the task that first needs them.
Database-level negative tests additionally execute SQL only through this private
testing boundary. No inspection API reaches production controllers or IPC.

Commands below run at the repository root. Test commands include the root config
so existing build/global setup and file isolation remain active.

## Tasks

### Task 1: Prove the pinned Better Auth/Nest integration and transaction boundary

**Research:** design R01–R05, R10–R12, R19; re-read exact published transaction declarations, organization adapter, Nest adapter body-parser options, and the referenced spec sections before writing this task.

**Files:** Create `backend/src/infrastructure/db/auth/auth-schema.ts`, `auth-factory.ts`, `auth-generation.config.ts`, `auth-integration.ts`, `auth-transaction.ts`, `auth-types.ts`; `backend/drizzle/0003_auth.sql`; `backend/src/infrastructure/db/testing/auth-fixture.ts`, `auth-inspect.ts`; `backend/test/integration/auth-compatibility.spec.ts`. Modify `backend/drizzle/meta/_journal.json`, `backend/tsconfig.build.json`, `backend/package.json`, `pnpm-lock.yaml`, `backend/test/setup/provided-context.ts`, `file-services.ts`; create `docs/references/F1-S6b-findings.md`.

**Interfaces:** Consumes existing `FileServices` and role/migration harness. Produces `AuthIntegration`, opaque `AuthCommandSession`, inferred `LexonServerApi`, and the test fixture above; extends `FileServices` with `authUrl: string`. `createAuthIntegration(options:AuthEngineOptions):Promise<AuthIntegration>` is the private factory; AuthEngineOptions specifies the role URL, origin, secret, plugin configuration and injected mail callbacks used by the proof. The production API root is not mounted yet.

- [x] **Step 1 — RED tests:** Add assertions for Nest12 ESM boot with all four plugins, raw auth body plus a normal Nest JSON route, cookie/Bearer native `getSession`, and tables solely in `auth` using the auth role. The transaction proof also enables native TOTP and injects rollback to ensure its direct base-adapter writes do not escape. The transaction test calls two real `auth.api.*` operations inside `integration.transaction`, injects an error, and asserts neither write survived. Two simultaneous callbacks must not share connection/state. Capture the Response and inject a commit failure: no successful auth cookie or token reaches the caller. Add an expired-capability assertion:
  ```ts
  await expect(
    integration.transaction(async (tx) => {
      await tx.call('signUpEmail', signupInput);
      throw new Error('rollback-probe');
    }),
  ).rejects.toThrow();
  expect(await inspect.countUsers(signupInput.body.email)).toBe(0);
  ```
- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/auth-compatibility.spec.ts`; expect missing integration/schema assertions, not an infrastructure error.
- [x] **Step 3 — Minimal implementation:** Construct a public-interface adapter facade routing direct base-adapter operations into the current transaction as well as native current-adapter-aware operations, with no package patch. Pin backend `better-auth`, `@better-auth/core`, `@better-auth/drizzle-adapter` to `1.7.14`, Nest adapter `2.8.0`; add dev CLI `auth: 1.7.14`. Generate the four-plugin schema with `schemaName: 'auth'`, UUID IDs and additional fields from the design; commit generated SQL. Implement the private typed capability using public `@better-auth/core/context` exports and `transaction: true`. Its transaction callback also binds narrow-function execution to that same Drizzle transaction, never exporting it. Wrap the public Web Request→Response handler so commit occurs before Response release. Test the Nest adapter through an isolated test module. Disable telemetry and noisy BA logging. Record real S6 evidence, clearly separating later not-yet-proven requirements. Exclude `src/**/testing/**` from production compilation while keeping source/test-harness imports valid, and verify a clean build ships no inspection helpers. Do not fall back to `toNodeHandler` unless this proof demonstrates an incompatibility; stop on an unsupported transaction API rather than inventing one.
- [x] **Step 4 — GREEN:** Re-run Step 2, then `pnpm --filter @lexon/backend typecheck` and the two existing test-bed isolation files. Expect real rollback/connection isolation, successful normal parsing, and a clean typecheck.
- [x] **Step 5 — Commit:** `git commit -m "feat(identity): establish Better Auth adapter transaction boundary"`.

### Task 2: Enforce atomic Personal creation and auth column privileges

**Research:** R02–R04, R12; re-read PG17 trigger/constraint/GRANT docs and brief item 9 before this task.

**Files:** Create `backend/drizzle/0004_personal.sql`, `backend/test/integration/personal-organization.spec.ts`, `auth-privileges.spec.ts`; extend `auth-schema.ts`, DB auth test inspection helpers, and migration journal.

**Interfaces:** Consumes Task 1's signup/transaction fixture. Produces invariant-backed `personalOwnerId` uniqueness and Personal membership, plus only these app-role SELECT projections: user `id,emailVerified,twoFactorEnabled,role,banned`; organization `id,name,slug,kind,state,require2fa,personalOwnerId`; member `id,userId,organizationId,role` (use the generated physical column names).

- [x] **Step 1 — RED tests:** Signup yields exactly one Personal and its sole owner; a forced failure after the native user insert leaves zero users/orgs/members. Pause before commit and query through a separate connection: no partial account. Failures creating Personal/member also roll back. Reject extra members, invitations, rename/kind/owner changes, leave/removal, and arbitrary personal deletion. Verify app-role permitted-column reads and forbidden token/password/TOTP/recovery/session/account reads; auth role cannot read `app`/`ops` tables or bypass schema ownership.

  Representative assertion, after arranging the case above:

  ```ts
  test('personal exists with exactly one owner', async () => {
    expect(await inspect.personalFor(userId)).toMatchObject({
      userId,
      role: 'owner',
      memberCount: 1,
    });
  });
  ```

- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/personal-organization.spec.ts backend/test/integration/auth-privileges.spec.ts`; expect missing invariant/grants failures.
- [x] **Step 3 — Implement:** Add migrator-owned safe-path user-insert trigger, Personal/member creation, immutable owner reference and deferred final-state checks. Function privileges do not expose a general mutation API. Revoke broad inherited/default grants before granting the exact projection. Keep runtime DML only under `lexon_auth`; no app-role auth mutations. Add DB test helpers for failpoints without production failpoint flags. F18 deletion remains unavailable.
- [x] **Step 4 — GREEN:** Re-run Step 2 and Task 1 compatibility tests; all rollback and negative privilege assertions pass on fresh and cloned migrated databases.
- [x] **Step 5 — Commit:** `git commit -m "feat(identity): enforce atomic personal workspaces in PostgreSQL"`.

### Task 3: Add append-only audit with a transaction-bound auth writer

**Research:** R03–R04, R12, approved audit decision; re-read function security/default grants and before/after-commit semantics before this task.

**Files:** Create `backend/drizzle/0005_audit.sql`; `backend/src/modules/audit/audit-event.ts`, `audit.service.ts`, `audit.module.ts`, `index.ts`; `backend/src/infrastructure/db/audit.repository.ts`, `auth/auth-functions.ts`; `backend/test/unit/audit-event.spec.ts`; `backend/test/integration/audit-store.spec.ts`. Modify DB schema/index, auth transaction bridge, migration journal.

**Interfaces:** Produces low-level database-owned `AuditWriteRecord` in `backend/src/infrastructure/db/audit-write-record.ts` (no infrastructure import of domain code), strict domain `AuditEventSchema` and schema-derived `AuditEvent` with version1, UUID eventId, type, occurredAt, outcome, optional actor/subject/session/org/invitation/member IDs and event-specific metadata. `AuditService.append(tx: TenantSession, event: OrgAuditEvent): Promise<void>` is the org-scoped app writer; orgId is required and must match the tenant transaction. Events without orgId go through the auth-transaction writer, never this service. Auth commands call one `auth.lexon_append_audit(event jsonb) RETURNS void` on the current auth transaction. `correlateEmail(normalizedEmail: string, secret: string, keyId: string): { subjectHmac: string; keyId: string }` uses domain-separated HMAC-SHA256. No read service.

- [x] **Step 1 — RED tests:** App INSERT and auth narrow-function INSERT succeed; raw auth table access to ops and runtime SELECT/UPDATE/DELETE/TRUNCATE fail. PUBLIC cannot execute the function. AuditService rejects missing/mismatched orgId before insertion; non-org sign-in/platform/setup writes succeed through the auth transaction function. Reject unknown event types, extra keys, malformed IDs, raw email/IP/URL/free-text metadata, and secret sentinels. Inject audit failure during a native auth mutation and assert the mutation rolls back. Roll back an audit-bearing auth transaction and assert no audit remains. A separately recorded failed attempt survives its attempted operation's rollback. HMAC same normalized email/key correlates, another key changes it; no raw subject appears.

  Representative assertion, after arranging the case above:

  ```ts
  test('audit rejects raw subject metadata', async () => {
    expect(
      AuditEventSchema.safeParse({
        ...validAuditEvent,
        metadata: { email: 'person@firm.test' },
      }).success,
    ).toBe(false);
  });
  ```

- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/audit-event.spec.ts --project backend-integration backend/test/integration/audit-store.spec.ts`; expect missing audit behavior.
- [x] **Step 3 — Implement:** Define event-specific schemas (not arbitrary JSON), migrator-owned table/function with fixed `search_path = pg_catalog, auth, pg_temp`, qualified ops references, and EXECUTE solely for app/auth roles; revoke default audit grants explicitly. Bind function execution through Task 1's private transaction capability. Endpoint attempt events may use a separate committed auth transaction; success state events stay in the mutation transaction. Hooks that run after commit cannot provide rollback. Grant no runtime SELECT. Document F17 predicate-builder filtering and no platform-content privilege.
- [x] **Step 4 — GREEN:** Re-run Step 2 plus native transaction rollback tests; verify function privileges through database assertions, not text searches alone.
- [x] **Step 5 — Commit:** `git commit -m "feat(audit): add validated append-only identity events"`.

### Task 4: Define browser-safe identity, security, and organization contracts

**Research:** R06–R08, R17–R18 and shared F0 conventions; re-read relevant native output shapes and Zod4 parsing before this task.

**Files:** Create `shared/src/auth.ts`, `organizations.ts`, `security.ts`; `shared/test/auth.spec.ts`, `organizations.spec.ts`, `security.spec.ts`. Modify `shared/src/index.ts` and `shared/src/pagination.ts`.

**Interfaces:** Export schema-derived `SignUpInput`, `SignInInput`, `ProfileInput`, `CreateOrganizationInput`, `OrganizationSummary`, `MemberSummary`, `InvitationSummary`, `SwitchResult`, `OwnSessionSummary`, `SecurityState`, and corresponding `*Schema`, plus `SafeProfile`, `OrgRole`, `OrgKind`, `OrgAction`, `ProvisioningSummary`, and `Page<T> = {items:T[];pageInfo:{nextCursor:Uuid|null}}`. `SafeProfile` is the own-account projection `{version:1,id,email,name,emailVerified,twoFactorEnabled,onboardingCompleted}`. `SwitchResult = { status: 'switched'|'enrollment_required'; organization: OrganizationSummary; pendingOrganizationId?: Uuid }`. Summaries use UUIDs and ISO timestamps, literal version1, strict objects. `OwnSessionSummary` has id, channel, createdAt, expiresAt, current; no token/email/IP/UA. Export `IdentitySummary = {version:1,user:SafeProfile,organization:OrganizationSummary,fallbackReason?:"membership_removed"|"selection_repaired",previousOrganizationName?:string}`. Define OrgRole owner/admin/member and OrgKind personal/team; OrgAction enumerates create_team/read_members/read_invitations/invite_member/invite_admin/promote_owner/change_role/remove_member/leave/settings. Export a web-safe `IdentityApi` with the routes fixed below and error-code enum, not backend imports. Bearer issuance uses a separate `BearerSessionApi`/response schema and is absent from the web client. Include shared ReauthenticateInput, PasswordChangeInput, PasswordResetInput, EmailChangeInput, TotpInput, RecoveryCodeInput, InvitationInput and OrganizationSettingsInput schemas.

- [x] **Step 1 — RED tests:** Reject 11-character passwords and accept 12; reject extra role/kind/channel/admin fields in forms, malformed IDs, unknown roles/statuses, and token-bearing session summaries. Accept personal/team and provisioning/active only where their contracts permit. Preserve existing Pagination limit20/max100. Public display names are trimmed1–100 characters and team slugs are lowercase ASCII letters/digits with single internal hyphens, length3–63; Personal slugs are server-generated. Map native canceled/rejected/expired outcomes to the public spelling.

  Representative assertion, after arranging the case above:

  ```ts
  test('signup requires twelve characters', async () => {
    expect(
      SignUpInputSchema.safeParse({ ...validSignup, password: 'x'.repeat(11) })
        .success,
    ).toBe(false);
  });
  ```

- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project contracts shared/test/auth.spec.ts shared/test/organizations.spec.ts shared/test/security.spec.ts`; expect missing contracts.
- [x] **Step 3 — Implement:** Reuse `UuidSchema`, `PaginationSchema`, and `ErrorResponseSchema`; schemas contain no auth policy/business logic/Node imports. Form errors remain safe English. Define codes `AUTH_REQUIRED`, `AUTH_EMAIL_VERIFICATION_REQUIRED`, `AUTH_2FA_REQUIRED`, `AUTH_REAUTH_REQUIRED`, `AUTH_DISABLED`, `AUTH_RATE_LIMITED`, `AUTH_UNAVAILABLE`, `ORG_MEMBERSHIP_REQUIRED`, `ORG_LAST_OWNER`, `ORG_FORBIDDEN`, `INVITATION_UNAVAILABLE`, and `VALIDATION_ERROR`. Keep account-existence errors out of public contracts.
- [x] **Step 4 — GREEN:** Re-run Step 2 and `pnpm --filter @lexon/contracts build`; expect schema tests and browser-safe declaration output to pass.
- [x] **Step 5 — Commit:** `git commit -m "feat(contracts): define identity and organization API schemas"`.

### Task 5: Validate API-only auth configuration and implement transactional mail templates

**Research:** R06, R14–R15, R20; re-read Nodemailer SMTP/stream transports and email-enumeration timing docs before this task.

**Files:** Create `backend/src/config/auth-config.ts`; `backend/src/infrastructure/email/email-port.ts`, `email-templates.ts`, `smtp-mailer.ts`, `email.module.ts`, `index.ts`; `backend/test/unit/auth-config.spec.ts`, `email-templates.spec.ts`, `mail-delivery.spec.ts`; `backend/test/setup/auth-environment.ts`. Modify the DB test fixture to use the new Nodemailer in-process transport, API-only `runtime-config.ts` and its tests, `backend/package.json`, lockfile.

**Interfaces:** `readAuthConfig(env): AuthConfig`; add `ApiConfig.auth` only. `EmailPort.send(message: TransactionalEmail): Promise<{messageId:string}>`, `drain(timeoutMs:number): Promise<void>`. `TransactionalEmail` discriminates verification/reset/invitation/email-change/security/admin-setup with typed fields. `createAuthEnvironment(services, healthPath): Record<string,string>` extends F0 env only for API tests. `createApi` later accepts an optional injected EmailPort; production uses SMTP, tests use in-process Nodemailer.

- [x] **Step 1 — RED tests:** Assert approved duration defaults, non-default overrides, positive integers and refresh≤expiry, correct parsing of string false for booleans, HMAC/auth keys distinct and at least32 bytes, secret-free boot errors. HTTP insecure cookies allowed only with explicit local-development mode and a loopback public origin; otherwise Secure required. Workers/dispatcher do not require or receive auth/SMTP secrets. Assert all six mail flows have safe English HTML/text, escaped display input, intended recipient and same-origin action URL. An injected SMTP failure is tracked safely and resend can recover; signup-like delivery does not determine response timing. Drain is bounded.

  Representative assertion, after arranging the case above:

  ```ts
  test('approved cookie policy remains configurable', async () => {
    expect(readAuthConfig(validEnv).cookieSeconds).toBe(604800);
    expect(
      readAuthConfig({
        ...validEnv,
        AUTH_COOKIE_SECONDS: '7200',
        AUTH_COOKIE_REFRESH_SECONDS: '3600',
      }).cookieSeconds,
    ).toBe(7200);
  });
  ```

- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/auth-config.spec.ts backend/test/unit/email-templates.spec.ts backend/test/unit/mail-delivery.spec.ts`.
- [x] **Step 3 — Implement:** Pin Nodemailer `10.3.1`, which bundles its own declarations; do not add the unrelated older @types package. Config keys: `AUTH_PUBLIC_ORIGIN`, `AUTH_SECRET`, `AUTH_AUDIT_HMAC_SECRET`, `AUTH_AUDIT_HMAC_KEY_ID`, `AUTH_OPEN_SIGNUP`, `AUTH_LOCAL_DEVELOPMENT`, `AUTH_COOKIE_SECONDS=604800`, `AUTH_COOKIE_REFRESH_SECONDS=86400`, `AUTH_REAUTH_SECONDS=300`, `AUTH_BEARER_SECONDS=900`, `AUTH_SETUP_SECONDS=86400`, `AUTH_INVITATION_SECONDS=1209600`, `AUTH_VERIFICATION_SECONDS=3600`, `AUTH_RESET_SECONDS=1800`, `DATABASE_AUTH_URL`, `SMTP_URL`, `SMTP_FROM`. AuthConfig uses flat camelCase policy fields such as cookieSeconds/cookieRefreshSeconds/reauthSeconds/setupSeconds and typed SMTP/database configuration. Validate canonical configured origin; callbacks are relative/same-origin only. Never print config values. Keep delivery bounded/tracked after commit without speculative queues/retries. Tests inject stream/buffer transport and inspect content only in memory.
- [x] **Step 4 — GREEN:** Re-run Step 2 and existing runtime-config/boot-failure tests; add API-env use only to tests that boot API, leaving worker process environments secret-free.
- [x] **Step 5 — Commit:** `git commit -m "feat(identity): configure secure sessions and transactional email"`.

### Task 6: Enforce distributed authentication limits with bounded failure

**Research:** R13, R20; re-read RateLimiterRedis options/insurance behavior, BA server-call caveat, Valkey connection policy, and ARC §5.4 before this task.

**Files:** Create `backend/src/infrastructure/queue/auth-limiter.ts`; `backend/src/modules/identity-access/client-address.ts`; `backend/test/unit/client-address.spec.ts`; `backend/test/integration/auth-limiter.spec.ts`. Modify queue public index, auth config, backend package/lockfile.

**Interfaces:** `AuthLimiter.consume(input: {action: AuthLimitAction; clientAddress: string; accountKey?: string}): Promise<void>`; throws safe 429 or503 outcomes. `resolveClientAddress(peer: string, headers: Headers, trustedProxies: readonly string[]): string`. The HTTP layer and every Lexon endpoint which initiates an auth/security command call the same limiter once at their trusted entry boundary.

- [x] **Step 1 — RED tests:** Repeated failures across two limiter instances share account limits; changing IP cannot evade the account limit. Six sign-ins in a minute hit the account limit; use separate accounts to prove the IP limit. Unknown email keys contain only HMAC, not raw email. Expiring keys have TTL. Use F0 FaultProxy against the run-scoped Valkey to disconnect/hang the limiter and inject an OOM/write-rejected RESP response on the private test connection: no auth API operation executes, return503 within2 seconds. Forged forwarded headers from an untrusted peer do not select another IP; trusted chains resolve the first untrusted hop, IPv4-mapped IPv6 normalizes, invalid chains cannot bypass limits.

  Representative assertion, after arranging the case above:

  ```ts
  test('limiter store outage cannot authorize an attempt', async () => {
    await expect(
      limiter.consume({
        action: 'signin',
        clientAddress: '127.0.0.1',
        accountKey: 'test-hmac',
      }),
    ).rejects.toThrow();
    expect(dispatchedAuthCalls).toBe(0);
  });
  ```

- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/client-address.spec.ts --project backend-integration backend/test/integration/auth-limiter.spec.ts`.
- [x] **Step 3 — Implement:** Pin `rate-limiter-flexible: 11.2.3`. Use dedicated ioredis client on limiter URL, retry disabled/offline queue disabled/request timeout bounded; prefix `${filePrefix}:rl:auth:` in tests and `rl:auth:` in runtime. Default account/IP limits per window: signin5/30 per60s; signup3/10 per600s; reset3/10 per600s; verification-resend3/10 per600s; TOTP/recovery5/30 per300s; setup-redemption5/20 per600s; Bearer issuance5/20 per60s. Use strict AUTH_RATE_RULES_JSON overrides (action names and positive account/IP/windowSeconds fields only) and AUTH_TRUSTED_PROXIES for validated explicit proxy addresses/CIDRs; make positive values boot-validatable config; no insurance limiter. Count attempts before dispatch; native rate-limit configuration must not add an unbounded/fail-open alternate path. Do not change shared Valkey CONFIG or start per-test containers; real persistence/topology checks remain in the separate existing Compose smoke layer. Close the owned client on shutdown.
- [x] **Step 4 — GREEN:** Re-run Step 2; assertions verify actual cross-instance counters, TTLs, bounded unavailability and no downstream effect, not mocked exception classes alone.
- [x] **Step 5 — Commit:** `git commit -m "feat(identity): fail closed on distributed auth limiter errors"`.

### Task 7: Publish the auth endpoint allowlist and safe HTTP transport

**Research:** R03–R04, R08–R10, R13; re-read raw-body/Node handler options, exact endpoint inventory and native token outputs before this task.

**Files:** Create `backend/src/modules/identity-access/auth-endpoints.ts`, `auth-http.ts`, `auth-output.ts`, `identity-access.module.ts`, `index.ts`; `backend/test/unit/auth-endpoints.spec.ts`, `auth-output.spec.ts`; `backend/test/integration/auth-http.spec.ts`. Create `backend/src/modules/identity-access/identity-error.ts` exporting `IdentityError(code:IdentityErrorCode,status:number)`. Modify private auth integration/factory and logging redaction. Keep production root mounting until Task 17.

**Interfaces:** `classifyAuthEndpoint(method:string, rawPath:string): AuthEndpointRule|null`; manifest rules carry public/challenge/own-security scope and limiter action. `createAuthHttp(integration, policyDependencies): (request:Request)=>Promise<Response>`. `sanitizeAuthResponse(response:Response, channel:'cookie'|'bearer'):Promise<Response>`. Private framework composition supplies this handler to the community Nest AuthModule with its default global guard disabled.

- [x] **Step 1 — RED tests:** Enumerate actual configured native/custom plugin endpoint paths and methods; every unlisted route returns404 under cookie and Bearer, especially all organization/admin routes and impersonation. Internal `auth.api.createOrganization` remains callable through the authorized private capability despite native HTTP denial. Reject encoded slash/backslash, double encoding, dot segments, duplicate slashes, alternate methods and spoofed internal headers. Large bodies fail413 at a32KiB bound before allocation-heavy parsing; malformed JSON is safe400. Cookie responses contain no token fields or `set-auth-token`; preserve legitimate HttpOnly Set-Cookie and challenge headers. Cross-origin mutations are rejected; arbitrary callback origins are rejected.

  Representative assertion, after arranging the case above:

  ```ts
  test('native organization mutations have no HTTP exception', async () => {
    expect(
      classifyAuthEndpoint('POST', '/api/auth/organization/create'),
    ).toBeNull();
  });
  ```

- [x] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/auth-endpoints.spec.ts backend/test/unit/auth-output.spec.ts --project backend-integration backend/test/integration/auth-http.spec.ts`.
- [x] **Step 3 — Implement:** Transcribe the approved design's standard method/path allowlist (with the researched server-only verifyPassword correction), including reset callback and own-security restrictions. No wildcard organization/admin/custom-plugin exposure. Read/check canonical raw path before framework normalization. Limit before dispatch, validate shared form fields, preserve raw auth body, and project safe output using an allowlist. Whitelist response headers and sanitize errors independently of Nest filters. Public health stays outside auth limiter/DB transactions. Remove Admin-plugin impersonation privileges and deny internal impersonation operations too. Restrict per-user fields to the approved profile input. Disable BA cookie/secondary session caches and telemetry.
- [x] **Step 4 — GREEN:** Re-run Step 2, Task 1 parser tests and log redaction tests. Snapshot the explicit endpoint manifest, not generated JSX or arbitrary responses.
- [x] **Step 5 — Commit:** `git commit -m "feat(identity): restrict Better Auth HTTP surface"`.

### Task 8: Complete verified signup and account-security flows

**Research:** R03, R06, R14; re-read native signup synthetic responses, email verification, password/reset transactions and email-change behavior before this task.

**Files:** Create `backend/src/modules/identity-access/account.service.ts`, `account.controller.ts`, `signup-policy.ts`; `backend/src/infrastructure/db/auth/account-plugin.ts`; `backend/test/integration/account-flows.spec.ts`, `signup-mode.spec.ts`; `backend/test/unit/signup-policy.spec.ts`. Modify shared form contracts as needed without introducing backend dependencies, auth factory/hooks and audit event variants.

**Interfaces:** `AccountService.profile(identity:VerifiedIdentity):Promise<SafeProfile>`; `updateProfile(identity,input:ProfileInput):Promise<SafeProfile>`; `completeOnboarding(identity):Promise<void>`. `SignupPolicy.authorize(input:{email:string; invitationId?:Uuid; setupToken?:string}):Promise<void>` queries eligibility through `auth.api.lexonSignupEligibility`, initially rejecting absent grants. Public routes `GET/PATCH /api/identity/profile`, `POST /api/identity/onboarding/complete`. `VerifiedIdentity` is the request-bound, non-forgeable server type in `identity-access/identity.types.ts` with UUID userId/sessionId/activeOrganizationId, cookie|bearer channel, boolean platformAdmin and Date|null mfaVerifiedAt/reauthenticatedAt; no token or client-settable role.

- [ ] **Step 1 — RED tests:** Open signup→verification→signin, expired link→resend, disabled account and wrong-password generic response. Existing and absent signup/reset cases have equal status/safe body shape, no cookie and no account-existence code; slow/failing SMTP does not distinguish them. Invitation-only mode rejects open registration while valid email-bound invite/setup proof permits signup but grants no team/admin rights. For proof not yet created by later tasks, use private migration-owned fixture insertion, never a production bypass. Change password with wrong current password leaves old password/sessions; success revokes all others. Reset revokes all and a failure preserves old password/token atomically. Email change takes effect only after new-address verification; a competing account owning that address is not disclosed. Whitespace/case normalization is consistent without provider alias folding; changing email does not transfer invitation identity.

  Representative assertion, after arranging the case above:

  ```ts
  test('duplicate signup cannot create another account', async () => {
    expect(existingSignupResponse.status).toBe(absentSignupResponse.status);
    expect(await inspect.countUsers(existingEmail)).toBe(1);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/signup-policy.spec.ts --project backend-integration backend/test/integration/account-flows.spec.ts backend/test/integration/signup-mode.spec.ts`.
- [ ] **Step 3 — Implement:** Configure `requireEmailVerification:true`, signup/verification auto-signin false, full synthetic-user field shape or a fixed safe envelope, configured link expiry, and forced session revocation. Hooks use BA password verification, never custom comparison. Create internal read/profile primitives through documented plugin APIs, not SQL. The eligibility primitive returns locked grant facts; SignupPolicy in modules/identity-access decides signup eligibility and passes explicit preconditions for any mutation. Signup retains the block's name input using the shared signup contract; onboarding pre-fills that name for confirmation/update. Own profile permits display name only; setup/invitation inputs never assign admin/kind/role. Record password/email/session transitions in the state transaction and attempts separately. Force session expiry/refresh policies from Task 5; no public session-field mutation.
- [ ] **Step 4 — GREEN:** Re-run Step 2, audit rollback/Personal tests and server-native API variants to prove policy is not bypassed by a controller omission.
- [ ] **Step 5 — Commit:** `git commit -m "feat(identity): add verified account and recovery flows"`.

### Task 9: Require session-level MFA and recent reauthentication

**Research:** R03–R04, R07–R08; re-read exact 2FA enable/verify/disable/session replacement code and freshness semantics before this task.

**Files:** Create `backend/src/modules/identity-access/security.service.ts`, `security.controller.ts`, `session-evidence.ts`; `backend/src/infrastructure/db/auth/security-plugin.ts`; `backend/drizzle/0006_session_security.sql`; `backend/test/integration/two-factor.spec.ts`, `reauthentication.spec.ts`; `backend/test/unit/session-evidence.spec.ts`; `backend/test/setup/totp.ts`. Modify auth schema/factory, journal, audit variants and endpoint rules.

**Interfaces:** `SessionEvidence.requireMfa(identity):void`, `requireRecent(identity,now:Date,seconds:number):void`. `SecurityService.reauthenticate(identity,input:{password:string;totp?:string;recoveryCode?:string}):Promise<void>` uses BA password/factor APIs and records server-owned evidence only after success. Routes `GET /api/identity/security`, `POST /api/identity/security/reauthenticate`. Native allowlisted TOTP/security endpoints retain their approved URLs.

- [ ] **Step 1 — RED tests:** Enrollment stays disabled until correct TOTP; credential signin with enabled2FA yields challenge and no usable app session until TOTP or recovery success. Consume a recovery code once; concurrent reuse permits only one success. Reject `trustDevice:true`, email-OTP methods and client-supplied MFA evidence. Account-route exemptions allow enrollment only while MFA is not yet enabled; an older non-MFA session cannot fetch an existing TOTP seed, disable/regenerate factors or perform arbitrary security actions. Sessions created before enrollment do not acquire MFA by reading the enabled-user flag. Old session reauthentication requires password plus enabled second factor; at300 seconds recent evidence expires. Disable/regenerate requires recent evidence and current password; platform admins never retain operational access with2FA off. Replacement sessions preserve channel, hard-expiry cap and active organization without replaying old MFA timestamps. Audit failure rolls back factor/security changes.

  Representative assertion, after arranging the case above:

  ```ts
  test('MFA enrollment flag does not authenticate an older session', async () => {
    expect(oldSessionProtectedResponse.status).toBe(403);
    expect(newMfaSessionProtectedResponse.status).toBe(200);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/session-evidence.spec.ts --project backend-integration backend/test/integration/two-factor.spec.ts backend/test/integration/reauthentication.spec.ts`.
- [ ] **Step 3 — Implement:** Native Two-Factor handles secret storage, verification and codes; no email OTP/passwordless or remembered-device path. The module computes evidence policy; the security primitive writes explicit evidence values with expected-state preconditions after trusted completed operations, with transaction-bound success audit. Add DB protection for server-owned session channel/hard-expiry/evidence. Test TOTP generation uses a Node-crypto RFC6238 test oracle verified against published vectors; it is never runtime authentication code. Existing long-lived sessions use explicit reauth evidence for Lexon's recent-action policy; do not forge a fresh native context, reset `createdAt`, or disable native sensitive checks. Token-free session listing is a custom own-account server API in Task14, so it need not invoke the native fresh-session-only list endpoint. Native password/factor operations retain their own authoritative-session and password checks.
- [ ] **Step 4 — GREEN:** Re-run Step 2 plus Task 1 rollback proof for native 2FA writes, session changes and callbacks. Native2FA direct adapter accesses must remain on the transaction owned by the facade; add the regression before accepting the bridge.
- [ ] **Step 5 — Commit:** `git commit -m "feat(identity): enforce verified MFA and recent reauthentication"`.

### Task 10: Centralize team policy and database owner invariants

**Research:** R05, R12; re-read org native create/update/member-role APIs and PG17 locking/snapshots/deferred constraints before this task.

**Files:** Create `backend/src/modules/identity-access/identity-policy.ts`, `organization-auth.port.ts`; `backend/src/modules/organizations/organization.service.ts`, `organization.controller.ts`, `organizations.module.ts`, `index.ts`; `backend/src/infrastructure/db/auth/organization-plugin.ts`; `backend/drizzle/0007_org_invariants.sql`; `backend/test/unit/identity-policy.spec.ts`; `backend/test/integration/organizations.spec.ts`, `owner-invariant.spec.ts`. Modify public module exports, journal, schema and audit variants.

**Interfaces:** `IdentityPolicy.can(input:{action:OrgAction;actorRole:OrgRole|null;targetRole?:OrgRole;kind:OrgKind}):boolean`; `require(...)` throws a safe code. `OrganizationAuthPort.transaction<T>(identity:VerifiedIdentity, work:(commands:AuthCommandSession)=>Promise<T>):Promise<T>` rechecks the session and bound actor. `OrganizationService.list(identity,page):Promise<Page<OrganizationSummary>>`, `create(identity,input:CreateOrganizationInput):Promise<OrganizationSummary>`, `settings(identity,orgId,input:{name?:string;slug?:string;require2fa?:boolean}):Promise<OrganizationSummary>`. Routes `GET/POST /api/organizations`, `PATCH /api/organizations/:orgId/settings`.

- [ ] **Step 1 — RED tests:** Exhaust the approved action/actor/target matrix, including admin inviting admins forbidden, admins changing admin/member roles allowed, admins removing admins forbidden, owner promotion allowed, and no platform-role shortcut. Team creation gives one owner, stays on the old active organization and commits its audit. Personal can't be modified through any team command or read by another user. Two owners concurrently leaving/demoting/removing cannot both commit; test native API plus direct privileged DB mutations and actor-demotion races with independent connections/barriers. Deferred check permits valid create+owner within one transaction. Invariants apply to active teams only; provisioning has no members and one current first-owner invite.

  Representative assertion, after arranging the case above:

  ```ts
  test('admins cannot invite admins', async () => {
    expect(
      policy.can({ action: 'invite_admin', actorRole: 'admin', kind: 'team' }),
    ).toBe(false);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/identity-policy.spec.ts --project backend-integration backend/test/integration/organizations.spec.ts backend/test/integration/owner-invariant.spec.ts`.
- [ ] **Step 3 — Implement:** All services enter the port transaction, lock organization/actor/target state through a narrow `auth.lexon_lock_organization(org_id uuid)` function on that connection, re-read roles, call BA server APIs, and audit before commit. Serialize writes on the parent row and validate final state with deferred triggers; prevent write skew under actual PG snapshots, using a real parent-row write/version fence if a lock alone is insufficient. Retry serialization/deadlock at most3 times with fresh policy reads; no duplicate effects. Require unique member pair and valid role/kind/state enums. Use configured bounded pagination, return only the user's Personal plus member teams; settings are owner-only. Deny all organization deletion in F1 except the later narrow provisioning-cancel operation.
- [ ] **Step 4 — GREEN:** Re-run Step 2 plus Personal invariants. Inspect final owner counts after synchronized races rather than accepting any thrown error as proof.
- [ ] **Step 5 — Commit:** `git commit -m "feat(organizations): enforce team policies and concurrent owner safety"`.

### Task 11: Derive tenant context and switch only the current session

**Research:** R05, R07–R08, R11–R12; re-read active-organization API, session resolution and F0 withTenant before this task.

**Files:** Create `backend/src/modules/identity-access/tenant.guard.ts`, `request-identity.ts`, `route-access.ts`, `identity.controller.ts`; `backend/src/modules/organizations/organization-switch.service.ts`; `backend/src/infrastructure/db/auth/selection-plugin.ts`; `backend/test/integration/tenant-guard.spec.ts`, `organization-switch.spec.ts`. Modify identity module/index and org controller.

**Interfaces:** `TenantGuard.canActivate(context:ExecutionContext):Promise<boolean>` attaches safe `VerifiedIdentity` and `TenantRequestContext = {orgId:Uuid;userId:Uuid;role:OrgRole}`. `@PublicRoute()`, `@AccountRoute()` and `@PlatformRoute()` are explicit access metadata, with full workspace access the default. `OrganizationSwitchService.select(identity, orgId:Uuid):Promise<SwitchResult>`; `GET /api/identity` returns safe identity/current-org/fallback reason; `POST /api/organizations/active` accepts `{organizationId}`. `auth.api.lexonSelectOrganization` and `lexonRepairSelection` are server-only, transactional compare/recheck operations.

- [ ] **Step 1 — RED tests:** All non-public controller routes reject absent/expired/disabled/unverified/incomplete-MFA identities. Public health works while auth dependencies are down. A user's Personal+two teams switch independently on two sessions; the next route calls `withTenant` with exactly the verified IDs. Reject tenant overrides in headers/body/query. Recheck membership/role every request despite cookie caching attempts. Removing the active membership falls back to Personal next request with a safe reason. Synchronize repair with explicit switching: repair cannot overwrite the newer selection. Requiring2FA keeps the original active org and returns enrollment-required; after enrollment membership/state/policy are rechecked before entry, including removal while enrolling. A503 must not be interpreted as logout/fallback.

  Representative assertion, after arranging the case above:

  ```ts
  test('removed active membership falls back to Personal', async () => {
    expect(await identityResponse.json()).toMatchObject({
      organization: { kind: 'personal' },
      fallbackReason: 'membership_removed',
    });
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/tenant-guard.spec.ts backend/test/integration/organization-switch.spec.ts`.
- [ ] **Step 3 — Implement:** Resolve credential/session through the private gateway, validate session evidence, then membership via BA server API. Use one policy service. The module computes selection eligibility from locked facts. Update selection only under current-session/organization locks via the dumb narrow function/BA command primitive, passing explicit target IDs and expected-state preconditions. Set Personal at session creation instead of nullable active organization; clients cannot unset it. `pendingOrganizationId` is server-owned and grants no access. Keep all app database contexts explicit. Fallback reasons use the shared IdentitySummary fields; previous organization name is returned only for that session's former selection, never an arbitrary org lookup. Use an isolated test controller/tenant fixture to prove RLS; do not add a production debug route.
- [ ] **Step 4 — GREEN:** Re-run Step 2 and F0 tenant-isolation tests; prove role-removal changes behavior on a fresh request with the same cookie.
- [ ] **Step 5 — Commit:** `git commit -m "feat(identity): derive and verify tenant context per request"`.

### Task 12: Implement invitation lifecycle, role floor and identity-bound retries

**Research:** R05–R06, R12, R14; re-read create/accept/reject/cancel/list APIs and pinned acceptance transaction behavior before this task.

**Files:** Create `backend/src/modules/organizations/invitation.service.ts`, `invitation.controller.ts`, `invitation-policy.ts`; `backend/src/infrastructure/db/auth/invitation-plugin.ts`; `backend/test/integration/invitations.spec.ts`, `invitation-concurrency.spec.ts`; `backend/test/unit/invitation-status.spec.ts`, `invitation-policy.spec.ts`. Modify shared contracts and the eligibility endpoint; all required uniqueness/recipient fields are created by Tasks1/10, so do not rewrite committed migrations.

**Interfaces:** `InvitationService.create(identity,orgId,input:{email:string;role:'member'|'admin'}):Promise<InvitationSummary>`; `listForOrganization(identity,orgId,page)`, `listMine(identity,page)`, `resend(identity,invitationId)`, `cancel(identity,invitationId)`, `decline(identity,invitationId)`, `accept(identity,invitationId):Promise<{invitation:InvitationSummary;selection:SwitchResult}>`. Routes `GET/POST /api/organizations/:orgId/invitations`, `POST /api/invitations/:id/resend|cancel|decline|accept`, `GET /api/identity/invitations`. Server-only `lexonAcceptInvitation` is a dumb expected-state mutation primitive on the BA tables; the organization service computes idempotency classification and resulting role using the pure domain helpers before passing explicit parameters. Pure `roleForFirstAcceptance(current:OrgRole|null, invited:OrgRole):OrgRole` and `classifyInvitationAcceptance({status,expired,acceptedByUserId,actorUserId,hasMembership}):"first"|"retry"|"deny"` live in invitation-policy.ts; only first acceptance applies the role floor.

- [ ] **Step 1 — RED tests:** Owner invites admin, admin invites member, forbidden role matrix denies owner invitation outside provisioning. Only verified matching recipient lists/accepts/declines; non-member org invite/member lists denied. Duplicate pending invite is one row; expired resend retires/replaces it safely. Accept joins or applies the higher role; existing admin/owner never demoted. Same accepted ID+same user+extant membership is effect-free success despite a later role change; departed user cannot rejoin from it; a different account with the original email cannot replay it. Concurrent accept consumes once, returns stable outcomes and creates one audit/membership. Resend/cancel/accept and email-change races cannot resurrect stale authorization. SMTP failure preserves valid state and enables resend. An org requiring2FA establishes membership but keeps prior active selection until enrollment succeeds.

  Representative assertion, after arranging the case above:

  ```ts
  test('consumed invitation cannot restore membership', async () => {
    expect(replayAfterDeparture.status).toBe(403);
    expect(await inspect.member(recipientId, organizationId)).toBeNull();
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-unit backend/test/unit/invitation-status.spec.ts --project backend-integration backend/test/integration/invitations.spec.ts backend/test/integration/invitation-concurrency.spec.ts`.
- [ ] **Step 3 — Implement:** Use native `createInvitation`, `cancelInvitation`, `rejectInvitation`, and list/get APIs where their behavior fits. The organization service locks organization then invitation, reads facts, computes recipient authorization, first/retry/deny classification and the role floor in modules/organizations, then calls the dumb server-only acceptance primitive with expected state and explicit resultingRole/acceptanceAction. The primitive uses documented adapter operations in the same transaction, verifies the expected state/recipient/membership identities, writes the supplied result and returns facts; it makes no policy decision. Do not call native accept blindly for an already-existing member or consumed invite. Database unique constraints cover normalized pending-email and membership pairs. Recipient links remain opaque IDs with verified-email requirement; signup eligibility does not reveal org/email details. Audit actual lifecycle transitions once, not idempotent retries. Set expiration from configured14-day default.
- [ ] **Step 4 — GREEN:** Re-run Step 2, signup-mode and organization-switch suites. Use independent clients/barriers for duplicate acceptance and inspect committed row counts.
- [ ] **Step 5 — Commit:** `git commit -m "feat(organizations): add recipient-bound invitation lifecycle"`.

### Task 13: Manage roles and departures with audit-only consistency

**Research:** R05, R12; re-read member update/remove/leave APIs and brief PR14's audit-only departure rule before this task.

**Files:** Create `backend/src/modules/organizations/membership.service.ts`, `membership.controller.ts`; `backend/test/integration/membership-actions.spec.ts`, `departure-audit.spec.ts`. Modify organization plugin/facade, identity policy and audit event schema.

**Interfaces:** `MembershipService.list(identity,orgId,page):Promise<Page<MemberSummary>>`, `changeRole(identity,orgId,memberId,role):Promise<MemberSummary>`, `remove(identity,orgId,memberId):Promise<void>`, `leave(identity,orgId):Promise<void>`. Routes `GET /api/organizations/:orgId/members`, `PATCH /api/organizations/:orgId/members/:memberId`, `DELETE` same member path, `POST /api/organizations/:orgId/leave`.

- [ ] **Step 1 — RED tests:** Exhaust actor/target matrix over real HTTP/native service commands. Removed users lose next-request access across existing sessions; Personal is retained. Actor demotion racing a role/remove request cannot use stale privilege. Last-owner protections work through every service path. Successful leave/remove yields exactly one `organization.member_departed.v1` audit with IDs and fixed leave/remove reason; an audit failure rolls back membership removal. Record `ops.outbox` count before and after successful, failed, repeated and concurrent departures: unchanged. No outbox schema or dispatcher change is needed.

  Representative assertion, after arranging the case above:

  ```ts
  test('departure writes audit only', async () => {
    expect(await inspect.auditCount('organization.member_departed.v1')).toBe(
      beforeAudit + 1,
    );
    expect(await inspect.outboxCount()).toBe(beforeOutbox);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/membership-actions.spec.ts backend/test/integration/departure-audit.spec.ts`.
- [ ] **Step 3 — Implement:** Reuse Task10 locking/policy and native `updateMemberRole`, `removeMember`, `leaveOrganization` server APIs. Audit in the same auth transaction, bind the removed member/user IDs and actor, and let Task11 repair sessions on their next request. No asynchronous handover, content mutation, outbox append, job handler or dispatcher metadata. F18 owns handover design. Deny non-members before returning lists/role details.
- [ ] **Step 4 — GREEN:** Re-run Step 2 plus owner-invariant, invitation replay and tenant-guard tests. Inspect unchanged outbox rows rather than merely asserting a mock producer was not called.
- [ ] **Step 5 — Commit:** `git commit -m "feat(organizations): manage membership with atomic departure audit"`.

### Task 14: Issue hard-expiry Bearer sessions and expose safe session management

**Research:** R04, R07–R08; re-read Bearer header hooks, internal createSession override type, refresh and safe/native session list differences before this task.

**Files:** Create `backend/src/infrastructure/db/auth/session-plugin.ts`; `backend/src/modules/identity-access/session.service.ts`, `session.controller.ts`; `backend/test/integration/bearer-sessions.spec.ts`, `own-sessions.spec.ts`. Modify session-security migration, auth factory/schema/HTTP channel checks and audit variants.

**Interfaces:** `SessionService.issueBearer(identity:VerifiedIdentity):Promise<{token:string;sessionId:Uuid;expiresAt:string}>`, `list(identity):Promise<OwnSessionSummary[]>`, `revoke(identity,sessionId:Uuid):Promise<void>`. Routes `POST /api/identity/bearer-sessions`, `GET /api/identity/sessions`, `DELETE /api/identity/sessions/:sessionId`. Internal `lexonIssueBearer`, `lexonListOwnSessions`, `lexonRevokeOwnSession` are server-only plugin APIs.

- [ ] **Step 1 — RED tests:** Valid fully authenticated cookie creates a separate Bearer row; enabled2FA requires completed MFA, not just password/challenge/enabled flag. Bearer and ambiguous cookie+Bearer requests cannot issue replacements. Web cookies replayed as Authorization and Bearer tokens replayed as cookies are rejected. Test exactly900 seconds by controlled timestamps/clock, plus a non-default configured lifetime; native get-session refresh and session-replacing security endpoints never extend the hard cap. Cookie source expiry/revoke policy is independent; revoking the Bearer row returns401 immediately. Bearer has its own active org and membership checks and cannot switch to a non-member team. Safe list includes both classes but no tokens, cookies, email, IP or user agent; another user's sessionId cannot be revoked. Expired listed entries are excluded. Token response has no-store and no URL/log/audit/error leakage.

  Representative assertion, after arranging the case above:

  ```ts
  test('web session summaries never contain native tokens', async () => {
    expect(sessions.some((session) => 'token' in session)).toBe(false);
    expect(afterBearerRevocation.status).toBe(401);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/bearer-sessions.spec.ts backend/test/integration/own-sessions.spec.ts`.
- [ ] **Step 3 — Implement:** The identity session service computes cookie-only/full-authentication eligibility and the expiry/selection from locked facts, then calls the dumb private server primitive with explicit values and source-state preconditions. That primitive invokes BA-supported session creation, storing immutable `channel`/`hardExpiresAt`; source credentials never convert to Bearer. Enforce channel before native auth and again after resolution. Clamp/deny all expiry writes in DB triggers and preserve caps on replacement sessions. Map session IDs to own native sessions within the private plugin; never send a native session token to the web to support revocation. Safe list can use the server plugin's adapter API rather than exposing native token-bearing/fresh-session-only HTTP output. Reuse one global guard, limiter and policy. No refresh token or F19 renewal endpoint.
- [ ] **Step 4 — GREEN:** Re-run Step 2 and session-evidence, switch and allowlist suites. Confirm hard-expiry enforcement independently at SQL and HTTP levels.
- [ ] **Step 5 — Commit:** `git commit -m "feat(identity): add isolated short-lived Bearer sessions"`.

### Task 15: Provision teams without staff membership and restrict platform actions

**Research:** R05, R09, R12; re-read stock creator-membership behavior, Admin ban/unban, and provisioning invariants before this task.

**Files:** Create `backend/src/modules/organizations/provisioning.service.ts`, `provisioning.controller.ts`; `backend/src/modules/identity-access/platform-admin.service.ts`, `platform-admin.controller.ts`; `backend/src/infrastructure/db/auth/provisioning-plugin.ts`; `backend/test/integration/provisioning.spec.ts`, `platform-admin.spec.ts`. Modify org invariants, invitation plugin, audit and public module exports.

**Interfaces:** `ProvisioningService.create(identity,input:{name:string;slug:string;ownerEmail:string}):Promise<ProvisioningSummary>`; `list`, `get`, `resend`, `replaceOwnerEmail`, `cancel` with identity/orgId. `PlatformAdminService.setDisabled(identity,userId,disabled:boolean):Promise<void>`. Routes `GET/POST /api/platform/provisioning`, `GET/DELETE /api/platform/provisioning/:orgId`, `POST /:orgId/resend`, `PATCH /:orgId/owner-email`, `PATCH /api/platform/users/:userId/disabled`. ProvisioningSummary exposes only org metadata/current invite status, never member/content data.

- [ ] **Step 1 — RED tests:** Non-admin/incomplete-MFA/cookie-before-MFA/session-before-enrollment denied on every platform route. Creation commits a provisioning org+one first-owner invitation and zero staff memberships. All user lists/switch/content proofs exclude it. Expired invite leaves provisioning; resend retains one current invite; replacing email invalidates the old action link; cancel deletes org/invite while preserving audit. Verified first-owner acceptance atomically creates owner+active state or rolls back all three, including audit. Concurrent cancellation/replacement/acceptance has one coherent result. Staff cannot use their platform role to read members/invitations of active customer teams or become owners. Disable revokes all cookie/Bearer sessions; re-enable does not resurrect them. Impersonation unavailable both server-side and HTTP.

  Representative assertion, after arranging the case above:

  ```ts
  test('provisioning never enrolls platform staff', async () => {
    expect(provisioned.state).toBe('provisioning');
    expect(await inspect.member(platformAdminId, provisioned.id)).toBeNull();
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/provisioning.spec.ts backend/test/integration/platform-admin.spec.ts`.
- [ ] **Step 3 — Implement:** The platform domain service computes provisioning authorization and explicit organization/invitation values, then calls server-only `lexonProvisionTeam`, a dumb transactional primitive, because native create always adds creator membership. It uses the same BA adapter/tables and transaction, records one owner invite, sends mail after commit, and no membership. Acceptance uses Task12's module-owned decision and expected-state server primitive atomically; platform-only cancel is the sole F1 team-delete exception. Native Admin ban/unban APIs are behind fresh full-MFA platform policy and transactional audit, with permissions restricted to disable/re-enable and allowed metadata. No platform web promotion/create-user/impersonation endpoint. Never invoke the stock create-admin CLI, which can mark emails verified.
- [ ] **Step 4 — GREEN:** Re-run Step 2, owner/invitation race tests, exhaustive allowlist and safe audit tests.
- [ ] **Step 5 — Commit:** `git commit -m "feat(organizations): add memberless platform provisioning"`.

### Task 16: Establish platform administrators through an audited operator command

**Research:** R03–R04, R06–R07, R09, R12, R14; re-read plugin authoring/verified enrollment, CLI defaults, setup brief item10 and Postgres admission locking before this task.

**Files:** Create `backend/src/entrypoints/admin-setup/main.ts`; `backend/src/infrastructure/db/auth/admin-setup-plugin.ts`; `backend/drizzle/0008_admin_setup.sql`; `backend/src/modules/identity-access/admin-setup.service.ts`, `admin-setup.controller.ts`; `backend/test/integration/admin-setup.spec.ts`; `scripts/test/admin-setup-command.spec.mjs`. Modify config/schema/factory/journal and backend package commands.

**Interfaces:** `runAdminSetup(input:{email:string;additional:boolean}, dependencies):Promise<{status:'created'|'pending'|'refused'}>` runs one-shot without HTTP. Server-only `lexonBeginAdminSetup`, `lexonRedeemAdminSetup`, `lexonActivateAdmin` APIs. Public `POST /api/identity/admin-setup/redeem` validates the emailed grant only, never begins setup; authenticated `POST /api/identity/admin-setup/complete` activates after verified email and TOTP. Command `node backend/dist/entrypoints/admin-setup/main.js --email <email> [--additional]`; package script `identity:setup-admin` invokes that entrypoint. No env-var admin allowlist. The domain setup service decides eligibility/activation from locked facts and passes explicit expected-state parameters to its dumb server primitives. A setup-redemption HTTP route only consumes an emailed grant; it can never begin operator setup.

- [ ] **Step 1 — RED tests:** Fresh invitation-only setup sends one link and permits only its email to register, without role/verification bypass. An existing account must authenticate and keeps its current ordinary access/org. No admin capability before verified email+enrolled TOTP+completed MFA. Every successful/refused/repeated invocation has an audit event with user ID or HMAC. Same pending email is idempotent, expiry reissues safely, and different concurrent first-admin requests admit at most one initial setup. Existing admin causes refusal without `--additional`; additional setup still requires all factors. Double link redemption/completion cannot activate another account or reuse a spent grant. Delivery failure leaves a reissuable pending grant. CLI output/errors never include email/full link/secret; unknown flags fail safely. HTTP cannot begin admin setup or assign roles.

  Representative assertion, after arranging the case above:

  ```ts
  test('a pending operator setup is idempotent', async () => {
    expect(await inspect.setupCount(setupEmail)).toBe(1);
    expect(await inspect.auditCount('platform.admin_setup_invoked.v1')).toBe(2);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/admin-setup.spec.ts` and `node --test scripts/test/admin-setup-command.spec.mjs`.
- [ ] **Step 3 — Implement:** Add digest-only expiring setup grants in `auth`, one pending initial-administrator reservation, and an admission lock also used at activation. The operator-only composition includes the begin capability; the API composition exposes only redeem/complete. Persist the pending grant and command audit together; rejected runs audit in their own committed transaction. Send setup mail after admission, track safe failure. Activation assigns the Admin-plugin role via BA server capability and consumes grant atomically; API requests cannot supply role/userId authority. Use the default24h expiry from config. Existing user passwords are not overwritten. Later web-admin creation stays deferred.
- [ ] **Step 4 — GREEN:** Re-run Step 2 with two actual CLI processes for admission races, plus signup-mode, MFA and platform-access tests.
- [ ] **Step 5 — Commit:** `git commit -m "feat(identity): add one-shot platform administrator setup"`.

### Task 17: Wire the API, operator service, development SMTP and isolated E2E mail capture

**Research:** R10–R15, R19, planning image check R22; re-read Compose/Nest lifecycle, Mailpit runtime defaults, Nodemailer transport injection, and the existing owned-stack harness before this task.

**Files:** Modify `backend/src/bootstrap/api.ts`, `entrypoints/api/root.module.ts`, `infrastructure/db/index.ts`, identity/org/audit module wiring, `infrastructure/telemetry/health-indicators.ts`, `health-snapshot.ts`, `bootstrap/runtime-providers.ts`, `docker-compose.yml`, `.env.example`, `config/container-images.env`, `scripts/container-images.mjs`, `container-images.d.mts`, `compose-environment.mjs`, `dev.mjs`, `e2e.mjs`, root package, existing API/runtime/E2E tests. Create `scripts/setup-admin.mjs`; `backend/test/e2e/auth-api-main.mjs`, `mail-control.mjs`, `compose.identity.yml`, `identity-support.ts`; `scripts/test/identity-compose.spec.mjs`; `backend/test/integration/identity-runtime.spec.ts`.

**Interfaces:** `createApi(config:ApiConfig, options?:{email?:EmailPort}):Promise<INestApplication>`; injected mail is an in-process composition parameter, not an environment-enabled production capture mode. Test-only `readCapturedMail(project, recipient, kind):Promise<CapturedMail>` executes a control client inside the API container over a mode0600 Unix socket. The test entrypoint starts the real API with Nodemailer in-process transport and owns that socket in tmpfs; it has no HTTP inbox or auth bypass. `pnpm identity:setup-admin -- --email <email> [--additional]` loads existing private Compose env and runs the one-shot `admin-setup` service.

- [ ] **Step 1 — RED tests:** Real API mounts `/api/auth` exactly once, ordinary JSON still validates, global guard protects diagnostics, and only health is anonymous. API auth/limiter resources close on shutdown and failed startup; auth DB outage marks API readiness down while liveness stays up. Workers/evals/dispatcher load no Better Auth, SMTP secret or API-only module. Manifest/Compose tests assert Mailpit profile, digest, loopback UI-only publishing, tmpfs, no relay/forwarding, and no CI/default profile membership. Captured mails can be read by the test control client only; no test HTTP inbox/credentials appear in runtime image or normal entrypoint. Repeated script invocations keep credentials private. Operator service exits and audits instead of listening.

  Representative assertion, after arranging the case above:

  ```ts
  test('workers do not receive API identity secrets', async () => {
    expect(
      Object.keys(workerEnvironment).some((key) =>
        /^(AUTH_|DATABASE_AUTH_URL|SMTP_)/.test(key),
      ),
    ).toBe(false);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/identity-runtime.spec.ts`; `node --test scripts/test/identity-compose.spec.mjs`.
- [ ] **Step 3 — Implement:** Mount the restricted integration via Nest adapter and register the Lexon global guard/controller scopes; keep DB public-barrel auth exports lazy/type-only so worker imports of TenantDatabase cannot evaluate Better Auth transitively; wire only API identity/org/audit/email modules. Disable Nest auto parsing as proven in Task1. Use lifecycle hooks for auth pool/limiter/mail cleanup and add an API-only `auth` readiness probe with status/name only. Derive `DATABASE_AUTH_URL` in Compose loader; place auth/HMAC/SMTP config only on API and explicit operator setup service, never shared runtime env. Add optional profile `dev-mail` with `MAILPIT_IMAGE=axllent/mailpit:v1.33.0@sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231`; manifest loader permits the exact `v`-prefixed version tag without weakening digest checks. Mailpit uses `core`, no SMTP host port, `127.0.0.1:${MAILPIT_HOST_PORT:-8025}:8025`, ephemeral tmpfs, no relay/forward config and version-check disabled. `pnpm dev --mail` explicitly selects that profile; without it SMTP_URL must name the developer's configured SMTP service. Do not make edge internal or add frontend secrets. Test overlay bind-mounts only the test mail entry/control files, adds no production code flag, and uses test driver `docker compose exec -T` for in-memory link retrieval. Test secrets/origins are generated per owned stack; security artifacts are never printed. Update existing tests with authenticated fixtures when diagnostics become protected.
- [ ] **Step 4 — GREEN:** Re-run Step2, `node --test scripts/test/*.spec.mjs`, focused API composition tests and `pnpm test:e2e -- --project runtime-health --project backend-api --project topology`; expect all existing health/topology guarantees preserved, Mailpit absent from E2E, and owned cleanup complete.
- [ ] **Step 5 — Commit:** `git commit -m "feat(identity): wire auth runtimes and optional development mail"`.

### Task 18: Add safe frontend clients, cookie routing and minimal shadcn foundations

**Research:** R16–R21, new component metadata R22; re-read cookie/proxy/SSR rules, Query cancellation, RHF fields and CLI inspect/view/add before this task.

**Files:** Create `frontend/src/lib/auth-client.ts`, `identity-client.ts`, `server-identity-client.ts`, `return-path.ts`, `tenant-queries.ts`; `frontend/src/components/auth/auth-card.tsx`, `session-boundary.tsx`, owned `ui/card.tsx`, `field.tsx`, `input.tsx`, `label.tsx`, `button.tsx`, `separator.tsx`, `input-otp.tsx`, `lib/utils.ts`; `frontend/test/identity-client.spec.tsx`, `auth-proxy.spec.tsx`, `tenant-queries.spec.tsx`, `auth-primitives.spec.tsx`. Create `frontend/src/app/health/route.ts`. Modify proxy, globals.css, root page/layout, package/lockfile, existing demo E2E, and the frontend Compose healthcheck. Preserve `components.json` style/registries.

**Interfaces:** `createIdentityClient({baseUrl,fetch?}):IdentityApi`; `createServerIdentityClient({cookie,fetch?}):IdentityApi` uses no-store/bounded backend requests and forwards only required headers. `safeReturnPath(value:unknown):string` defaults `/workspace` and rejects cross-origin/protocol-relative paths. `transitionTenant(queryClient,next:OrganizationSummary):Promise<void>` cancels/clears old tenant state before publishing selection. `AuthCard({title,description?,children}):ReactNode` uses complete Card composition. `SessionBoundary({state,children})` with authenticated/expired/unavailable states handles authoritative401 by awaiting same-origin signout/cookie clearing before navigating to signin; it renders no tenant children while expired/unavailable. SSR must not directly redirect an invalid-cookie response into the cookie-presence proxy loop. Browser auth client is Better Auth React + twoFactor client only; no Bearer/server object import.

- [ ] **Step 1 — RED tests:** Cookie presence alone drives proxy redirects; it never decodes or calls session APIs. Reject external, protocol-relative, backslash and encoded redirect targets. Client sends only same-origin cookies and shared schemas, maps errors to safe codes, and never sets Authorization or stores tokens. SSR forwards a request's cookie and does not reuse identity across requests. A backend401 clears stale auth through signout and escapes redirect loops;503 preserves the cookie and shows unavailable. A late old-org query cannot populate the new view. Render primitives with accessible label/error linkage and design-token classes; assert no social/decorative image and no hard-coded component colors.

  Representative assertion, after arranging the case above:

  ```ts
  test('return paths cannot select another origin', async () => {
    expect(safeReturnPath('//other.example/workspace')).toBe('/workspace');
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project frontend frontend/test/identity-client.spec.tsx frontend/test/auth-proxy.spec.tsx frontend/test/tenant-queries.spec.tsx frontend/test/auth-primitives.spec.tsx`.
- [ ] **Step 3 — Implement:** Pin frontend `better-auth:1.7.14`, `input-otp:1.5.0`, helpers `clsx:2.1.1`, `tailwind-merge:3.7.0`, `class-variance-authority:0.7.1`, root dev `shadcn:4.23.0`, and root axe dev package `@axe-core/playwright:4.14.0`. From frontend use the pinned pnpm CLI to inspect context/view and add card/field/input-otp and needed dependencies, with existing-file diff review. No preset reinit, theme overwrite, Radix, `add --all` or unused variants. Map only F1-required semantic CSS variables to DS001: background/surface/raised, text `#0d0d0d`, muted `#6e6e80`, border `#e5e5e9`, primary/on-primary `#0d0d0d/#ffffff`, strong accent/focus `#5d5d6e`, danger `#b42318`, success `#1f7a3d`, radius5px, system fonts. Literal token definitions belong only in globals.css; components consume variables. Map the required shadcn aliases card/card-foreground/primary-foreground/muted/input/ring to those DS tokens rather than introducing new colors; remove obsolete demo selectors when their UI is retired. Replace root demo entry with redirects toward `/workspace`; retire obsolete demo-only UI/tests once replaced, keeping backend diagnostics/health regression coverage. Add presentation-only `GET /health` returning `{status:"ok"}` with no session/data lookup and use it for frontend container liveness, so auth-page redirects do not break health while pages arrive. Exclude health from proxy redirects; the existing frontend smoke test checks this public liveness path before Task19 adds entry UI. Do not build F2 navigation or a design-system showcase.
- [ ] **Step 4 — GREEN:** Re-run Step2, frontend build/typecheck, then existing frontend E2E adapted to the new public entry and authenticated checks. Generated files are all read and trimmed; dependency pins remain exact.
- [ ] **Step 5 — Commit:** `git commit -m "feat(frontend): add safe identity client and auth form foundations"`.

### Task 19: Scaffold login/signup blocks and complete email-based entry flows

**Research:** R06, R16–R17, R21–R22; re-read login-02/signup-02 registry files through CLI view, RHF schema wiring and current Next navigation APIs before this task.

**Files:** Create `frontend/src/app/(auth)/sign-in/page.tsx`, `sign-up/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`, `verify-email/page.tsx`, `accept-invitation/page.tsx`; `frontend/src/components/auth/login-form.tsx`, `signup-form.tsx`, `password-recovery-form.tsx`, `verification-state.tsx`, `accept-invitation.tsx`; `frontend/test/auth-entry.spec.tsx`; `frontend/test/e2e/auth-entry.spec.ts`, `invitation-entry.spec.ts`. Modify Playwright identity project matches and root layout metadata.

**Interfaces:** `LoginForm({returnTo?:string})`, `SignupForm({invitationId?:Uuid;setupToken?:string})`, `PasswordRecoveryForm({mode:'request'|'reset';token?:string})`, `VerificationState({state:'pending'|'confirmed'|'expired'})`, `AcceptInvitation({invitationId:Uuid})`. All mutations use Better Auth React for allowlisted account flows or IdentityApi for invitations; Zod schemas originate in shared.

- [ ] **Step 1 — RED tests:** Signin/signup validate before network; no social controls, social copy, decorative image or empty image column. Existing and absent email errors are indistinguishable. Browser signup→captured verification→signin reaches onboarding; email is verified before app access. Invalid/expired verification/reset links show generic safe failure and resend. Wrong credentials, disabled accounts, throttling and503 have safe English states. New invited user in invitation-only mode preserves proof/email/return path through signup+verification, then accepts; existing user signs in and accepts. Another logged-in account is rejected without invitation details. Run axe on each key auth state and verify focus/announced errors with keyboard actions.

  Representative assertion, after arranging the case above:

  ```ts
  test('chosen login block has no social entry points', async () => {
    await expect(
      page.getByRole('button', { name: /Google|GitHub|Microsoft|Apple/ }),
    ).toHaveCount(0);
    await expect(page.locator('img')).toHaveCount(0);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project frontend frontend/test/auth-entry.spec.tsx`; `pnpm test:e2e -- --project identity-browser --grep "entry|invitation"` (the project/fixture is added with these tests before implementation).
- [ ] **Step 3 — Implement:** From `frontend/`, inspect then run pinned `pnpm exec shadcn view @shadcn/login-02 @shadcn/signup-02`; add each chosen block via CLI after reviewing its page destination so root/existing pages are not silently overwritten. Place generated page/form code in the listed route/component paths. Remove all social buttons/separators/copy and decorative image/assets/layout; keep the product owner's block choice. Adapt every file to RHF/shared Zod, safe backend mutations, token classes and minimal variants. Compose recovery/verification/invitation with the same card/field pattern, no unapproved replacement blocks. Use same-origin redirects, no-store/referrer restrictions; immediately remove consumed flow credentials from visible history where possible, and never log URL/query contents.
- [ ] **Step 4 — GREEN:** Re-run Step2, frontend types/build and axe assertions. Security browser projects have trace/video/screenshots off to prevent saving passwords, codes or links; do not enable retained traces to debug them.
- [ ] **Step 5 — Commit:** `git commit -m "feat(frontend): add verified email and invitation entry pages"`.

### Task 20: Build TOTP enrollment/challenge and account security pages

**Research:** R07–R08, R16–R17, R21–R22; re-read BA challenge/enrollment responses, recovery-code lifecycle, input-otp and safe session API before this task.

**Files:** Create `frontend/src/app/(auth)/two-factor/page.tsx`, `frontend/src/app/(workspace)/account/security/page.tsx`; `frontend/src/components/auth/two-factor-challenge.tsx`, `two-factor-enrollment.tsx`, `recovery-codes.tsx`, `session-list.tsx`, `account-security.tsx`; `frontend/test/account-security.spec.tsx`; `frontend/test/e2e/account-security.spec.ts`.

**Interfaces:** `TwoFactorChallenge({returnTo?:string})`; `TwoFactorEnrollment({onComplete:()=>Promise<void>})`; `RecoveryCodes({codes:readonly string[];onDismiss:()=>void})`; `SessionList({sessions:readonly OwnSessionSummary[];onRevoke:(id:Uuid)=>Promise<void>})`. `AccountSecurity` composes own password/email/MFA/reauth/session actions without organization-admin privileges.

- [ ] **Step 1 — RED tests:** Authenticated app routes cannot be reached before challenge completion; TOTP error announces safely and focuses the control. Enrollment renders card+field+input-otp, enables only after valid verification, and supports manual authenticator setup information without a new QR library. Recovery codes show only on generation, disappear on dismissal/unmount, and are not persisted in browser storage/Query cache. Password/email changes use shared validation, require the configured recent reauth where appropriate, and show generic outcomes. Session list distinguishes Browser/Bearer by safe fields, revokes by ID, and never accesses a token. Platform admins cannot disable2FA and continue using platform functions. Axe and keyboard checks cover challenge, enrollment, recovery and session actions.

  Representative assertion, after arranging the case above:

  ```ts
  test('dismissed recovery codes leave no rendered copy', async () => {
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project frontend frontend/test/account-security.spec.tsx`; `pnpm test:e2e -- --project identity-browser --grep "security|TOTP|recovery"`.
- [ ] **Step 3 — Implement:** Compose approved primitives rather than an unavailable base-nova OTP block. Provide six-digit TOTP entry, a separate recovery-code text field, manual setup key/issuer/account instructions, and one-time recovery display. Keep secrets in component memory only, excluding persistence, telemetry and test artifacts. Use the safe Lexon session API and native client account endpoints; no frontend Bearer issuance path, trusted-device checkbox or email OTP. On session-expiry/reauth-required preserve safe return intent; never preserve password/code fields across navigation.
- [ ] **Step 4 — GREEN:** Re-run Step2 plus auth-entry tests, frontend typecheck and build. Verify form tokens, focus and axe, not only successful render.
- [ ] **Step 5 — Commit:** `git commit -m "feat(frontend): add MFA enrollment and account security"`.

### Task 21: Add onboarding, organization selection and team management pages

**Research:** R05, R16–R18, R21; re-read organization contracts, Query cancellation/keys and shared RHF form behavior before this task.

**Files:** Create `frontend/src/app/(workspace)/workspace/page.tsx`, `onboarding/page.tsx`, `organizations/[orgId]/members/page.tsx`, `organizations/[orgId]/invitations/page.tsx`, `organizations/[orgId]/settings/page.tsx`; `frontend/src/components/organizations/organization-switcher.tsx`, `onboarding.tsx`, `members.tsx`, `invitations.tsx`, `organization-settings.tsx`; `frontend/test/organizations.spec.tsx`; `frontend/test/e2e/organizations.spec.ts`.

**Interfaces:** `OrganizationSwitcher({organizations:readonly OrganizationSummary[];current:OrganizationSummary})`; `Onboarding({profile:SafeProfile;invitations:readonly InvitationSummary[]})`; members/invitations/settings components consume IdentityApi and current-org query keys, never Better Auth's organization client. Shared RHF schemas validate name/slug/invitation/role/settings input; all server permissions remain authoritative.

- [ ] **Step 1 — RED tests:** First verified signin presents display name→pending invitations→optional team creation and lands in Personal unless explicit eligible invite acceptance selects a team. Switch among Personal+two teams without changing other sessions; Personal has no rename/invite/leave controls. Removal mid-page clears old tenant data and announces loss of access before rendering Personal. A late prior-org fetch is cancelled/ignored. Owner/admin/member controls reflect role matrix, but forbidden backend responses remain handled. Last-owner leave is blocked with English instruction to promote another owner. Org2FA-required switch keeps current org while enrollment runs, and rechecks after enrollment/removal. Settings are owner-only. Axe and keyboard checks cover switcher, members/invites, role actions and settings.

  Representative assertion, after arranging the case above:

  ```ts
  test('blocked 2FA switch preserves the active workspace', async () => {
    await expect(page.getByTestId('active-organization')).toHaveText(
      'Personal',
    );
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project frontend frontend/test/organizations.spec.tsx`; `pnpm test:e2e -- --project identity-browser --grep "organization|onboarding|owner"`.
- [ ] **Step 3 — Implement:** Compose minimal card/field/list controls; use CLI-added Base UI select/table only if needed and trim variants. Display Personal label independent of internal slug. Call Lexon switch endpoint and await transitionTenant before rendering a selected workspace. Keep client checks solely UX, return-path validation shared, and pagination contract identical to backend. Add only direct links required to reach F1 pages, not an F2 sidebar or settings shell. On require2fa return use a server-held pending target, not a client-supplied tenant credential.
- [ ] **Step 4 — GREEN:** Re-run Step2, all frontend component tests and types/build; no old-organization DOM or query data after switch/fallback.
- [ ] **Step 5 — Commit:** `git commit -m "feat(frontend): add organization onboarding and management"`.

### Task 22: Add administrator setup completion and minimal platform controls

**Research:** R06–R07, R09, R16–R17, approved operator setup/provisioning rules; re-read safe setup continuation and access boundaries before this task.

**Files:** Create `frontend/src/app/(auth)/admin-setup/page.tsx`, `frontend/src/app/(workspace)/platform/provisioning/page.tsx`, `platform/provisioning/[orgId]/page.tsx`, `platform/accounts/page.tsx`; `frontend/src/components/auth/admin-setup.tsx`, `components/platform/provisioning.tsx`, `provisioning-detail.tsx`, `account-status-form.tsx`; `frontend/test/platform-identity.spec.tsx`; `frontend/test/e2e/platform-identity.spec.ts`.

**Interfaces:** `AdminSetup({setupToken:string})` redeems email-bound proof then routes through signup/signin/verification/TOTP and explicit completion. `ProvisioningList`, `ProvisioningDetail({organizationId:Uuid})` use platform-only IdentityApi. `AccountStatusForm` accepts the target user UUID and desired disabled flag, without adding a general account directory or platform role-management UI.

- [ ] **Step 1 — RED tests:** Operator email setup works in invitation-only mode but shows no active admin controls before verified email+TOTP. Existing users preserve ordinary access while setup is pending. Wrong-account/expired/reused setup links are generic failures. A fully authenticated platform admin provisions a team, sees metadata/invite status only, resends/replaces recipient or cancels; never gets a team switcher membership. First-owner browser acceptance activates the org, and canceled/replaced links fail. Disable/re-enable uses the current platform session and no impersonation capability. Axe/focus checks cover setup and platform forms. No flow credential is persisted in URL history, logs or test artifacts after consumption.

  Representative assertion, after arranging the case above:

  ```ts
  test('pending administrator setup has no platform controls', async () => {
    await expect(
      page.getByRole('button', { name: 'Provision organization' }),
    ).toHaveCount(0);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project frontend frontend/test/platform-identity.spec.tsx`; `pnpm test:e2e -- --project identity-browser --grep "platform|administrator setup"`.
- [ ] **Step 3 — Implement:** Reuse auth card/field, existing credential/MFA components and Lexon platform contracts. Do not create a web endpoint or form that starts first-admin setup, assigns arbitrary roles, auto-verifies email or bypasses MFA. Provide pending/expired provisioning states and explicit cancel confirmation. The form which disables users acts by UUID through the restricted API; no customer content links or impersonation controls. Keep all template/flow text English and error-safe.
- [ ] **Step 4 — GREEN:** Re-run Step2 plus onboarding/entry/MFA browser flows; verify no platform privilege persists if2FA is disabled or the current session revoked.
- [ ] **Step 5 — Commit:** `git commit -m "feat(frontend): add operator setup completion and provisioning controls"`.

### Task 23: Close boundary, privacy and policy regression coverage

**Research:** R04, R08–R13, R19, planning runner notes R23; re-read the installed boundary resolver, exact endpoint inventory, Stryker Vitest runner and credential artifact behavior before this task.

**Files:** Create `backend/test/integration/identity-privacy.spec.ts`, `identity-read-paths.spec.ts`; `backend/stryker.identity.config.mjs`, `vitest.identity-mutation.config.ts`. Modify `backend/package.json`, identity policy/session-evidence/invitation-policy unit tests, `scripts/eslint/resolve-import.mjs`, `scripts/test/fixtures/boundaries/cases.json`, existing runtime-composition tests and frontend E2E project options.

**Interfaces:** `pnpm --filter @lexon/backend test:mutation:identity` covers only `identity-policy.ts`, `session-evidence.ts`, `organizations/invitation-policy.ts`, using their unit suites. Target mutation break threshold80; report genuine equivalent survivors explicitly. The read-path matrix maps every new list/detail route to positive and cross-account/cross-org denial cases, with no public audit read route.

- [ ] **Step 1 — RED tests:** Send distinctive sentinel passwords, auth/correlation secrets, cookie/Bearer tokens, TOTP/recovery values, raw email/IP and links through successful, rejected, malformed and unavailable requests; assert none occurs in logs/errors/audit/artifacts. Verify unknown signins store HMAC only. Inventory every new read path and deny non-member/other-user accesses, including platform metadata limitations and Personal invisibility. Add lint fixtures denying BA server/adapter/core-context imports from frontend/add-in/shared, private DB imports from services, or auth loading through a worker/evaluation wrapper; allow `better-auth/react` and client plugins in frontend and identity module public barrels. Mutation-kill assertions cover actor-vs-target roles, role floor, consumed-invite replay, stale reauth, absent MFA and hard boundary equality.

  Representative assertion, after arranging the case above:

  ```ts
  test('captured outputs contain no credential sentinels', async () => {
    const leaked = sentinels.some((value) => capturedOutput.includes(value));
    expect(leaked).toBe(false);
  });
  ```

- [ ] **Step 2 — Confirm RED:** `pnpm exec vitest run --project backend-integration backend/test/integration/identity-privacy.spec.ts backend/test/integration/identity-read-paths.spec.ts`; `node scripts/check-boundaries.mjs`; run the new identity mutation command once and inspect initial gaps.
- [ ] **Step 3 — Implement:** Tighten boundary classifications and safe logger/response hooks only where the new negative tests expose a gap. Secret scans compare booleans/safe field names: failing assertions must not print the captured secret-bearing output or expected token. Extend tests with meaningful assertions to kill policy mutants rather than suppressing them. Keep actual SQL atomicity/concurrency proofs in integration tests; do not claim this small mutation scope covers the transaction bridge, HTTP composition or browser behavior. No screenshots/video/traces/storage-state dumps for credential flows; retain only sanitized assertion metadata. Existing F0 mutation config/results remain distinct.
- [ ] **Step 4 — GREEN:** Re-run Step2, identity unit suites and mutation command; expect zero no-coverage mutants on the new targets and≥80 score, with any equivalent survivor justified individually. Boundary fixtures and secret sentinels must pass before proceeding.
- [ ] **Step 5 — Commit:** `git commit -m "test(identity): enforce boundary privacy and policy regressions"`.

### Task 24: Complete CI, reproducible commands and F1 evidence

**Research:** R19–R20, R22–R23; re-read workflow, owned-stack cleanup, package filtering, production/test composition and final brief acceptance list before this task.

**Files:** Modify `.github/workflows/ci.yml`, `scripts/e2e.mjs`, `playwright.config.ts`, `scripts/test/e2e-cleanup.spec.mjs`, `README.md`, `backend/src/infrastructure/db/README.md`; create `backend/src/infrastructure/email/README.md`; complete `docs/references/F1-S6b-findings.md` and create `docs/references/F1-acceptance.md`. Update this plan's checkboxes only from actual completed task evidence.

**Interfaces:** `pnpm test`, per-package filtered tests and `pnpm test:e2e` continue to start their own infrastructure. Playwright projects `identity-browser` and `identity-api` join appropriate package mappings. CI keeps independent unit/integration and Compose jobs, includes F1 branch pushes/PRs, and runs the identity mutation gate in the unit/integration layer. No Mailpit or pre-started CI services. Existing exact action SHAs/toolchain remain pinned.

- [ ] **Step 1 — RED tests/checks:** Add tooling assertions that frontend/backend package filters include their identity projects, credential projects cannot retain traces or storage state, E2E cleanup runs after startup/test/abort failures, and the workflow runs both independent layers with the new mutation command. Enumerate all F1 acceptance criteria into evidence rows with an owning test/command; absence of evidence is a gap, never an assumed pass.

  Representative assertion, after arranging the case above:

  ```ts
  test('credential browser projects never retain traces', async () => {
    assert.equal(identityBrowserProject.use.trace, 'off');
    assert.equal(identityBrowserProject.use.video, 'off');
  });
  ```

- [ ] **Step 2 — Confirm RED:** `node --test scripts/test/e2e-cleanup.spec.mjs scripts/test/identity-compose.spec.mjs`; inspect the acceptance matrix against the approved design and PR14 brief.
- [ ] **Step 3 — Implement:** Update workflow/project mappings/cleanup assertions and document local `.env` setup, optional `pnpm dev --mail`, the operator `docker compose run` wrapper, invitations/MFA/Bearer policy, test capture isolation and secret-safe debugging. Document exact BA schema generation and migrations, audit grants/F17 filtering, candidate incompatibility findings and resolved fallback decision, and F18/F19/F20 deferrals. S6(b) findings include the actual native 2FA/transaction bridge tests, all four plugins, raw body, guard getSession and role/schema proof. No handover/outbox reservation or full F2 shell appears in delivery.
- [ ] **Step 4 — Full verification:** Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `node --test scripts/test/*.spec.mjs`, `pnpm --filter @lexon/backend test:mutation:identity`, and `pnpm test:e2e`. Verify filtered commands independently: `pnpm --filter @lexon/backend test`, `pnpm --filter @lexon/frontend test`, `pnpm --filter @lexon/contracts test`, and package-filtered E2E mappings. Expect all declared suites passing, axe zero violations in key states, no credentials in artifacts, clean owned-stack teardown and no runtime test-control code in production images. Record counts, meaningful limits and command/CI evidence without secrets. Repeat broad runs only after changes/failures justify them.
- [ ] **Step 5 — Commit and handoff:** `git commit -m "ci(identity): verify F1 acceptance and document operations"`. Confirm branch and clean tree. Prepare the review description from actual behavior/evidence and push the completed branch and open the authorized PR from f1-identity-organizations to main after final review; never merge or push to main. Do not mark F1 complete if any integration proof or acceptance row remains unresolved.

## Self-review and execution handoff

Before handing over this plan, check every approved-design section against a
task, every named interface against its producer, and every Review Focus item
against its test owner. Fix gaps inline. This is self-review, not another
subagent dispatch. The product owner approved this plan and subsequently selected inline/native execution,
including the clarifications and per-task push/PR process above.

Coverage map: S6/integration1; Personal/grants2; audit3; shared contracts4;
configuration/email5; limiter6; endpoint boundary7; account flows8; MFA9;
role/invariants10; tenant/switch11; invitation12; departure13; Bearer/sessions14;
provisioning/platform15; operator setup16; runtime/Compose/capture17;
frontend/client/proxy/tokens18; auth blocks/mail pages19; security pages20;
organization/onboarding21; platform/setup pages22; privacy/boundaries/mutation23;
CI/evidence24. The F18 handover and F19 renewal mechanisms are deliberately absent.

Self-review completed during plan writing: all24 task test cycles have concrete files,
interfaces, named assertions, RED/GREEN commands and commits; all five Review Focus
items have test owners. Reconciled migration order, native server-only methods,
Nodemailer bundled declarations, callback-lifetime/credential capabilities,
worker import isolation, frontend liveness during scaffolding, and audit-only
departure. No implementation or application-test result is claimed by this plan.
