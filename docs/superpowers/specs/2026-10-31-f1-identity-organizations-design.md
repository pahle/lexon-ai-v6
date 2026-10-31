# F1 — Identity and Organizations design

Status: approved by the product owner, including the amendments below; builder check completed.
Date: 2026-10-31.
Branch: `f1-identity-organizations`; do not commit to `main`.
Input: [F1 brief](../../briefs/F1-identity-organizations.md), including the
product-owner decisions recorded below. Source priority remains LEX-TS-001,
LEX-ARC-001, LEX-DS-001, brief, then this design.

## Intent and scope

F1 establishes verified identity and organization selection for every later
slice. People can register or accept invitations, use their private Personal
workspace, belong to multiple teams, and manage their account security. A
server-verified session determines the organization for every protected request.
No client-supplied tenant identifier can replace that context.

This is a full project within one feature slice. It completes S6(b), adds the
Identity & Access, Organizations, and minimal Audit domains, and supplies minimal
accessible pages. Success means the state and permission guarantees survive
concurrency, retries, expired credentials, removal, and dependency outages.

Non-goals: social login/SSO, F2's shell and design-system buildout, F6 project
permissions/ethical walls, F17 audit views/exports and quotas, F18 content
handover/deletion, F19 Word UI and renewal, and F20 production SMTP/Caddy/TLS.
Keep the F0 frontend network gap deferred to F20. Do not load Better Auth or
SMTP credentials into the frontend, workers, or dispatcher.

Anti-goals: a second membership model, cached authorization that postpones
removal, an ownerless active team, an observable account without Personal,
platform staff gaining team membership through provisioning, or an unguarded
plugin endpoint providing an alternate mutation path.

## Approaches and selected direction

1. **Extend the default Better Auth organization HTTP API.** Use stock client
   operations and enforce Lexon behavior through hooks and database constraints.
   Less application API code, but policy is spread across many plugin routes,
   and defaults differ from Lexon's invitation, personal, and provisioning rules.
2. **Better Auth plus a controlled Lexon organization API — selected by the
   product owner.** Better Auth retains identity storage and authentication.
   Lexon services apply one policy and coordinate server-side `auth.api.*`
   calls in real adapter transactions. The frontend uses shared Lexon contracts.
   More explicit orchestration, but a single public organization policy surface.

Required constraints on the selected approach:

- `auth.user`, `auth.organization`, `auth.member`, `auth.invitation`, and
  `auth.session` remain authoritative. No shadow organizations or memberships.
- Organization services call Better Auth's server API. No application-written
  SQL reads or mutations of auth tables. Database exceptions are versioned,
  migrator-owned constraints/triggers and narrowly scoped `SECURITY DEFINER`
  functions. Migration and privileged integration-test assertions may use SQL.
- All organization-plugin HTTP routes are denied. Other auth HTTP access is an
  explicit method/path allowlist, rather than a list of known dangerous routes.
- The database enforces atomic Personal creation and concurrent owner safety.
- The initial administrator is established by an operator-only setup command.

## Product-owner decisions incorporated

1. User-created teams start `active` with their creator as owner.
2. A platform-created team starts `provisioning`, with exactly one current owner
   invitation, no members, no content, and no user visibility or switchability.
   Admins can inspect provisioning metadata/status, resend, replace the recipient,
   or cancel and delete it. Expiry leaves it provisioning. Verified acceptance
   creates the owner and activates the team atomically. Staff never become members.
3. An accepted invitation retries successfully for its original recipient while
   membership exists, without changing membership or role. A consumed invitation
   cannot restore membership after departure. Another account is always rejected.
4. Bearer sessions are separate server-side sessions, with configurable hard
   expiry, default 15 minutes, no extension, and immediate revocation. Issuance
   follows full authentication including enabled 2FA. The same tenant guard and
   organization policy apply. They appear in the user's session list. Web UI
   authentication uses cookies exclusively. Renewal belongs to F19.
5. Open question 1: use `ops.audit_events`, with the restricted writer function,
   field rules, correlation HMAC, and F17 constraint specified below.
6. Open question 3: development-only Mailpit, optional Compose profile, exact tag
   and digest in the shared image manifest, loopback inbox, private SMTP,
   ephemeral messages, no relay/forwarding. Tests retain in-process transport.
   Mailpit is not part of production images or ordinary CI E2E.
7. Personal is created in the account transaction at database level. A forced
   failure after insertion must leave neither a user nor an organization.
8. The operator setup command sends a setup link for an email, permits that email
   to register in invitation-only mode, and activates admin rights only after
   verified email and enrolled 2FA. It refuses if an administrator already exists
   unless `--additional` is explicit, is idempotent while pending, and audits
   every invocation. No bootstrap web endpoint or environment allowlist.
9. Departure is recorded only as an ID-only audit event in `ops.audit_events`,
   in the membership-change transaction. No departure rows in `ops.outbox`,
   outbox dispatch metadata, dispatcher changes, or auth-role outbox writer.
   F18 designs its own handover mechanism (brief PR #14).

The repository already includes the brief corrections through PRs #10, #11,
and #13–#14 and the Mailpit stack addition in PR #12. Session and audit decisions
above are authoritative conversation amendments where the brief remains terse.

## Architecture and storage boundary

`identity-access` owns Better Auth integration, session resolution, account
security, the global API guard, and the public identity policy service.
`organizations` owns the Lexon controllers and organization orchestration.
`audit` owns the event contract and append interface, without read controllers.
Modules use public `index.ts` exports. Business modules never receive a pool,
Drizzle connection, unrestricted adapter, or Better Auth secret context.

The database infrastructure creates the private auth-role pool and Drizzle
adapter; its integration exposes only the capabilities needed to compose Better
Auth and run authenticated server commands. The Better Auth object needed by
the Nest adapter is an infrastructure composition detail, not a public domain
API. The existing application-role pool and `withTenant` stay separate.

Use Better Auth 1.7.14 and the matching core/Drizzle adapter, with
`@thallesp/nestjs-better-auth` 2.8.0 as the researched candidates. Pin exactly at
implementation, retaining the existing TypeScript 6.0.3, Zod 4.6.7, Drizzle
0.45.4, NestJS 12.3.2, and other F0 pins. Do not upgrade the workspace incidentally.

Configure the Drizzle adapter with `provider: 'pg'`, `schemaName: 'auth'`, the
explicit generated schema, and `transaction: true`. Use UUID identity columns
and UUID generation consistently with F0. Generate the schema from the exact
Better Auth configuration and commit versioned SQL, including manual database
invariants and grants, under `backend/drizzle/`. Never run schema push.

### Additional fields and records — open question 2

Design decision: use Better Auth additional fields for scalar extensions on
its existing organization, invitation, session, and user records. This is
supported by the researched version and avoids unnecessary joins or a second
policy store. Mark security-owned fields `input: false`; database defaults and
checks enforce required values independently of JavaScript defaults.

| Record       | Lexon extension and purpose                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization | `kind: personal \| team`, `state: provisioning \| active`, `require2fa`; an immutable personal-owner user reference for uniqueness/protection                                     |
| Invitation   | Accepted-recipient user ID, purpose (`team` or `first_owner`), and lifecycle metadata needed for recipient binding and resend/replacement                                         |
| Session      | Channel (`cookie` or `bearer`), immutable hard-expiry for Bearer, server-owned authentication/reauthentication evidence, and optional pending organization selection              |
| User         | Onboarding completion and pending administrator activation, where cleanly represented as server-owned fields; the Admin plugin remains the authority for active platform role/ban |
| Setup grant  | An auth-schema record for the operator setup email, token digest, expiry, and pending/consumed lifecycle; no parallel user or membership                                          |
| Audit        | The append-only `ops.audit_events` record described below                                                                                                                         |

Preserve native plugin status spellings in storage where appropriate: map
`rejected` to public `declined` and `canceled` to public `cancelled`. Public
`expired` is derived from pending status plus expiry; expired invitations never
remain actionable merely because no cleanup process has run. Add no redundant
invitation-state history table unless the generated schema lacks information
needed for the specified lifecycle; the audit is already the event history.

## Transactions and database guarantees

### Adapter transaction coordination

Use the pinned public `runWithTransaction` export from `@better-auth/core/context`
behind a private integration facade. Its declared contract joins an existing
transaction; the pinned organization adapter obtains the current adapter for
its operations. This can coordinate a sequence of server `auth.api.*` calls.
An unrelated application-pool transaction cannot contain those calls.

S6(b) must prove real PostgreSQL rollback across multiple server API calls and
isolation between concurrent requests before this becomes an implementation
assumption. Do not import private package paths, monkey-patch package code,
reimplement password checks, or substitute compensating writes for atomicity.

Where stock endpoints cannot express an approved operation, expose a small
internal Better Auth server-plugin API, still invoked as `auth.api.*` by Lexon
services. Examples are memberless provisioning and invitation acceptance for
an already-existing member. The extension uses the supported Better Auth
adapter/context APIs and the same transaction, tables, constraints, and policy.
It is not a second membership implementation or a separately reachable HTTP
surface. Any database-specific primitive is a reviewed migrator-owned narrow
function. If the supported API cannot satisfy this boundary, report the concrete
incompatibility before planning a workaround.

Do authorization reads, invariant checks, and changes in the same command
transaction. Database locking must cover the actor's membership/role as well as
the target, so a concurrent demotion/removal cannot authorize a later mutation
using an obsolete role. Use narrow database primitives where the generic adapter
cannot express a lock. Recheck relevant state after locking.

### Personal invariant

A migrator-owned trigger on user insertion creates the hidden Personal
organization and its sole owner membership in the same transaction. It has a
fixed safe `search_path`, qualified object references, and no public executable
general-purpose mutation interface. A unique owner reference guarantees one
Personal per user. Deferred checks validate the final user/organization/member
relationship and forbid extra members, invitations, conversion to team,
renaming, leaving, role changes, or normal deletion.

Both runtime and future account-creation paths receive the invariant, including
operator-setup signup. Failure during user creation, Personal creation,
membership insertion, or a later credential step rolls back the complete
operation. Test rollback via the actual configured Better Auth signup API, plus
a second connection proving no partial state is visible. F18 will add a narrow
coordinated deletion path; F1 does not disable the invariant for ordinary callers.

### Team invariants

Serialize membership and state mutations on the organization row using database
locking in the same transaction, with a final deferred constraint check. Do not
use an unlocked `COUNT(owner)` check. For every committed `active` team there
must be at least one owner. Concurrent leave/demote/removal operations must leave
one owner or roll back one contender. Test with independent connections and
barriers. Lock ordering is deterministic; bounded deadlock/serialization retries
re-run policy checks and must not duplicate audit or departures.

At commit a provisioning team has no members and exactly one current
`first_owner` invitation, including an expired one awaiting admin action.
Accepted invitation plus first owner plus `active` state commit together.
No ordinary membership operation can activate provisioning or add its members.
Cancellation deletes provisioning metadata and invitations atomically, with a
durable audit record not cascade-deleted with the organization.

Enforce unique `(organizationId, userId)` memberships and at most one pending
invitation per organization and normalized email. Expiry is checked on every
action; reinvitation retires an expired record before creating the new pending
one. Normalize emails according to Better Auth's email identity rules, without
provider-specific alias folding. Bind consumed invitations to the accepting
user ID, not just a changeable email address.

## Authentication, sessions, and the guard

Mount Better Auth at `/api/auth/*` using the community adapter in the API runtime
only. Disable Nest's automatic body parser and let the integration preserve the
auth body while supplying bounded JSON parsing for other API routes. Keep F0's
request IDs, safe validation errors, logging, and health behavior. Verify that
the global `/api` prefix does not duplicate the auth base path. Adapter fallback
to `toNodeHandler` is allowed only after a demonstrated incompatibility, recorded
in S6(b), not as a convenience choice.

Require a minimum 12-character password, verified email before application
access, expiring verification/reset links, and generic signup/reset responses.
Keep Better Auth's existing-account synthetic response indistinguishable after
adding plugin/additional fields. No sessions are issued at signup or automatic
email verification. Password change requires current password and always revokes
other sessions; password reset revokes all sessions. New email must be verified
before becoming authoritative. Apply recent reauthentication to sensitive
security changes, including disabling 2FA and regenerating recovery codes.

Use TOTP and single-use recovery codes only. Disable OTP-by-email and trusted
device bypass for F1. TOTP enrollment becomes effective only after verification.
Never infer that a session completed MFA merely because the user now has
`twoFactorEnabled`. Sessions pre-dating enrollment need verified session-level
evidence or a fresh complete sign-in before MFA-required access or token issuance.
Platform-admin rights require verified email and enrolled, verified 2FA; all
platform-admin application access also requires MFA-complete session evidence.
An admin cannot disable 2FA and retain operational admin access.

### Session classes

Design defaults, proposed for review: cookie sessions expire after seven days,
refresh at most once per day, and sensitive actions need reauthentication within
five minutes. All durations are configuration values validated at boot. Cookies
are HttpOnly, SameSite=Lax, scoped to the public origin, and Secure except explicit
local development. No session cookie cache or secondary-storage session cache.
PostgreSQL remains authoritative for session validity and revocation.

Bearer sessions are separate rows with a fixed hard expiry, default 900 seconds.
Issue through a narrowly scoped server-plugin API after a valid fully
authenticated **cookie** source session, rechecking verified email and MFA evidence.
Issuance creates its own active-organization selection from a validated
membership. It does not extend or convert the source cookie session. F1 supplies
the API proof, not the Word dialog, refresh tokens, or renewal UI.
Bearer-to-Bearer issuance is denied: a hard-expiry token cannot mint its own
replacement in F1. The web application never calls the issuance endpoint; a
fully authenticated cookie flow is its server-side prerequisite for later F19
handoff and the F1 API proof.

Enforce session channel on every auth and application entry path: a browser
session token cannot be replayed as a long-lived Bearer credential, and a Bearer
session cannot become a cookie session. Reject ambiguous combined credentials.
The hard limit survives native get-session refresh, 2FA operations, and updates;
database enforcement prevents extending it. Expiry/revocation takes effect on
the next request without cached grace periods.

The web never stores, sends, or uses Bearer tokens. Sanitize cookie-auth responses
so native `set-auth-token` headers and token-bearing session fields do not leak
through. Token material is returned only by the explicit Bearer issuance flow.
Never include tokens in URLs, errors, audit, traces, logs, analytics, or session
lists. Use a Lexon session list/revoke API with session IDs and safe labels;
server-side Better Auth integration resolves whatever native operation is needed.

### Guard stages and public exceptions

The global guard resolves one credential through Better Auth, checks session
channel/expiry/revocation and account enabled state, requires verified email,
and validates session-level MFA requirements. It derives the active organization
server-side, re-verifies membership and current role on every request, checks
organization state/2FA policy, then exposes `{orgId, userId, role}`. Controllers
pass this context explicitly to F0 `withTenant`. Do not introduce implicit tenant
state through AsyncLocalStorage; Better Auth's adapter transaction context is
separate from Lexon's explicit tenant context.

An absent/invalid/removed active membership is repaired to Personal on the same
session through the trusted server API, using compare/recheck semantics so a
concurrent explicit switch is not overwritten. Return a safe fallback reason;
the UI clears prior tenant data before rendering Personal. Other sessions keep
their own selection until their next request detects invalid membership.

The active organization comes from the session; resource routes cannot override
it via headers/body/query. An organization ID is allowed only as the explicit
target of a management/switch command, whose policy rechecks the caller's
membership in that target. Platform provisioning commands use the separate
platform capability; platform role never satisfies team membership checks.

Public API routes: F0 liveness/readiness, the allowlisted unauthenticated auth
flows, and setup/invitation landing metadata limited to what the flow needs.
No invitation details or pending-invitation list is disclosed before verified
recipient authentication. Profile, security/enrollment, and pending-invitation
routes are authenticated but may be explicitly exempt from full workspace/MFA
entry checks to let a user satisfy them. Exemption never permits tenant content
or platform operations. F0 diagnostic/version endpoints become authenticated
unless a documented health dependency requires a smaller public projection.

## HTTP surface

Maintain a checked-in method/path manifest. Auth HTTP middleware checks the
canonical decoded path and method before invoking Better Auth, rejecting unknown
routes consistently, including encoded separators, method variations, and
trailing-slash aliases. Do not trust a client header to mark an internal call.
Internal `auth.api.*` calls are not HTTP requests and must remain callable behind
Lexon policy even when their native HTTP route is denied.

### Standard auth HTTP allowlist

Paths below are relative to `/api/auth`. Policy-qualified means the session,
channel, rate limits, reauthentication, field restrictions, and safe-output rules
above apply in addition to Better Auth's checks.

| Method | Path                                                        | Access                                                               |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/sign-up/email`                                            | Public, open signup or valid invited/setup email                     |
| POST   | `/sign-in/email`                                            | Public credential flow, MFA challenge where enabled                  |
| POST   | `/send-verification-email`                                  | Public generic response, rate limited                                |
| GET    | `/verify-email`                                             | Expiring verification link                                           |
| POST   | `/request-password-reset`                                   | Public generic response, rate limited                                |
| GET    | `/reset-password/:token`                                    | Native reset callback; sanitized logging and callback destination    |
| POST   | `/reset-password`                                           | Expiring reset token                                                 |
| POST   | `/sign-out`                                                 | Current session only                                                 |
| GET    | `/get-session`                                              | Safe session projection; no token material or stale authorization    |
| POST   | `/revoke-sessions`, `/revoke-other-sessions`                | Policy-qualified own sessions                                        |
| POST   | `/update-user`                                              | Own display name only, shared contract                               |
| POST   | `/change-password`, `/change-email`                         | Policy-qualified own account                                         |
| POST   | `/two-factor/enable`, `/two-factor/get-totp-uri`            | Own TOTP enrollment, password/reauth checks                          |
| POST   | `/two-factor/verify-totp`, `/two-factor/verify-backup-code` | Own enrollment or pending sign-in challenge, never arbitrary user ID |
| POST   | `/two-factor/disable`, `/two-factor/generate-backup-codes`  | Recent reauth; admin requirements still apply                        |

Planning verification: the pinned native `verifyPassword` method is server-only,
so `/verify-password` is not an HTTP exception. Reauthentication calls it
internally through the Lexon security endpoint; native session freshness checks
are not forged or disabled. This narrows the earlier proposed HTTP list without
removing any approved account capability.

The stock Bearer plugin has no separate token-issuance HTTP endpoint. A Lexon
issuance endpoint invokes the internal server-plugin API and returns the
dedicated Bearer session credential under the full-authentication rules above.

Stock `/list-sessions` and `/revoke-session` stay HTTP-denied because their native
contracts contain tokens; Lexon's ID-based session endpoints replace them.
All `/organization/*`, `/admin/*`, impersonation, user deletion, arbitrary
session-field update, social/OAuth, email-OTP, trusted-device bypass, recovery-code
viewing by arbitrary user ID, and every unlisted endpoint stay denied. Also remove
impersonation permissions from Admin-plugin access control and reject internal
impersonation calls: HTTP denial alone is insufficient.

Test the complete actual endpoint inventory of the pinned configuration against
this allowlist. Every excluded endpoint must be unreachable with both cookie
and Bearer credentials. Newly added endpoints default to denied, never inherited
through a wildcard. Tests also exercise service-side policy checks independently
of the HTTP filter.

### Lexon API and shared contracts

Publish versioned Zod contracts in `shared/` for authentication forms, safe
identity/session summaries, profile/onboarding, organizations/members/invitations,
switch results, pagination, security transitions, and stable `AUTH_*`, `ORG_*`,
and `INVITATION_*` errors. Do not import backend types into the frontend.

The Lexon surface includes own identity/profile/onboarding; own session list and
ID-based revocation; Bearer issuance; organization list/create/switch; current
team settings/members/roles/departure; recipient invitation list/accept/decline;
and team invitation list/create/resend/cancel. Platform routes cover provisioning
list/detail/create/resend/replace/cancel and user disable/re-enable only. No
general platform-admin creation or promotion web API in F1.

Successful switches return the safe authoritative organization summary. Denials
use stable codes such as `ORG_MEMBERSHIP_REQUIRED`, `ORG_LAST_OWNER`,
`AUTH_2FA_REQUIRED`, and `INVITATION_UNAVAILABLE`, without leaking other users,
organizations, secrets, or plugin exceptions. Final URL nouns and error-code
enumerations are builder choices, but the allowlist must be concrete in the plan.

## Organization and invitation behavior

Personal is always present in the authenticated user's switcher as “Personal”
and never in another user's organization responses. It cannot be renamed or
targeted by team/member/invitation operations. User team creation keeps the
existing active organization until an explicit switch; first self-serve
onboarding lands in Personal, as specified by the brief.

| Action                          | Owner                                       | Admin                               | Member/non-member         |
| ------------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------- |
| Invite member                   | Yes                                         | Yes                                 | No                        |
| Invite admin                    | Yes                                         | No                                  | No                        |
| Invite owner                    | No; provisioning exception is platform-only | No                                  | No                        |
| Change member/admin roles       | Yes                                         | Only member ↔ admin, never an owner | No                        |
| Promote/demote owner            | Yes, preserving an owner                    | No                                  | No                        |
| Remove member                   | Yes, preserving an owner                    | Members only                        | No                        |
| Leave                           | If another owner remains                    | Yes                                 | Member yes; non-member no |
| Rename/slug/settings/require2fa | Yes                                         | No                                  | No                        |

Owners can administer owners subject to the final-owner constraint. Role
decisions use the current actor and target roles. A platform admin acting as
platform staff gets none of these team privileges. Ordinary self-owned Personal
is not a grant to customer teams.

Normal invitations use member/admin roles, default member, and default expiry
14 days validated from configuration. Admins may list/resend/cancel pending
invitations; creating an admin invitation still requires an owner. Resending
must not let an admin change its role or recipient. Replace-recipient is a
platform-provisioning operation, not a silent mutation of a team invitation.

Invitation-only signup requires a still-valid invitation or operator setup
grant for the submitted normalized email; supply proof of the link/grant rather
than exposing an “is this email invited?” lookup. Signup eligibility alone
grants no membership or platform role. Verification and acceptance remain
separate, with the invite rechecked after verification.

Acceptance serializes on the invitation and organization. Validate verified
email and recipient identity. First acceptance creates membership or applies
the higher of current and invited roles, consumes the invitation, records its
recipient ID, and audits the transition atomically. A consumed retry by that
user with an extant membership returns success without role change, new
membership, duplicate lifecycle event, or implicit restoration. Another account,
missing membership, pending expiry, cancellation, or decline is rejected.

Design proposal: if the target requires 2FA and the recipient has not enrolled,
acceptance may establish membership but keeps the current active organization
unchanged; return enrollment-required with a server-held pending target. After
verified enrollment, recheck membership/state/policy and switch. A normal switch
to such a team similarly keeps the old active organization until requirements
are met. No target content can be read in the meantime.

Departure removes membership and writes only the ID-only
`organization.member_departed.v1` audit event to `ops.audit_events` in the same
transaction. The record identifies the organization, departing user, actor,
and membership, with a timestamp and fixed leave/remove reason under the audit
field rules. A rollback leaves neither a successful departure nor its audit.
F1 writes no departure rows to `ops.outbox`, adds no dispatch metadata, changes
no dispatcher behavior, and creates no auth-role function that writes to the
outbox. F18 designs its own handover mechanism.

## Operator administrator setup

Provide a documented backend one-shot command usable through `docker compose
run --rm …`, taking email and optional `--additional`. It has no HTTP listener.
It uses a narrowly authorized operator provisioning capability; ordinary API
runtime credentials cannot initiate setup through a public route or service.
Operator credential provisioning and storage follow the existing setup/migrator
separation, never adding migrator credentials to the long-running API container.

Serialize setup admission against admin activation and other setup invocations.
Without `--additional`, refuse an existing active administrator and prevent
concurrent initial setups from creating multiple independent first admins.
Repeat calls for the same pending setup reuse its identity; an expired link can
be reissued without duplicate grants. Every admitted, repeated, and refused run
writes a bounded audit result, using the email HMAC when no user exists.

Design defaults: a setup link expires after 24 hours and is single-use for
activation; duration is boot-validated configuration. Store a digest, never the
raw token. Send a link through Nodemailer without printing it. Link processing
authorizes setup-email registration but cannot assign a role based on a body
field. Existing-account recipients must authenticate that verified account;
setup cannot reset their password or bypass an existing second factor.

After signup/password establishment, email verification, and verified TOTP
enrollment, atomically activate the Admin-plugin role and consume the setup
grant. Until then the person can complete the necessary setup/security steps
without platform actions. Sending or redeeming setup for an existing account
does not disable ordinary user access or change its active organization;
ordinary email, session, membership, and organization-2FA checks still apply.
A new account likewise has its ordinary Personal membership, but no platform
capability before activation. After activation, a session must prove MFA before
admin use.
Additional administrators use this same command with `--additional`; a web
administration flow for creating administrators is deferred.

## Audit and privacy

`ops.audit_events` is migrator-owned, append-only, without tenant RLS. Fields
are event ID/version/type, timestamp, outcome, actor/subject/session/invitation
and optional organization IDs as applicable, request correlation ID, and a
strictly event-specific metadata shape. Do not accept arbitrary JSON keys,
free text, URLs, plugin error messages, names, emails, IPs, user agents,
passwords, tokens, TOTP seeds, or recovery codes. IDs do not justify a read API.

For failed sign-in to an unknown account, store only a domain-separated HMAC
of Better Auth-normalized email, using a separate backend correlation secret
and a key/version identifier. Plain hashes and raw email/IP correlation are
forbidden. Known subjects use user IDs. The secret is not the auth signing key,
is not in migrations, and is never returned to the frontend.

`lexon_app` may INSERT directly. `lexon_auth` gets no table privileges on `ops`.
One narrowly defined audit-writer `SECURITY DEFINER` function validates event
type and metadata keys/types, has a fixed safe `search_path`, and allows EXECUTE
only to `lexon_auth` and `lexon_app`; revoke PUBLIC execution. It can live in
`auth` so auth callers do not need general `ops` schema access. Better Auth
hooks call this function through the private integration. No runtime role may
UPDATE, DELETE, or TRUNCATE audit, including through inherited/default grants.
No default runtime SELECT; privileged tests may inspect it. Future views obtain
only the grants they need.

Record sign-in success/failure, verified 2FA/security changes, password/email
changes, session revocations, organization creation and provisioning transitions,
invitation transitions, role changes, departure, disable/re-enable, and every
operator setup run. Pending 2FA challenge is not sign-in success. Record security
mutation success with the durable state change where possible through triggers
or the transaction-bound writer; do not claim an after-commit hook can roll
back a completed operation. Endpoint hooks handle attempt/outcome events that
have no state mutation. If recording a mandatory mutation audit fails, the
mutation fails/rolls back. A failure event must not be rolled back alongside
the failed attempt it describes. Do not log audit-write payloads on failure.

F17 constraint: any organization-scoped audit view/export must apply the central
authorization predicate builder; `ops` has no tenant RLS. Platform status alone
does not confer access to customer audit detail. Audit views/exports are absent
from F1.

Sanitize Better Auth's own logger and middleware error/response paths, not just
Nest controller errors. Redact authorization/cookies/token response headers and
strip secret query/path values from request logging. Verification, reset,
invitation, and setup links may contain their intended flow credentials, but
never Bearer tokens; they must not reach telemetry, referrers, or error reports.
Use no-store responses and restrictive referrer behavior on security/link pages.
Sentinel tests inspect logs, errors, audit, and generated test artifacts.

## Limiting and email

Use `rate-limiter-flexible` on F0's `VALKEY_LIMITER_URL` connection, per-use `rl:`
prefixes and TTLs, with atomic counters for IP and account across signup, signin,
2FA verification/recovery, resets, verification resend, setup redemption, and
Bearer issuance. Derive account keys without raw emails. Apply the limiter before
dispatch, including Lexon endpoints calling `auth.api.*`: native server calls
do not receive Better Auth's HTTP limiter automatically.

Fail closed on bounded store errors, exhaustion, timeouts, or disconnection:
429 for a reached limit, safe 503 for unavailable enforcement. No in-memory
insurance fallback for auth. Configure the client not to queue auth operations
indefinitely or retry past the request budget. Other endpoint policies remain
LEX-ARC-001 §5.4. Use the socket peer in local/direct mode; forwarded IP headers
are accepted only from explicitly configured trusted proxy hops. F20 supplies
production Caddy forwarding rules. Do not trust arbitrary client X-Forwarded-For.

Use Nodemailer SMTP with English verification/reset/invitation/email-change and
2FA/security-notice templates, escaping supplied display names and validating
absolute same-origin callback destinations. Tests use Nodemailer's stream/JSON
transport in process, asserting recipient, content, expiry and action links.
Account-enumeration-sensitive responses do not wait on variable SMTP latency.
Keep delivery promises tracked and failures safe; resends must recover from a
post-commit delivery failure without falsely rolling back an account or invite.
Durable SMTP retry machinery is not added speculatively in F1.

Mailpit is a separate optional dev-profile service. Candidate v1.33.0 must be
pinned by exact tag and registry digest in the existing shared image manifest
when planned. Attach private SMTP only where the API can reach it; publish only
the inbox UI to loopback. Use ephemeral storage and no relay/forwarding options.
It is absent from runtime images and the normal CI E2E profile. No logging of
full mail content/links in ordinary dev mode; message IDs and safe outcomes only.

## Frontend behavior

Use existing React 19, Next.js 16, Base UI/shadcn `base-nova`, React Hook Form,
shared Zod contracts, and TanStack Query. No app shell work or chat scaffolding.
Pages are restrained forms and tables using LEX-DS-001 tokens, system fonts,
keyboard navigation, labelled controls, announced errors, and explicit focus
management for 2FA/invitations. The visual companion was offered and declined.

### Required scaffolding and adaptation

Product-owner amendment: use the shadcn CLI and the official shadcn registry
with the existing `base-nova` style. Start sign-in from `login-02` and sign-up
from `signup-02`; both registry blocks were verified to exist for this style.
Do not replace them with another block, style, or hand-written initial scaffold.
Remove every generated social-login button, social-login separator/copy, and
decorative image, including unused image assets and layout space. Social login
is outside the MVP.

There is no selected base-nova OTP block. Compose the 2FA challenge and enrollment
from `card`, `field`, and `input-otp`. Enrollment still needs the authenticator
setup information and recovery-code behavior described above; the input primitive
does not replace those steps. Compose forgot/reset password, email verification,
and invitation acceptance from the same card/field pattern.

Use the `shadcn` skill's inspect/view/add workflow through the project's pnpm
runner, from `frontend/`, after design and plan approval. Keep the existing
`components.json` configuration and assistant-ui registry. Inspect generated
files and dependencies rather than overwriting existing routes, tokens, or
components blindly. The plan must pin the CLI and any new dependency, including
the `input-otp` dependency, exactly and preserve the TypeScript/Zod singleton
rules. CLI generation is implementation and follows the repository's TDD rule.

Every generated file becomes owned application code and must be adapted:

- Replace demonstration form behavior with React Hook Form and versioned Zod
  schemas imported from `shared/`.
- Use English copy and generic authentication errors that never reveal whether
  an email exists, including server error mappings and resend/reset outcomes.
- Use LEX-DS-001 tokens only, with no hard-coded colors, decorative imagery,
  preset typography/font imports, or incidental shell/navigation scaffolding.
- Preserve keyboard operation, associated labels, announced validation errors,
  and focus management; key pages must pass axe checks.
- Keep components minimal, remove unused variants and dead generated code,
  and remove unused imports, assets, and dependencies.

The app shell, navigation, and full design system remain in F2. Adding these
blocks does not authorize a general component-library or preset refresh.

`(auth)` includes signup/signin, TOTP/recovery challenge, verification pending/
confirmed/expired with resend, forgot/reset password, invitation acceptance,
and administrator setup landing. Verified first signin leads through display
name, pending invitations, then optional team creation. Self-serve completion
lands in Personal; explicit invitation acceptance can select its eligible team.

`(workspace)` includes a minimal landing/switcher, account security, members,
invitations, and owner settings. Platform admins have only the minimal
provisioning and account-disable surfaces required by the brief; no customer
content view. Pending admin setup has a dedicated completion view, restricted
to setup actions without suspending ordinary account access.
Recovery codes are shown only when generated, with a clear save-once prompt.
Session lists distinguish browser/Bearer sessions using safe metadata and IDs.

`proxy.ts` checks cookie presence only. It redirects visitors from workspace to
signin with a validated relative return path and signed-in cookie holders from
signin/signup to the app. It never decodes or validates sessions. Handle stale
cookie redirects without a loop: an authoritative backend 401 clears the cookie
through the auth boundary/signout and directs to signin. Never clear cookies
merely because a dependency returned 503. Setup/security/invitation continuation
URLs must survive required authentication without an external open redirect.

All requests use the public same-origin `/api` boundary. SSR forwards only the
required cookie/request context to the backend and does not cache personalized
responses across users. Better Auth React client handles allowlisted account
flows; the Lexon client handles organizations and safe session management.
On switch/fallback/signout, cancel outstanding tenant requests and clear tenant
query state before publishing the new organization. Query keys include the
resolved organization, and late old responses cannot repopulate the new view.

## Verification and acceptance evidence

Retain F0's independently runnable `pnpm test` and filtered package commands:
Testcontainers once per run in global setup, each file with a cloned migrated
database and isolated Valkey prefix/S3 bucket, shared pinned images, no default
reuse and none in CI. New auth-schema/template migrations participate in that
same setup. Run focused unit tests first and real integration tests for the
security/database properties; mocks cannot prove rollback, grants or locking.

| Area                | Required evidence                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6(b)               | Actual NestJS 12 ESM boot, cookie + Bearer, all four plugins, guard `getSession`, auth raw body and ordinary JSON coexistence, auth-schema tables and role, multi-API-call rollback                                                                |
| Personal            | Signup rollback after user insert leaves no user/org/member; second connection sees no partial state; one hidden Personal and no mutation/invite escape                                                                                            |
| Provisioning/setup  | Memberless invisible provisioning, activation rollback/concurrency, recipient replacement invalidates old link, cancel deletes; no staff membership; setup CLI idempotency/refusal/`--additional`, audit every run, no rights before verified TOTP |
| Roles               | Every actor/target combination; concurrent actor demotion, final-owner leave/demote/remove, database-level checks, non-member denials                                                                                                              |
| Invitations         | Verified recipient only; role floor on first accept; same-user retry no effects; another account denied; removed-member replay denied; expired/cancelled/declined denied; concurrent acceptance and resend                                         |
| Tenant guard        | Multi-session switches independent, membership read per request, removal fallback next request, no client tenant override, inactive provisioning denied, both credential channels                                                                  |
| Session security    | Full MFA before token issuance, no credential channel substitution, hard expiry across native refresh, immediate revoke, safe session list, ambiguous credentials, pre-enrollment sessions, admin enforcement                                      |
| Endpoints           | Exhaustive actual endpoint inventory against method/path allowlist, cookie + Bearer denied routes, canonicalization attempts, impersonation denied internally and externally                                                                       |
| Database privileges | Exact non-secret column SELECT grants only on approved auth tables; secret reads fail; auth role cannot access app/ops tables; audit INSERT/function success and UPDATE/DELETE/TRUNCATE/SELECT denial; PUBLIC cannot execute functions             |
| Limiter/privacy     | Per-IP and per-account limits, real Valkey failure/noeviction rejection fails closed, spoofed proxy headers, signup/reset enumeration, HMAC-only unknown subject correlation, secret sentinels in every output path                                |
| Browser             | Signup→verify→signin→onboarding, new/existing invite, switches/removal, 2FA/recovery/enrollment, own security/session revoke, last owner, owner settings, provisioning; axe on key forms and keyboard/focus checks                                 |

Compose smoke/browser tests remain `pnpm test:e2e`, with owned stack lifecycle
and cleanup. Default E2E uses an explicitly test-only in-process email capture
transport, not Mailpit or an external SMTP provider. The capture is accessible
to the test driver through a process-local/control channel, never a production
HTTP inbox or general unauthenticated debug API. Security test artifacts must
not persist credentials, cookie storage states, recovery codes, or full links.
CI runs both test layers, builds, lint/boundaries, types and formatting. Extend
meaningful mutation coverage to the identity role policy/invitation predicates
when planning; do not claim the F0 limited mutation result covers F1 security.

## Builder decisions and review checkpoints

The following design decisions were proposed by the agent and accepted by the
product owner with design approval:
additional fields instead of separate organization settings; seven-day browser
session/one-day refresh/five-minute reauth defaults; 24-hour setup link; no trusted
device bypass; token-free web session API; enrollment-required acceptance keeps
the old active organization until requirements are met; tracked email delivery
with resend recovery; internal server-plugin commands for semantics missing from
stock server APIs; cookie-only Bearer issuance; and ordinary access preserved
during pending admin setup. Durations remain boot-validated configuration values,
not hard-coded policy. Departure uses audit only, as amended by the product owner.

The builder chooses final class/file names, safe pagination limits, endpoint
nouns for Lexon controllers, template wording consistent with English/accessibility,
and exact rate windows within the documented fail-closed policy. The plan must
make these choices concrete with meaningful tests. No architecture or stack
workaround is delegated as a routine choice.

S6(b) is the first implementation proof after an approved design and plan.
Unproven details are transaction propagation through the exact Nest integration,
safe custom-plugin session issuance, and the transaction-bound narrow-function
bridge for audit/locking. Package inspection below is evidence of available APIs,
not evidence that these integrations already pass. Report a material mismatch
instead of silently broadening SQL access or weakening an invariant.

## Research notes

Read on 2026-10-31. Existing versions were checked in package manifests and
lockfile context; new dependency candidates were checked against npm metadata
and official release notes. Sources are vendor docs, published vendor package
artifacts, and this repository's documents/code. No legal-AI product source or
excluded branch was accessed. Unversioned sites are used only with the package
inspection/version caveats listed below; planning must recheck each task's APIs.

| ID  | Source / version                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verified finding and supported decision                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | [Better Auth installation](https://better-auth.com/docs/installation), [index](https://better-auth.com/llms.txt), [1.7.14 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.14)                                                                                                                                                                                                                                                                     | Current official docs identify 1.7.14, matching npm metadata; release reviewed. Candidate 1.x satisfies locked stack; no package installed during brainstorming.                                                                                                                                                                                            |
| R02 | [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [schema](https://orm.drizzle.team/docs/sql-schema-declaration), [transactions](https://orm.drizzle.team/docs/transactions); BA adapter 1.7.14, existing Drizzle 0.45.4                                                                                                                                                                                                                                | Adapter namespace `schemaName: 'auth'` and pgSchema output documented. Published adapter supports `transaction: true`; default is false. No Drizzle Relations v2 migration needed.                                                                                                                                                                          |
| R03 | [Database hooks](https://better-auth.com/docs/concepts/database), [endpoint hooks](https://better-auth.com/docs/concepts/hooks), [server API](https://better-auth.com/docs/concepts/api); 1.7.14                                                                                                                                                                                                                                                                        | Database after hooks run after commit. Personal and success-audit atomicity cannot rely on them. `auth.api.*` runs server endpoint hooks and can return headers for safe forwarding.                                                                                                                                                                        |
| R04 | [Published core artifact](https://registry.npmjs.org/@better-auth/core/1.7.14), [auth artifact](https://registry.npmjs.org/better-auth/1.7.14), [adapter artifact](https://registry.npmjs.org/@better-auth/drizzle-adapter/1.7.14)                                                                                                                                                                                                                                      | Inspected public export map, transaction declarations/implementation, server endpoint dispatch, organization adapter, and relevant routes in exact tarballs. `runWithTransaction` is publicly exported, joins current transactions; org adapter uses `getCurrentAdapter`. Drizzle invokes a real DB transaction when enabled. Runtime proof still required. |
| R05 | [Organization plugin](https://better-auth.com/docs/plugins/organization), [plugin authoring](https://better-auth.com/docs/concepts/plugins); 1.7.14                                                                                                                                                                                                                                                                                                                     | Additional fields on organization/member/invitation supported. Stock creation adds creator membership. Stock invitation acceptance rejects consumed IDs and creates membership; Lexon provisioning and retry/floor semantics need controlled extension. Native routes must not bypass it.                                                                   |
| R06 | [Email/password](https://better-auth.com/docs/authentication/email-password), [email](https://better-auth.com/docs/concepts/email), [users/accounts](https://better-auth.com/docs/concepts/users-accounts); 1.7.14                                                                                                                                                                                                                                                      | Verified-email signup supports enumeration-safe synthetic success, with plugin-field response caveat. Password/reset session revocation requires adapter transactions. New-email verification and delivery timing considerations reviewed.                                                                                                                  |
| R07 | [2FA](https://better-auth.com/docs/plugins/2fa); 1.7.14                                                                                                                                                                                                                                                                                                                                                                                                                 | Verified TOTP enrollment, pending sign-in has no completed session, single-use backup codes, and trusted-device bypass defaults reviewed. Enrolled-user flag alone is insufficient session MFA evidence.                                                                                                                                                    |
| R08 | [Bearer](https://better-auth.com/docs/plugins/bearer), [sessions](https://better-auth.com/docs/concepts/session-management); 1.7.14 and exact plugin/session route artifacts in R04                                                                                                                                                                                                                                                                                     | Bearer converts tokens into session authentication and emits `set-auth-token` from session cookies. It has no separate issuance endpoint or independent TTL. Native session list/revoke contracts include tokens. Separate channel/expiry enforcement and safe web projections required.                                                                    |
| R09 | [Admin](https://better-auth.com/docs/plugins/admin); 1.7.14                                                                                                                                                                                                                                                                                                                                                                                                             | Default administration includes impersonation and broad operations. Restrict permissions and deny unlisted HTTP routes; no env admin-ID list or web bootstrap.                                                                                                                                                                                              |
| R10 | [Nest adapter README](https://github.com/ThallesP/nestjs-better-auth), [2.8.0 release](https://github.com/ThallesP/nestjs-better-auth/releases/tag/v2.8.0), npm 2.8.0 peer metadata                                                                                                                                                                                                                                                                                     | Release adds NestJS 12. Peers include Nest 12, TS6, BA >=1.5 <2. Raw-body/parser controls and disabling its default guard documented. Keep custom Lexon global policy, prove body behavior and ESM in S6(b).                                                                                                                                                |
| R11 | [Nest guards](https://docs.nestjs.com/guards), [execution context](https://docs.nestjs.com/fundamentals/execution-context); installed 12.3.2                                                                                                                                                                                                                                                                                                                            | Guard-derived explicit context and public-route metadata; reuse F0 composition/decorator checks. Versioned installed declarations remain the task-level API authority.                                                                                                                                                                                      |
| R12 | [PG17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html), [functions](https://www.postgresql.org/docs/17/sql-createfunction.html), [triggers](https://www.postgresql.org/docs/17/sql-createtrigger.html), [locking](https://www.postgresql.org/docs/17/explicit-locking.html); deployed 17.11                                                                                                                                                                    | Separate column/table/function privileges, fixed search_path, revoke PUBLIC function execution, deferred constraint triggers plus serialization; never infer concurrent safety from a count alone.                                                                                                                                                          |
| R13 | [BA limiting](https://better-auth.com/docs/concepts/rate-limit), [limiter Redis store](https://github.com/animir/node-rate-limiter-flexible/wiki/Redis), [login example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example), [options](https://github.com/animir/node-rate-limiter-flexible/wiki/Options), [11.2.3 release](https://github.com/animir/node-rate-limiter-flexible/releases/tag/v11.2.3); existing ioredis 6.0.0 / Valkey 9.0.7   | Server auth.api calls bypass native HTTP limiting; custom consume must be atomic. Candidate limiter 11.2.3 release reviewed. Apply before dispatch and reject store failures without insurance fallback. Exact ioredis-6 behavior needs integration proof.                                                                                                  |
| R14 | [Nodemailer SMTP](https://nodemailer.com/smtp), [stream transport](https://nodemailer.com/transports/stream), [10.3.1 release](https://github.com/nodemailer/nodemailer/releases/tag/v10.3.1); candidate 10.3.1                                                                                                                                                                                                                                                         | SMTP stays provider-independent; stream transport produces inspectable messages in process. Current release and Node >=20 requirement checked, compatible baseline with Node24.                                                                                                                                                                             |
| R15 | [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/), [v1.33.0 release](https://github.com/axllent/mailpit/releases/tag/v1.33.0)                                                                                                                                                                                                                                                                                                                          | Exact stable tag exists; SMTP and UI ports are independently publishable. Product owner approved dev-only addition; stack PR #12 merged locally. Digest remains to resolve at task planning; never use latest.                                                                                                                                              |
| R16 | [Next proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [cookies](https://nextjs.org/docs/app/api-reference/functions/cookies); installed Next16.4.3                                                                                                                                                                                                                                                                                            | Cookie-presence redirects are optimistic routing only; backend validates. Cookie writes belong to response-capable boundaries. Avoid stale-cookie loops and shared personalized caching.                                                                                                                                                                    |
| R17 | [RHF useForm](https://react-hook-form.com/docs/useform), [shadcn RHF forms](https://ui.shadcn.com/docs/forms/react-hook-form), [Base UI Dialog](https://base-ui.com/react/components/dialog), [Zod basics](https://zod.dev/basics); RHF7.91.0, resolvers6.0.2, BaseUI1.9.0, Zod4.6.7                                                                                                                                                                                    | Shared form schema, field validation/ARIA, and focus behavior; retain base-nova. Existing F0 manifests confirm pins; no replacement validation or UI library.                                                                                                                                                                                               |
| R18 | [React store integration](https://react.dev/reference/react/useSyncExternalStore), [Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys); React19.3.1, Query5.105.0                                                                                                                                                                                                                                                                    | Auth client session state and tenant-dependent query identity need explicit cache transitions; no hand-built implicit global tenant store.                                                                                                                                                                                                                  |
| R19 | [Vitest global setup](https://vitest.dev/config/globalsetup), [Testcontainers](https://node.testcontainers.org/features/containers/), [Playwright accessibility](https://playwright.dev/docs/accessibility-testing); Vitest5.0.5, TC12.2.1, Playwright1.64.1                                                                                                                                                                                                            | Preserve run-scoped infrastructure and file isolation; Playwright plus axe for browser accessibility. Reuse F0 harness and cleanup rather than introducing pre-started services.                                                                                                                                                                            |
| R20 | [pnpm settings](https://pnpm.io/settings), [F0 research](2026-10-31-f0-foundation-design.md#research-notes); pnpm10.33.1, Node24.22.1, TS6.0.3                                                                                                                                                                                                                                                                                                                          | Existing YAML overrides/settings and exact singleton pins remain. Public pnpm settings page is newer than installed pnpm; use current workspace behavior and installed-version checks when planning dependency edits.                                                                                                                                       |
| R21 | [shadcn CLI](https://ui.shadcn.com/docs/cli), [base-nova login-02](https://ui.shadcn.com/r/styles/base-nova/login-02.json), [signup-02](https://ui.shadcn.com/r/styles/base-nova/signup-02.json), [card](https://ui.shadcn.com/r/styles/base-nova/card.json), [field](https://ui.shadcn.com/r/styles/base-nova/field.json), [input-otp](https://ui.shadcn.com/r/styles/base-nova/input-otp.json); official registry read 2026-10-31, CLI version to pin during planning | Registry responses confirm both named blocks and the three primitives exist; input-otp declares its own package dependency. Product owner requires CLI generation, removal of social/decorative content, shared-schema RHF adaptation, token-only styling, minimal owned code, and axe verification. No scaffold was generated during brainstorming.        |

### Planning verification supplement

The following checks were repeated while writing the plan on 2026-10-31.
Each task cites the relevant research IDs; its brief/spec references, cached
official pages and exact published artifacts were re-read before defining it.
These checks establish available interfaces, not successful runtime integration.

- **R22 — exact planning pins and image identity.** Official npm metadata for
  [auth1.7.14](https://registry.npmjs.org/auth/1.7.14),
  [shadcn4.23.0](https://registry.npmjs.org/shadcn/4.23.0),
  [input-otp1.5.0](https://registry.npmjs.org/input-otp/1.5.0),
  [axe Playwright4.14.0](https://registry.npmjs.org/@axe-core/playwright/4.14.0),
  and [Nodemailer10.3.1](https://registry.npmjs.org/nodemailer/10.3.1)
  checked against Node24/React19 peers. Nodemailer10 bundles declarations; no
  additional older @types package is required. The older `@better-auth/cli` is deprecated;
  the [official CLI guide](https://better-auth.com/docs/concepts/cli) uses `auth`.
  Its stock create-admin command can mark email verified and is not Lexon's setup
  flow. Registry inspection confirms component helper dependencies; use
  clsx2.1.1, tailwind-merge3.7.0 and class-variance-authority0.7.1 with their
  [official](https://github.com/lukeed/clsx)
  [maintainer](https://github.com/dcastil/tailwind-merge)
  [documentation](https://cva.style/docs/getting-started/installation).
  Docker registry inspection of `axllent/mailpit:v1.33.0` resolved the multiarch
  digest `sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231`.
  [Mailpit runtime options](https://mailpit.axllent.org/docs/configuration/runtime-options/)
  confirm temporary storage and version-check controls; no image was installed
  or service added during planning.
- **R23 — browser and test composition.** Rechecked the pinned React19.3.1,
  Next16.4.3, Query5.105.0, RHF7.91.0, Playwright1.64.1 and Stryker10.1.1
  manifests alongside [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation),
  [Playwright recording controls](https://playwright.dev/docs/test-use-options),
  [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/),
  [Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
  and the actual F0 harness. Security projects disable credential-bearing
  artifacts. A presentation-only frontend health response can remain public
  without auth or business-data access. Test mail uses in-process Nodemailer
  with operator/test-only IPC, not an HTTP inbox or production capture flag.
  Existing F0 CSS has placeholder values; F1 maps only required form tokens
  to LEX-DS-001 rather than building F2's full design system.
- **R24 — native transaction/freshness details.** Re-read R04's exact1.7.14
  transaction and API artifacts. Some 2FA operations use the base adapter
  directly; the private public-interface facade must route those operations
  into the active transaction too. S6(b) must test their rollback, not only
  organization writes. Native `verifyPassword` is server-only; native session
  list freshness is based on session creation. Lexon exposes its own safe
  session-ID API and recent-reauthentication evidence, without forging native
  freshness or returning tokens. [PG17 isolation](https://www.postgresql.org/docs/17/transaction-iso.html)
  was checked for owner/admission race tests. Installed Drizzle Kit0.31.11
  `generate --help` confirmed schema/dialect/out/name/breakpoints flags; isolated
  auth-only generation avoids recreating the snapshot-less F0 ops migrations. The test-only TOTP oracle uses
  [RFC6238](https://www.rfc-editor.org/rfc/rfc6238) vectors and
  [Node24 crypto](https://nodejs.org/download/release/v24.22.1/docs/api/crypto.html);
  runtime verification remains entirely Better Auth's responsibility.

Vendored guidance consulted: Better Auth integration, organization, password,
2FA and security skills; shadcn forms; Valkey; pnpm/Vitest/Playwright; and
Karpathy guidelines. `.agents/skills/README.md` conflicts remain overridden by
the locked stack: no push migrations, cookie authorization cache, impersonation,
social providers, unreviewed tools, or Radix components.

### Implementation research supplement — Personal invariant

- **R25 (2026-11-01):** PostgreSQL 17 [CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html), [GRANT](https://www.postgresql.org/docs/17/sql-grant.html), and [function security](https://www.postgresql.org/docs/17/sql-createfunction.html). Verified row triggers participate in the inserting transaction, deferred constraint triggers check final state, and column SELECT grants do not grant table-wide reads. Task 2 uses migrator-owned triggers with qualified references and a fixed safe search path, revoked PUBLIC execution, and exact app-role projections. Existing Better Auth 1.7.14 generated native columns remain authoritative; its additional Personal owner string is represented as a constrained UUID in Drizzle/PostgreSQL.

- **R26 (2026-11-01):** Re-read PostgreSQL 17 [privileges](https://www.postgresql.org/docs/17/ddl-priv.html), [function security](https://www.postgresql.org/docs/17/sql-createfunction.html), [Drizzle parameterized SQL](https://orm.drizzle.team/docs/sql) against installed ORM 0.45.4 declarations, and [Zod 4 strict objects](https://zod.dev/api?id=objects) against installed 4.6.7. Task 3 revokes inherited table grants, permits only INSERT to app, and gives auth only one safe-path writer function. A private callback binding runs that named function on the current Drizzle transaction; DB code imports no domain schemas. A row trigger validates direct app inserts too. Domain and SQL variants must expand together in later tasks; no runtime audit read API is introduced.

- **R27 (2026-11-01):** Re-read [Zod 4 API](https://zod.dev/api), installed 4.6.7 declarations, and exact Better Auth 1.7.14 published organization invite routes and context creation. Native storage uses `canceled`/`rejected`; shared contracts expose only `cancelled`/`declined`/derived `expired`, with the domain mapper implemented in Task 12. Native password maximum defaults to128; forms share that bound and the approved12-character minimum. Common UUID/name/email validators remain in shared identity.ts to avoid an auth/organization schema cycle. No backend or Node code enters contracts.
