# F1 research notes — reference behavior (dirty side)

Reference @ 1f7ae19. Sources: backend `lib/workspace.ts`, `lib/personalOrgs.ts`,
`modules/orgs/*`, `modules/auth/auth.routes.ts`, `modules/user/user.routes.ts`,
frontend `contexts/WorkspaceContext.tsx`; diagrams 12-auth, 13-organisasi A and
workspace/offboarding.

## Multi-organization model (answer to the product owner's question)
- Every account has a hidden personal organization (kind 'personal', one
  member = owner, created with the account, removed with it). It is never
  listed, renamed, invited into, or switched to as an "organization".
- Plus zero or more team organizations. A workspace picker selects
  "Personal" or one org; choice remembered per account in browser storage.
- The selection only narrows lists; the server re-checks membership on every
  request. If membership is gone, the client falls back to Personal and stays
  there (re-invite does not silently move them back). A read failure is not
  treated as "membership gone".
- Lexon adaptation: active organization stored server-side on the session
  (Better Auth), guard re-verifies membership each request (fits RLS + the
  "no implicit context" rule better than a client query parameter).

## Roles, invitations, departure
- Roles owner (several allowed) / admin / member; >= 1 owner per team org
  enforced in service and DB trigger (concurrent departures cannot both pass).
- Role changes checked against actor and target.
- Invite by email + role; default member; admin invites need owner; owner
  never invitable; one pending per (org, email); expiry 14 days; states
  pending/accepted/declined/cancelled/expired; admin list/resend/cancel;
  recipient sees own invites only once email verified.
- Accepting is the only way to join; invite role is a floor (never demotes);
  idempotent.
- Leave/remove: member may leave; removing others needs higher rank; last
  owner cannot leave; handover preview; content: still-owned stays, shared
  without other owner → successor, private unshared → archive 30 days then
  delete; member's grants/connectors revoked. (Content parts → F18 in Lexon.)

## Auth
- Password + email confirmation (min length 10 in reference; Lexon chose 12),
  TOTP MFA (enroll/challenge/verify/factors), when MFA enrolled every route
  needs the second factor except bootstrap routes (session, MFA, profile).
- Account deletion pending blocks requests (Lexon: F18).
- Onboarding after verification: profile, practice area, pending invitations.
- Password reset, change email/password.
- Word/desktop handoff with one-time encrypted ticket, short TTL (Lexon: F19,
  Bearer + Office Dialog per LEX-ARC-001 §8).
- Social login/SSO exists in reference; out of Lexon MVP by decision.
