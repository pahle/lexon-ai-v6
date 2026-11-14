# Project state

Last updated: 2026-11-09 by the brief generator (session 1; session 2 handled F3 Task 9 and PR #25).

## Next action

**2026-11-14:** F4 in Task 21 final fix wave (Codex, moving to a fresh thread because of usage limits). PO agreed to trial **Claude Code as F4.1 implementer** (fresh clean session on the PO's Mac with Docker; this contaminated session stays brief generator/reviewer). Prep done: PR #30 (`.claude/skills` symlinks to `.agents/skills`), F4.1 brief draft at `design-drafts/F4.1-brand-refresh.brief-draft.md`. When F4 merges: publish brief + prototype + brand v4.1 extract + LEX-DS-001 v3.0 in one PR.

**F4 Chat brief merged (PR #28)** (prototype approved 2026-11-09, `docs/design/f4-prototype/`).
Next: Codex brainstorms F4 (open the feature-branch
draft PR early so CI runs every task).

## Slice status

Source of truth for the slice list: `docs/briefs/README.md` on `main`.

| Slice | Status | Notes |
|---|---|---|
| F0 Foundation | **Done** — merged to `main` (PR #6, plus review fixes PR #7) | Review: `reviews/F0-review.md` |
| F1 Identity & Organizations | **Done** — merged to `main` (PR #15, review fix PR #16) | Review: `reviews/F1-review.md`; notes: `notes/F1-identity-organizations.md` |
| F2 App shell & design system | **Done** — merged to `main` (PR #20); spec clarifications PR #18, #19 | Notes: `notes/F2-app-shell.md` |
| F2.1 Visual rework | **Done** — merged to `main` (PR #23); prototype, brand v1.1, DS v2.1 via PR #22 | Screenshot gate; PO approves before merge |
| F3 AI Run Engine | **Done** — merged to `main` (PR #27; fixes PR #25, #26) | Review: `reviews/F3-review.md` |
| F4 Chat | Brief merged (PR #28); awaiting Codex brainstorming | Prototype `docs/design/f4-prototype/` |
| F5–F20 | Not started | — |

## Follow-ups carried into future briefs

- **F6:** TenantGuard rejects bodies containing `userId`/`organizationId`/`orgId` keys on all workspace routes; project-member endpoints need a per-route allowance.

- **F3 gap found in F4 brainstorming (2026-11-09):** no `usage_events` table; accounting lived only in `app.ai_attempts` (deleted with runs). F4 adds a content-free Usage ledger (one row per attempt, no FKs, RLS) as an engine contract revision. Review lesson: check named spec tables exist, not only behavior.
- **F8/S3 (from F4 Task 13, 2026-11-12):** with FORCE RLS, FTS `@@` and pg_trgm operators are not LEAKPROOF, so the planner applies RLS quals first and does not use GIN. F4 accepted per-owner B-tree scans with measured p95 (<300 ms heavy-user target); F8 document-scale retrieval must solve indexed search under RLS (spike S3) without LEAKPROOF/SECURITY DEFINER bypasses.
- **F20 (from F4 Task 13):** tune production PostgreSQL (shared_buffers default 128 MB in tests); F4 search gate: blocking = plan shape + no errors + p95 < 1,000 ms; 500 ms p95 on GitHub 4-vCPU runner is a non-blocking warning (shared-runner variance 405-531 ms on identical code/CPU model; ~273 ms on Apple M4), stored generated tsvector columns, prefix FTS, trigram titles only.
- **F4:** SSE hub over the F3 run streams; ChatTransport replaces the inert runtime.
- **F5:** approval expiry; external tool adapters on the F3 idempotency modes.
- **Before F8:** calibrate the token estimator with real usage.
- **F17:** reconcile cost of unknown attempts; customer quotas.
- **P8:** production region decision.
- **F17:** `ops.audit_events` has no tenant RLS; org-scoped audit views must filter through the authorization predicate builder.
- **F20:** frontend no-egress is not enforced in dev Compose (edge must stay
  non-internal for host ports); enforce with Caddy + host firewall and test it.
- **F18/ops:** processed-job receipts are never deleted in F0; cleanup must
  keep receipts longer than the maximum redelivery window.

- **CI hygiene:** feature-branch pushes get no CI (push = `main` only); open a draft PR from the feature branch at the start of each slice so every task runs in CI.
- **Later UI refinement:** full-screen mobile Settings pattern (section list, then content) deferred by PO.

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

- F2 brainstorming (2026-11-01): dark mode in the MVP (LEX-DS-001 v1.1, `next-themes` in LEX-TS-001 v1.8); scaffold from shadcn blocks and assistant-ui registry/examples; sidebar shows only working destinations; Home = assistant-ui chat scaffold (disabled composer, F4 connects it); settings URLs tidied without redirects (F1 paths never used in production).

- Brand (2026-11-02): product owner supplied the Lexon brand package (Royal Seal); adopted as LEX-DS-001 v2.0; auth cover image placeholder until the PO supplies one; composer shown with send disabled + "Chat is coming soon" tooltip until F4.
- F2 execution (2026-11-02): product owner wants subagent-driven execution with implementer model fixed (gpt-6 luna, high); main session reviews.
- F4: replace F2's inert assistant-ui runtime with the ChatTransport; sidebar conversation group gets real history.
- F18: org list pagination filters non-active orgs after the lookahead (see reviews/F2-review.md).

- F4 (2026-11-09): Claude builds the chat prototype first; no model picker
  (one model): default `openai/gpt-6-luna` reasoning effort `high`, a
  per-message "Deep thinking" toggle sends `max` (OpenRouter
  `reasoning.effort`; Luna supports none/low/medium/high/xhigh/max, default
  medium, verified via /api/v1/models 2026-11-09); show a Thinking indicator
  plus the reasoning summary when the provider returns one (never store
  encrypted reasoning); AI-generated titles (first-message excerpt until
  ready); regenerate last answer, edit user message with branches, full-text
  search of message content, copy + thumbs feedback; chats private to their
  creator (sharing in F6); delete is permanent after confirmation (retention
  and legal hold in F18).

- OpenRouter setup confirmed by PO (2026-11-09): ZDR only, no Safety Retention, training/discount off, workspace "Lexon" I/O logging off; dedicated CI key US$0.10 as Actions secret; attestation variables set; dev key in local .env (a dev key was exposed in a chat screenshot and revoked the same day; new key with a credit limit). Regional routing (EU/US) needs OpenRouter Business: input for P8.

- Brand kit v4.1 (2026-11-13, PO): white surfaces, Ink #1A1718, Merah Segel #B3202A (primary only), EB Garamond headlines, Inter body, TeX Gyre Bonum for legal quotes, sidebar-07 IA (Tools: Assistant/Tabular Review/Editor; Matters). Plan: new slice **F4.1 brand refresh** after F4 merges (LEX-DS-001 v3.0, re-prototype all screens, visual gate, new goldens). PO decisions: UI stays **English**; Claude derives a **dark palette** from the kit for PO approval; F4 Task 19 approves layout/states, **Task 20 golden lock moves to F4.1**. Ask PO to re-upload the kit zip when F4.1 starts (scratchpad copy is ephemeral). Flagged to PO: kit's "stored in Indonesia" claim needs P8 (hosting + model processing is Azure US via ZDR), and "deleted is permanent" conflicts with backup window W (F18).

- F4.1 prototype **approved by PO 2026-11-13** (rev 12, `design-drafts/f4.1-prototype/`, artifact https://claude.ai/artifact/1xFWhbFH5WxwAnHMZPDER6). Key decisions: inset sidebar-07 shell (English labels: Tools > Assistant > New chat/Chats; Recent), org initials tile, Lexon monogram for Personal workspace, no breadcrumb header (floating New chat/actions pill), wider 880px thread/composer, elevated composer with round send, short one-row starter pills (insert template, never auto-send), greeting serif without logo, reading-first answers, EB Garamond headlines; morphing thinking indicator (Lexon mark first each round, then shuffled §/Writing/Paper/Highlighter/Column(courthouse)/¶ each once; shape un-writes into 26 dots that wander 10-14 s in blended random patterns; on finish gathers into the Lexon mark which stays next to "Thought for N seconds" on every completed answer); reduced motion = static mark. Derived dark palette approved with the prototype. Job title profile field added. When F4 merges: copy design-drafts into main `docs/design/f4.1-prototype/` with the F4.1 brief (needs the kit's fonts/logos + licenses in `docs/brand/`).

## Lessons learned (apply to every brief)

- F4 holistic review (2026-11-14, d4ae874): verdict merge; see reviews/F4-review.md. F5 brief must open with a chat client hardening task: single source of truth for the client tree and no 1 s full-tree polling during active runs.

- F4 gate diagnosis (2026-11-14, ed873bf): the Chat SSE load workflow has never passed on a GitHub runner (runs 1-2 setup failures, 3-4 admission-startup 5xx); Task 18's 500-connection pass was local only, so it is not a fix-wave regression. Compose 'Previous branch' failure is a real frontend regression since 8f6cea3 (regenerated sibling not adopted; test waits on identical mock text). ai-execution 'renews through the bounded retry backoff' is an unchanged F3 test failing once (flaky timing). Future briefs: state where load gates must pass (local vs runner) and which workflows are required.

- F4 slowdown causes (2026-11-14): real bugs found by gates (worth it); fix waves verified only with nearby tests then broke load/Compose on CI (extra 30-60 min loops); heavy evidence docs (acceptance >1,700 lines); usage-limit interruptions. Future briefs: run every affected gate locally before pushing (SSE change => local load; UI flow change => Compose E2E), concise per-task evidence (command, result, commit), batch review findings into one fix round, one agent session per phase.

- Codex SDD subagents repeatedly wrote code before tests in F4 (Tasks 5, 8, 13, 15). PO disposition: accepted as recorded deviation with compensating targeted Stryker mutation (break 80, F1 precedent) and frontend manual mutation evidence; strict RED-first evidence per task from Task 16. Task 16 violated again (caught before push); PO approved recovery with a structural control: per-rule two-phase dispatch (tests-only phase, controller-observed RED, then implementation), frozen diff archived but withheld from the new agent. Future briefs: require RED evidence in every task report and a mutation gate for core logic from the start.

- **Design before implementation.** Copying shadcn blocks 1:1 gives demo
  quality: blocks have no password toggle, error states, or product IA.
  Build a quick prototype (Design canvas) with the PO first, commit its PNGs
  as the visual target, and write UI patterns into LEX-DS-001 so they apply
  to every slice. `tools`: a small renderer for .dc.html in the brief
  generator scratchpad turns canvas sources into PNGs.

- **UI slices need visual acceptance, not only machine checks.** F2 passed axe,
  lint, contrast, and 400+ tests but looked nothing like the requested blocks.
  Every UI brief: start from the published block/example, pristine scaffold
  commit first, allowed-adaptation list, screenshots approved by the product
  owner, then screenshot baselines. Reviews must render the pages.
- Do not let design-system rules override vendor component proportions
  (44px targets, custom type scale, line-height 1.5 headings, one radius
  broke the shadcn blocks). WCAG 2.2 AA target size is 24px (2.5.8).

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
