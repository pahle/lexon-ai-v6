# Feature briefs

Each brief is the clean input for one superpowers cycle:
`brainstorming` → spec in `docs/superpowers/specs/` → `writing-plans` → plan in
`docs/superpowers/plans/` → TDD execution → review.

A brief states **what** the slice must do and how we will know it is done. It
does not prescribe implementation beyond what `docs/specs/` already fixes.
Briefs are written in English and contain no material copied from any
third-party product.

## Slices (proposed order — awaiting product owner approval)

| ID | Slice | Depends on | Spike | Brief |
|---|---|---|---|---|
| F0 | Foundation: pnpm monorepo, `shared/`, frontend + backend scaffolds, four backend entrypoints, config/logging/health, local Docker Compose (Postgres, Valkey, SeaweedFS), DB roles + schemas, `withTenant` + fail-closed RLS, ESLint boundary rules, Vitest/Playwright/Stryker, CI | — | S6 | — |
| F1 | Identity & Organizations: Better Auth (email/password, verification, password reset, 2FA, sessions), organizations, members, invitations, org roles, platform admin, `proxy.ts` redirects | F0 | S6 (b) | — |
| F2 | App shell & design system: tokens from LEX-DS-001, layout (sidebar / main / right panel), navigation, empty/error/loading states, settings shell, a11y checks | F1 | — | — |
| F3 | Chat core: conversations, messages, AI runs, outbox + dispatcher, AI worker, Valkey Streams, SSE stream hub, `ChatTransport` + assistant-ui, cancel, resume, model allowlist, usage events | F2 | S2 | — |
| F4 | AI tool runtime & approvals: tool registry, read/write classification, `awaiting_approval` flow, untrusted-data delimiting, tool audit | F3 | — | — |
| F5 | Projects & ethical wall: projects, membership, deny list, project instructions, project-scoped chats | F3 | — | — |
| F6 | Documents & Library: upload sessions, quarantine, ClamAV, validation, extraction, OCR, chunking, object encryption, folders, versions, PDF viewer, downloads | F5 | S5 | — |
| F7 | Retrieval & citations: FTS + trigram with RRF, full-context path, structured citations, server-side verification, citation UI that opens the source | F6, F4 | S3 | — |
| F8 | Memory: user and project memory, AI-proposed memories with approval, editing, injection into context | F4, F5 | — | — |
| F9 | Workflows & Quick Actions: built-in, org, and personal workflows, sharing, running a workflow in chat, quick actions | F4, F5 | — | — |
| F10 | Web research: web search and page fetch as AI tools via the validated HTTP client, source citations | F4 | — | — |
| F11 | Subagents: delegated child runs with depth, budget, and permission limits; streaming of child progress | F4 | — | — |
| F12 | Tabular Review: review / columns / cells, per-document jobs, cell states, citations per cell, live grid, chat over a table, XLSX export | F7 | S4 | — |
| F13 | DOCX Editor: EigenPal behind `EditorPort`, versions, soft lock, tracked changes and comments, AI suggestions as tracked changes, export | F6, F4 | S1 | — |
| F14 | Playbooks: contract review rules, import, applying a playbook to a document review | F12, F13 | — | — |
| F15 | MCP connectors: connector management, OAuth / bearer / headers, tool discovery and policies, write approval | F4 | — | — |
| F16 | Usage, quotas & audit: per-org quotas and rate limits, cost estimates, audit log views, audit export | F3 | — | — |
| F17 | Retention, deletion & personal data export: retention policies, hard delete with deletion ledger, legal hold, tenant deletion, personal data export | F16 | — | — |
| F18 | Word add-in: Office.js task pane, Bearer login via Dialog API, chat in Word, attributed OOXML suggestions | F13 | S1 | — |
| F19 | Production operations: Caddy, production Compose, sandbox hardening, backups and restore drill, OTel Collector, Sentry Relay | F0 | S5 | — |

Out of scope for the MVP: user-supplied API keys (BYOK), desktop app,
third-party foreign case-law databases.

## Brief template

```markdown
# F<n> — <Slice name>

## Goal
One paragraph: the user or system outcome and why it matters.

## Users and permissions
Who uses it, under which role, and what they must not be able to do.

## In scope
Numbered behaviors, each observable and testable.

## Out of scope
What is deliberately left to later slices (with slice IDs).

## User flows
Step-by-step flows, including empty, error, and edge cases.

## Data and contracts
Entities and states at the level of meaning (not schema); API and event
contracts that must exist in `shared/`.

## Non-functional requirements
Security, tenancy, privacy (K1/K2/K3), performance, accessibility.

## Acceptance criteria
Checklist used to verify the slice, including negative tests
(cross-tenant, cross-project, unauthorized).

## References
Sections of LEX-TS-001, LEX-ARC-001, LEX-DS-001 this slice implements.

## Open questions
Decisions the brainstorming session must settle with the product owner.
```
