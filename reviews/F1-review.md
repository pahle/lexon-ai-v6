# F1 review (2026-11-01)

PR #15 (`f1-identity-organizations`, head 913631c), 24 tasks, ~31k lines.
CI green on head (unit + Testcontainers integration + identity mutation gate,
Compose E2E).

## Checked
- Migrations 0003–0014: SECURITY DEFINER functions have fixed search_path,
  REVOKE PUBLIC, narrow GRANT EXECUTE; app role gets column-level SELECT only
  on non-secret auth columns; audit INSERT-only.
- Session security trigger: evidence fields only through the narrow writer,
  bearer hard expiry clamps expires_at, cookie→bearer conversion blocked.
- Layering: auth plugins take expected-state preconditions; policy stays in
  modules (lint `infrastructure-domain` passes).
- Tenant guard: active org from session, override headers/keys rejected,
  membership re-resolved per request.
- No skipped tests / ts-ignore; frontend never handles Bearer tokens; auth
  secrets only on API and operator services; proxy cookie-presence only.

## Fixed by brief owner (PR into f1 branch)
- TenantGuard called limiter.assertAvailable() (Valkey write) on every
  workspace request → all authenticated routes 503 when limiter down;
  violates LEX-ARC-001 §5.4. Removed from the guard.
- LEX-ARC-001 §3.2 lists the new `lexon_setup` operator role.

## Follow-ups for later briefs
- F6: TenantGuard rejects request bodies containing `userId`,
  `organizationId`, `orgId`, … on all workspace routes. Adding project members
  by userId will need a per-route allowance (context still never comes from
  the body).
- F2: proxy.ts only redirects `/workspace/*`; other (workspace) pages
  (onboarding, account, organizations, platform) rely on SessionBoundary 401
  handling. Extend the matcher when F2 builds the shell routes.
- F2: auth pages use temporary minimal styling; full shell/design in F2.
- F17: ops.audit_events has no RLS; org-scoped views must use the predicate
  builder.
- Post-commit SMTP is not durable (documented limitation).
