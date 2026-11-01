# F1 acceptance evidence

Date: 2026-11-01. Branch: `f1-identity-organizations`. Binding design:
`docs/superpowers/specs/2026-10-31-f1-identity-organizations-design.md`.
The table maps the brief's acceptance requirements to executable evidence;
command results below distinguish local verification from CI execution.

| Requirement                                                                                                                       | Owning evidence                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup, email verification, signin, onboarding; English and axe                                                                   | `backend/test/e2e/auth-entry.spec.ts`, `organizations.spec.ts`                                                                               |
| New/existing recipient invitation, captured mail, expiry/cancellation, consumed-recipient retry, departure/foreign-account denial | `invitations`, `invitation-concurrency`, `invitation-http` integration; `invitation-entry` and `platform-identity` browser tests             |
| Invitation-only signup allows invited/setup email only                                                                            | `signup-mode` integration; platform browser scenario recreates API with signup closed and restores it in finally                             |
| Personal plus two teams, per-session selection, per-request membership                                                            | `organization-switch`, `tenant-guard`, `bearer-sessions` integration; organizations browser and identity-api Compose tests                   |
| Removal revokes access next request and repairs Personal                                                                          | `departure-audit`, `tenant-guard` integration; organizations browser removal/fallback and old-list clearance                                 |
| Concurrent last-owner leave/demotion blocked in DB                                                                                | `owner-invariant`, `membership-actions` integration with independent connections/parent fences                                               |
| Memberless provisioning, atomic first-owner activation, no staff membership, cancellation deletion                                | `provisioning`, `platform-admin`, `platform-http`, `admin-setup` integration; platform browser lifecycle                                     |
| Owner/admin/member/nonmember matrix                                                                                               | `identity-policy` unit, `membership-actions`, `invitations`, `identity-read-paths` integration                                               |
| TOTP enrollment/verify/recovery, disable reauth, organization standby, platform MFA                                               | `two-factor`, `reauthentication`, `organization-switch`, `platform-admin` integration; account-security/organizations/platform browser tests |
| Separate Bearer hard cap, protected route, foreign-org denial, own list/revoke                                                    | `bearer-sessions`, `own-sessions`, `session-http` integration; `identity-api` Compose                                                        |
| Distributed failure limits and unavailable limiter fail closed                                                                    | `auth-limiter`, `two-factor`, `identity-runtime`, `identity-privacy` integration                                                             |
| Dedicated auth role/schema, safe app projections, secret columns denied                                                           | `auth-privileges`, `personal-organization`, `migrations` integration                                                                         |
| Impersonation/native plugin HTTP denied for both channels                                                                         | `auth-http`, `session-http`, `platform-http` integration; endpoint manifest inventory                                                        |
| Transactional append-only ID audit, HMAC unknown subject, no credentials in output                                                | `audit-store`, `departure-audit`, `identity-privacy`, `admin-setup` integration; logging units and artifact/tooling checks                   |
| Cookie-presence proxy only, real guard401, expired-cookie no-loop and safe return                                                 | `frontend/test/auth-proxy`, `session-boundary`, `identity-page`; account-security and organizations browser scenarios                        |
| S6(b) exact adapter/native plugins/raw body/guard/schema proof                                                                    | `auth-compatibility`, `auth-http`, `identity-runtime`, `auth-privileges`, `two-factor`; [findings](F1-S6b-findings.md)                       |
| Atomic Personal on every account insertion including failure rollback                                                             | `personal-organization`, `account-flows`, `auth-compatibility` integration                                                                   |
| Operator-only initial/additional setup, pending idempotency, audit and activation                                                 | `admin-setup`, `admin-setup-cli` integration; platform browser setup, no web begin/role endpoint                                             |
| Four runtime health, worker no-egress, Valkey startup noeviction/AOF                                                              | runtime-health/topology Compose projects and wrong-policy rejection test                                                                     |
| Auth/SMTP do not load in workers/evaluation                                                                                       | subprocess module-load tracing in `runtime-composition` integration;78 lint boundary fixtures                                                |
| Shared tags/digests, one TS6/Zod4, exact pins                                                                                     | manifest/toolchain/boundary tests, frozen lockfile and workspace overrides                                                                   |

## Verification commands

Root checks: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`,
`pnpm test`, `node --test scripts/test/*.spec.mjs`,
`pnpm --filter @lexon/backend test:mutation:identity`, `pnpm test:e2e`.
Package checks: `pnpm --filter @lexon/backend test`, frontend/contracts equivalents,
and backend/frontend filtered `test:e2e`. Each starts its own required services;
there is no pre-started stack or default container reuse.

Local command counts are recorded below; final review findings are added after review. CI configuration runs separate unit/integration and Compose
jobs for PRs and F1 branch pushes, with the identity mutation gate in the first
job. A configured workflow is not a claim that GitHub's remote run has passed.

## Limits and deferred slices

The 100% identity mutation result covers only identity-policy, session-evidence
and invitation-policy (218 mutants). It is no proxy for SQL atomicity,
transaction bridge, HTTP composition or browser behavior. Those have separate
real integration/concurrency and Compose proofs listed above.

SMTP delivery is post-commit and process-memory, not durable. Delivery failure
never rolls back committed authorization; resend/operator retry recovers pending
links. No departure outbox rows/dispatcher metadata exist; F18 designs handover.
F19 owns add-in renewal UX. F20 owns frontend no-egress via Caddy/host firewall;
development edge remains host-accessible, frontend stays off core/free of backend
secrets. F2 owns shell/navigation/full design system. Audit views in F17 must use
the authorization predicate builder because ops has no tenant RLS.

Credential tests disable trace/video/screenshots/storage-state dumps and automatic
page snapshots; secret scans assert booleans without printing sentinels. API mail
capture and privileged operator composition are test-only bind mounts, absent from
production images. Temporary operator configuration is private and removed on
startup/test/abort/cleanup failures. No customer product code or research branch
was used.

## Local gates observed

- Root lint (78 boundary fixtures), format, typecheck and build passed.
- `pnpm test`:89 files,324 tests passed.
- Backend package test:73 files,271 tests passed; frontend:11 files,21 tests passed; contracts:4 files,31 tests passed.
- Tooling:89 tests passed, including isolation, manifest, boundaries and cleanup.
- Identity mutation:218/218 killed,100%, no survivors/timeouts/no-coverage.
- Filtered frontend Compose:12 scenarios passed. Filtered backend Compose:9 scenarios passed, including real wrong-policy rejection/recovery. Final full Compose:22/22 scenarios passed; owned-stack teardown left zero lexon-e2e containers.
