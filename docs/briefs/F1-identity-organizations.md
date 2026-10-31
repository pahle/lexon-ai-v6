# F1 — Identity & Organizations

## Goal

Let people sign in to Lexon and work inside organizations, safely. After F1:
- a person can create an account or join by invitation;
- they can belong to several organizations and switch between them;
- every backend request carries a verified tenant context that F0's
  `withTenant` and RLS enforce.

F1 also completes spike **S6(b)** (Better Auth inside NestJS 12 ESM). Every
later slice depends on F1's guard and tenant context, so getting identity and
tenant selection right here matters more than UI polish (F2 owns the shell).

## Users and permissions

| Actor | Can | Cannot |
|---|---|---|
| Visitor | Sign up (when open sign-up is enabled), sign in, reset password, open an invitation link | See any organization data |
| Signed-in user | Manage own profile, password, email, 2FA, sessions; see own pending invitations; create a team organization; switch the active organization among their memberships | Act in an organization they are not a member of |
| Organization **owner** | Everything an admin can; invite admins; change any member's role including other owners; delete-flow hooks are F18 | Leave or be demoted if they are the last owner |
| Organization **admin** | Invite members, resend/cancel invitations, remove members, change member ↔ admin roles below owner | Invite or appoint owners; remove or demote owners |
| Organization **member** | Use the organization; leave it | Manage members or invitations |
| **Platform administrator** | Create organizations, invite their first owner, disable/re-enable user accounts; must use 2FA | Read organization content; impersonate users (LEX-ARC-001 §3.2, §6.2 break-glass) |

## Decisions already made (product owner, 2026-10-31)

1. **Both entry paths exist:** open self-serve sign-up **and** invitation.
   Open sign-up can be switched off per environment by configuration
   (invitation-only mode), without code changes.
2. **Multiple organizations per user,** with an active organization that the
   user switches.
3. **No Google/Microsoft or other social login in the MVP.** Email and
   password plus 2FA only.

## Concepts

- **Personal workspace.** Every account gets its own hidden **personal
  organization** when the account is created, with exactly one member, its owner.
  - It gives content that belongs to nobody else a real `org_id`, so RLS
    (LEX-ARC-001 §3.2) applies everywhere with no NULL-tenant special case.
  - It is shown as "Personal", not as an organization. It cannot be renamed
    as an organization, invited into, left, or switched away from
    permanently.
  - It is deleted with the account (F18).
- **Team organization.** Created by a user (who becomes its owner) or by a
  platform administrator (who invites its first owner).
- **Active organization.** Each session has exactly one active organization:
  the personal one or a team organization the user belongs to.
  - It is stored on the session server-side (Better Auth's active
    organization), not trusted from the client.
  - Switching changes it for that session. Other devices and sessions keep
    their own.
  - If membership in the active organization ends, the next request falls
    back to the personal organization and the UI says why.
- **Tenant context.** For every authenticated request, a guard derives
  `{orgId, userId}` from the session's active organization. It **re-verifies
  membership on every request**, then passes the context explicitly to
  `withTenant`. A client cannot name a different org per request in F1.

## In scope

### Authentication (Better Auth on the backend, LEX-TS-001 §4, LEX-ARC-001 §3.2)

1. Better Auth mounted at `/api/auth/*` in the API runtime through
   `@thallesp/nestjs-better-auth`.
   - Better Auth gets the raw body; the JSON parser stays on for other routes.
   - The adapter tables live in the `auth` schema via a dedicated pool using
     the `lexon_auth` role.
   - Plugins: Organization, Admin, Two-Factor, Bearer.
   - If S6 shows the community adapter is incompatible, use the thin
     `toNodeHandler` adapter (pre-approved fallback); record the finding.
2. Sign-up with email and password (minimum 12 characters).
   - Email verification is required before the account can use the app.
   - Verification links expire.
   - Sign-up and password-reset responses never reveal whether an email
     already has an account.
3. Sign-in, sign-out, sign-out of all sessions, list and revoke own sessions,
   session expiry and refresh. Cookies are HttpOnly, Secure outside local
   development, and SameSite; one public origin (LEX-ARC-001 §3.5).
4. Password reset by email, change password (requires current password,
   revokes other sessions), change email (verified at the new address).
5. Two-factor authentication with TOTP and recovery codes:
   - enroll, verify, disable (needs a recent re-authentication);
   - when 2FA is on, sign-in needs the second factor before any app route;
   - mandatory for platform administrators;
   - an organization owner can require 2FA for its members. A member without
     2FA is sent to enrollment before they can enter that organization.
6. Bearer tokens (Bearer plugin) are issued and accepted for the same API,
   proving the non-cookie path that the Word add-in uses later (F19).
   Tokens are short-lived and bound to a session.
7. Rate limiting on sign-up, sign-in, 2FA verify, password reset, and
   verification resend, per IP and per account.
   - Auth endpoints **fail closed** when the limiter store is unavailable
     (LEX-ARC-001 §5.4).
   - Use Lexon's Valkey limiter connection (`VALKEY_LIMITER_URL`).
8. Transactional email through Nodemailer SMTP (LEX-TS-001 §4).
   - English templates for verification, password reset, invitation, email
     change, and new-2FA/security notices.
   - Tests use an in-process transport and assert the content and links.
   - Never log full links or tokens.

### Organizations and membership

9. Personal organization created atomically with the account; protected
   from organization operations as described in **Concepts**.
10. Create a team organization (name, slug); creator becomes owner. Platform
    admin can create one and invite its first owner.
11. Roles: `owner` (one or more), `admin`, `member`.
    - Every team organization always has at least one owner. Enforce this in
      the service **and** in the database, so two owners leaving
      concurrently cannot both succeed.
    - Role changes are checked against both the actor's role and the
      target's current role.
12. Invitations by email with role `member` (default) or `admin`; inviting
    an admin requires an owner. Owners are never invited; owners promote.
    - One pending invitation per (organization, email).
    - Invitations expire after 14 days (configurable).
    - States: pending, accepted, declined, cancelled, expired.
    - Admins list, resend, and cancel invitations.
    - The recipient sees their pending invitations only after their email
      is verified, and only invitations addressed to that email.
13. Accepting an invitation is the only way to join an existing
    organization (besides creating it).
    - The invitation's role is a **floor**: accepting may raise a member to
      admin but never lowers an existing admin or owner.
    - Accepting again is idempotent.
    - A new user who opens an invitation link signs up with that email,
      verifies it, and then accepts.
14. Leave an organization (members and admins; owners only if another owner
    remains). Remove a member (admin can remove members; owner can remove
    anyone except the last owner).
    - On leave or removal: the user loses access immediately, including
      sessions whose active organization was that one (they fall back to
      personal).
    - Content handover and archival on departure are **F18** (no content
      exists yet). F1 emits the departure event that F18 builds on.
15. Organization settings basics: rename, slug, "require 2FA for members"
    toggle (owner only). The org-level "project access by role" option from
    LEX-ARC-001 §3.2 belongs to F6.

### Tenant context and authorization

16. A NestJS guard on all non-public API routes:
    - resolves the session (cookie or Bearer);
    - enforces verified email and 2FA requirements;
    - resolves the active organization and re-verifies membership;
    - exposes an explicit request context `{orgId, userId, role}` to
      controllers, which pass it to `withTenant`.
    - Public routes are opt-in and listed.
17. `lexon_app` gets per-column `SELECT` on non-secret columns of
    `auth.user`, `auth.organization`, and `auth.member` (LEX-ARC-001 §3.2).
    - Secret columns (password hashes, session tokens, 2FA secrets, recovery
      codes) are unreadable by `lexon_app`.
    - Migrations own these grants.
18. Membership and role checks go through one policy service in the
    `identity-access` module (LEX-ARC-001 §3.1). Other modules use its public
    `index.ts`.

### Audit (cross-cutting rule)

19. A minimal append-only audit store in `app` (or `ops` if it holds no
    tenant data; decide in brainstorming) records:
    - sign-in success and failure (without the attempted password);
    - 2FA changes; password and email changes;
    - session revocation;
    - organization creation; invitation lifecycle; role changes; member
      departure;
    - platform-admin actions.
    It holds ids and metadata only (K3). `lexon_app` has no `UPDATE`/`DELETE`
    on it. Views and export are F17.

### Frontend (minimal; F2 owns the shell and design system)

20. Pages in the `(auth)` route group:
    - sign up, sign in, 2FA challenge;
    - verify email (pending and confirmed);
    - forgot password and reset password;
    - accept invitation.
21. In the `(workspace)` route group:
    - onboarding after first verified sign-in: display name, then pending
      invitations to accept, then optionally create a team organization;
    - account security page: password, email, 2FA enroll/disable, recovery
      codes, sessions with revoke;
    - minimal organization pages: members, invitations, roles, settings;
    - an organization switcher that sets the active organization through
      the backend.
22. `proxy.ts` redirects by **cookie presence only** (no session decoding):
    - unauthenticated visitors on `(workspace)` routes go to sign-in, keeping
      the return path;
    - signed-in users on sign-in/sign-up go to the app.
    Access decisions stay on the backend.
23. Forms use React Hook Form with Zod schemas from `shared/`. All copy is
    English. Pages pass the axe check (LEX-DS-001 §6).

## Out of scope

- Social login and SSO (not in MVP; LEX-TS-001 change required to add).
- App shell, navigation, design tokens, settings layout → **F2**.
- Project membership, ethical walls, and the "role grants project access"
  org option → **F6**.
- Content handover/archive on departure, account deletion, organization
  archive/deletion, crypto-shredding → **F18**.
- Audit views/export, usage quotas → **F17**.
- Word add-in sign-in via Office Dialog and web-to-add-in handoff → **F19**.
- Production SMTP provider choice, Caddy/TLS → **F20**.

## User flows

1. **Self-serve sign-up** (open mode):
   1. Sign up, then see a "check your email" page.
   2. Verify, then sign in.
   3. Onboarding: profile, pending invitations, optional team organization.
   4. Land in the workspace with Personal active.
2. **Invitation, new person:**
   1. An admin invites `a@firm.test`; the email arrives.
   2. The link opens the accept page, which offers sign-up for that email
      (sign-up is allowed for an invited email even in invitation-only mode).
   3. Verify, then accept; the organization becomes active.
3. **Invitation, existing user:** sign in (with 2FA if enabled), accept,
   switch to the organization.
4. **Switch organization:** pick another membership in the switcher. The
   session's active organization changes, and the next requests carry the
   new tenant context.
5. **Removed while working:** an admin removes Bob. Bob's next request falls
   back to Personal, with the message "You no longer have access to <Org>."
6. **Org requires 2FA:** a member without 2FA switching in is sent to
   enrollment; after enrolling they enter.
7. **Last owner:** the only owner tries to leave and is blocked with a
   message to promote another owner first.
8. **Errors:**
   - expired, cancelled, or already-used invitation;
   - verification link expired (resend available);
   - rate-limited sign-in (generic message);
   - wrong 2FA code;
   - disabled account.

## Data and contracts

- Better Auth tables in `auth`, generated through its Drizzle adapter
  configuration and committed as versioned migrations.
- Lexon additions, either Better Auth additional fields or Lexon tables:
  - organization `kind` (`personal` | `team`);
  - `require2fa` flag;
  - invitation state history if the plugin's states do not cover the
    flows.
- `shared/` contracts (Zod, versioned):
  - sign-up, sign-in, and password forms;
  - profile;
  - organization summary (id, name, slug, kind, my role);
  - member list item;
  - invitation;
  - active-organization switch;
  - the error codes used by the UI (`AUTH_*`, `ORG_*`, `INVITATION_*`).
- Request context type `{orgId, userId, role}` produced by the guard.

## Non-functional requirements

- **Tenancy:** negative tests for every new read path:
  - a non-member cannot read members or invitations of another organization;
  - a removed member loses access on the next request;
  - a Bearer token cannot select an organization the user does not belong
    to;
  - the personal organization is never visible to others.
- **Security:**
  - no account enumeration;
  - constant-time comparisons are left to Better Auth (do not re-implement);
  - CSRF protection per Better Auth's trusted-origin configuration;
  - secrets only in backend containers;
  - the Admin plugin's impersonation is **disabled** and covered by a test.
- **Privacy:** no passwords, tokens, codes, or full email links in logs,
  traces, or errors. Emails are K3 metadata in audit (ids preferred).
- **Accessibility:** forms are labelled, errors are announced, focus is
  managed on the 2FA and invitation pages.

## Research first

Read at the versions pinned in `pnpm-lock.yaml` / LEX-TS-001 (see `AGENTS.md`):

- Better Auth docs index (versioned): https://better-auth.com/docs/llms.txt.
  Pages to read:
  - installation;
  - email & password;
  - email verification;
  - session management;
  - rate limit;
  - hooks / database hooks (personal organization creation);
  - Drizzle adapter (schema option for `auth`);
  - plugins: organization (active organization, invitations, roles, access
    control), two-factor, admin (disable impersonation), bearer.
  - The optional docs MCP server is https://mcp.better-auth.com/mcp.
- `@thallesp/nestjs-better-auth` README and changelog (NestJS 12 / ESM):
  https://github.com/ThallesP/nestjs-better-auth
- NestJS 12 guards, execution context, request-scoped data:
  https://docs.nestjs.com
- Nodemailer: https://nodemailer.com
- `rate-limiter-flexible` (Valkey/ioredis store): https://github.com/animir/node-rate-limiter-flexible
- Next.js 16 `proxy.ts` and cookies: https://nextjs.org/docs
- PostgreSQL 17 column privileges: https://www.postgresql.org/docs/17/sql-grant.html

## Skills to use

From `.agents/skills/`: `shadcn` (forms and pages, `base-nova`),
`playwright-cli` (E2E), `vitest`, `pnpm`, `valkey` (limiter keys).

The official `better-auth/skills` repository was not vendored because it
publishes no license. Use the Better Auth documentation (and optionally its
docs MCP server) instead.

## Acceptance criteria

- [ ] Sign-up → verify → sign-in → onboarding works in the browser (E2E),
      with English copy and axe passing.
- [ ] Invitation flows (new person and existing user) work end to end with
      emails captured by the test transport; expired, cancelled, and
      reused invitations are rejected.
- [ ] Invitation-only mode blocks open sign-up but still allows sign-up for
      an invited email.
- [ ] A user with two team organizations plus Personal can switch. The
      backend tenant context follows the session's active organization and
      re-verifies membership per request.
- [ ] Removing a member revokes access on the next request, and their
      session falls back to Personal (tested).
- [ ] Last-owner protection holds under concurrent leave/demote (tested at
      the database level).
- [ ] Role matrix tests: every allowed and forbidden action for owner,
      admin, member, and non-member.
- [ ] 2FA:
      - [ ] enroll, verify, and recovery codes work;
      - [ ] disable requires re-authentication;
      - [ ] an org that requires 2FA blocks entry until the member enrolls;
      - [ ] platform admins cannot use the app without 2FA.
- [ ] Bearer token sign-in reaches a protected route; a token for user A
      cannot act in an organization A does not belong to.
- [ ] Rate limits trigger on repeated failures; auth endpoints fail closed
      when the limiter connection is down.
- [ ] `lexon_auth` owns DML on `auth`. `lexon_app` can read only the granted
      non-secret columns, and reading a secret column fails (tested).
- [ ] Admin impersonation is unavailable (tested).
- [ ] Audit events are written for the listed actions; `lexon_app` cannot
      update or delete them; no secrets in audit, logs, or errors (sentinel
      tests).
- [ ] `proxy.ts` redirects by cookie presence only; protected API routes
      still return 401 without a valid session.
- [ ] S6(b) findings recorded (adapter compatibility, body parser,
      `getSession` in the guard, `auth` schema via `lexon_auth`).

## References

- LEX-TS-001: §4 (authentication, email, authorization, tenant isolation),
  §5 (rate limiting), §9 P9
- LEX-ARC-001:
  - §3.1 (Identity & Access, Organizations);
  - §3.2 (Better Auth, roles, schemas, `withTenant`, ethical wall boundary);
  - §3.5 (proxy, origin, contracts);
  - §5.1, §5.4 (rate limiting, fail-closed);
  - §6.1–§6.2 (K-classes, audit, break-glass, authentication);
  - §8 (Bearer for the add-in);
  - §10 S6(b).
- LEX-DS-001: §2–§6 (tokens, forms, accessibility)
- F0 code on `main`:
  - `infrastructure/db` (`withTenant`, roles, `lexon_auth`);
  - `infrastructure/queue` (limiter connection);
  - `modules/platform`;
  - `shared/` conventions.

## Open questions

1. Should the audit store live in `app` (with RLS by org) or `ops` (no
   tenant RLS, ids only)? Platform-admin events have no organization.
2. Better Auth additional fields versus Lexon-owned tables for `kind` and
   `require2fa`: pick the one the pinned Better Auth version supports
   cleanly with the Drizzle adapter and the `auth` schema.
3. Local development email: a development-only SMTP catcher container in
   Compose would be a new tool. Propose it to the product owner, or keep the
   in-process transport plus logged message ids only.
