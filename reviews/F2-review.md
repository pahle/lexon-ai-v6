# F2 review — App shell & design system

Reviewed 2026-11-02 on `main` at `c21ec80` (PR #20, squash-merged by the
product owner before review). Implementer: Codex, subagent-driven (Luna/high).

## Checked

- CI: final head `b0a776a` green (unit-integration + compose-e2e, PR and push
  runs). Locally: frozen install, lint (incl. presentation/Radix policy),
  format, typecheck (after rebuilding `@lexon/contracts`), frontend + contracts
  Vitest 113/113, tooling `node --test` 104/104. No Docker here; CI covers
  Testcontainers and Compose E2E.
- Backend: `platformAdmin` reuses the exact VerifiedIdentity predicate; the
  Personal-first list keeps limit+1 lookahead, UUID cursor shape, and a
  Personal cursor that starts the team portion.
- Frontend: one identity owner (WorkspaceProvider) with request versioning
  against stale responses; tenant/account/platform cache families cleared on
  access changes; org pages gate on live identity org id + kind + role before
  mounting `['tenant', …]` queries; platform pages gate on `platformAdmin`.
- Route tree: catch-alls under static segments and `organizations/[orgId]/`
  (no sibling dynamic conflict). Proxy covers all five prefixes with exact
  root-or-slash matching.
- Chat scaffold: local runtime, inert adapter, disabled composer, no Route
  Handler (only `/health`), no `use server`, no Radix imports, no AI SDK calls.
- Tokens: dark values match LEX-DS-001 v1.1/v1.2; token contrast tests run in
  lint. Error boundaries show safe copy only (`retry` prop matches Next 16.4.3
  types).
- Clean-room: no reference-product traces.

## Fixes

None required.

## Follow-ups

- F18: `OrganizationService.list` filters non-active orgs after fetching
  limit+1; a non-active membership at the lookahead position ends pagination
  early. Not reachable in F1/F2 (members only exist in active orgs); revisit
  when archived/deleting states arrive.
- F4: replace the inert runtime with the ChatTransport; add history entries to
  the sidebar group; remove the disabled-composer copy.
- Shape lint covers static JSX/cva strings only; dynamic class expressions need
  manual review (documented in F2-acceptance).
- E2E-only limiter budget for signup/verification-resend is 100/IP/600s in
  `scripts/e2e.mjs`; production defaults unchanged.
