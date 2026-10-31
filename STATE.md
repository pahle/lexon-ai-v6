# Project state

Last updated: 2026-10-31 by the brief generator (session 1).

## Next action

**F1 brief merged to `main` (PR #9)** with LEX-ARC-001 §1/§3.2 decisions and
the F1 skills. Next: Codex through F1 brainstorming/spec/plan
(`playbooks/support-implementer.md`), review the plan, and later review the
implementation.

Housekeeping: obsolete remote branches `contaminated`, `f0-foundation`,
`claude/focused-shannon-b5cmwe` (the last one is reused for brief PRs) may
need deleting by the product owner; this sandbox cannot delete remote refs.

## Slice status

Source of truth for the slice list: `docs/briefs/README.md` on `main`.

| Slice | Status | Notes |
|---|---|---|
| F0 Foundation | **Done** — merged to `main` (PR #6, plus review fixes PR #7) | Review: `reviews/F0-review.md` |
| F1 Identity & Organizations | Design approved with amendments; Codex writing plan on branch `f1-identity-organizations` | Next: review the plan | Notes: `notes/F1-identity-organizations.md` |
| F2–F20 | Not started | — |

## Follow-ups carried into future briefs

- **F3 (AI Run Engine):** the production `ai-worker` currently starts a
  consumer on queue `ai-interactive` with a no-op handler, and each consumer
  creates its own nested Nest application context. F3 must replace this with
  a job-type → handler registry and the real queues of LEX-ARC-001 §5.3
  (`ai-interactive`, `ai-batch`, …).
- **F3:** receipts only protect PostgreSQL effects; model calls, S3 writes,
  and MCP actions need their own idempotency or reconciliation.
- **F3:** `evals/` reaches the backend only via `@lexon/backend/evaluation`;
  F3 extends that entry to expose the real engine.
- **F17:** `ops.audit_events` has no tenant RLS; org-scoped audit views must filter through the authorization predicate builder.
- **F20:** frontend no-egress is not enforced in dev Compose (edge must stay
  non-internal for host ports); enforce with Caddy + host firewall and test it.
- **F18/ops:** processed-job receipts are never deleted in F0; cleanup must
  keep receipts longer than the maximum redelivery window.

## Decision log (product owner)

- Clean-room greenfield, SDD + TDD with superpowers; implementer is ChatGPT
  Codex CLI (web search on). Documents always win over the reference.
- In scope beyond the original documents: workflows, quick actions,
  playbooks, memory, subagents, web research, personal data export.
  Out of scope: BYOK, desktop app, CourtListener, org-level provider keys.
- English everywhere in the product and in committed documents; conversation
  with the product owner in Indonesian.
- Slices F0 and F1 are separate; small slices preferred so nothing is missed.
- F3 split into AI Run Engine (headless) / F4 Chat / F5 Tools & approvals;
  LEX-ARC-001 §4.7 makes "one engine, features plug in via providers" binding.
- assistant-ui adapter `@assistant-ui/ai-sdk`; shadcn on Base UI
  (`base-nova`); TypeScript 6.x and ESLint + Prettier kept; design colors
  corrected for WCAG AA.
- Vendor skills vendored in `.agents/skills/` (reviewed, pinned); docs
  references + `scripts/fetch-docs.mjs` for llms.txt.
- Branch model: only `main` and `brief-generator` persist; temporary branches
  merged with Squash and merge, then deleted.
- `contaminated` branch renamed to `brief-generator` and made a handoff kit
  for any model/session (2026-10-31).
- F1: both sign-up paths (open + invitation) with an invitation-only switch;
  multiple organizations per user with a server-side active organization and
  a hidden personal organization; no Google/Microsoft/SSO login in the MVP.
- F1 brainstorming answers: platform-created orgs start `provisioning` (PR #10); invitation re-acceptance idempotent only while still a member (PR #11); Bearer = separate short session class, 15 min hard expiry, F19 owns renewal; audit store `ops.audit_events` with a narrow SECURITY DEFINER writer for `lexon_auth`, HMAC for unknown emails; Mailpit approved as dev-only (PR #12); personal org atomic at DB level + operator-only CLI for the first platform admin (PR #13); departure recorded only as an audit event, no outbox changes (PR #14); approach 2 (Lexon org API over Better Auth, deny-by-default plugin endpoints); auth pages scaffolded from shadcn base-nova login-02/signup-02 (product owner's choice) + input-otp.
- Better Auth skills (5, upstream has no license file) vendored by product-owner decision; `karpathy-guidelines` (MIT) vendored for all slices (PR #9).

## Lessons learned (apply to every brief)

- State guarantees precisely (F0 said "exactly once"; correct is
  at-least-once delivery with effectively-once effects).
- Check library facts before writing them into briefs (F0 used
  `pnpm.overrides`; pnpm now reads settings only from `pnpm-workspace.yaml`).
- Do not ban dependencies a later slice needs (F0 banned evals → backend,
  which F3 requires; fixed with one public evaluation entry).
- Check dev-environment practicality (an `internal` Docker network cannot
  publish host ports).
- Review layering, not only behavior: F0 shipped infrastructure → domain
  imports; a lint rule now forbids it.
- Check that rules compose: F1 said "owners are never invited" and "every org has an owner" while admins invite a first owner (fixed with a `provisioning` state, PR #10).
- Superpowers brainstorming asks one question per message and waits; give
  the product owner a ready-to-paste English answer for Codex.
