# Project state

Last updated: 2026-11-22 by the brief generator.

## Next action

**2026-11-22 (latest): F4.3 Tasks 17-19 left; four parallel sessions; F5 brief in review.**

- **Main:** F0-F4.2; F4.3 brief, prototype revision 16, F4.3 spec revision 3 + plan; CI speedups (docs-only fast path, time-balanced E2E shards).
- **Worktrees:** home = `lexon-brief-generator` (this branch); docs PRs from `lexon-docs` (`git switch -c docs/<topic> origin/main`, Prettier, draft PR). Never touch `lexon-f43-console`, `lexon-dev-workflow`, `lexon-audit-2`, `lexon-supply-chain`, or the shared checkout `lexon-ai-v6` (stays detached at origin/main).
- **Open PRs (checked 2026-11-22):**

| PR | Branch / head | CI on head | Next |
|---|---|---|---|
| #55 F4.3 | `f4.3-console` b408b9a (draft) | **red**: unit-integration, `scripts/test/f2-route-inventory.spec.mjs:43` (retired `platform/provisioning/page.tsx` redirect has no title); compose-e2e 1-3/3 green | session A fixes it (log the changed assertion old -> new), then Task 17 |
| #56 Audit 2 | `docs/audit-2` fb71d9d (draft) | green | owner reads Summary, "Changes in the second pass", "Reader leads checked and refuted"; ready; merge |
| #57 dev-workflow | `chore/dev-workflow` 53c2dcf (draft) | green | owner review, ready, merge |
| #58 supply chain | `chore/supply-chain` 84fa067 (ready) | green (osv-scanner, sbom too) | owner merges first; then check the run on main |
| #59 F5 brief | `claude/focused-shannon-b5cmwe` f295869 (ready) | green (docs fast path) | title is the branch name: rename; answer the 2 F5 questions; prototype rev 17 before planning |

- **Merge order:** #58, #56, #57, #59 (each only with green CI on its head); #55 when complete.
- **Session A (F4.3, PR #55):**
  - Task 16 a+b done (b408b9a). Shard 3 admin-setup failure (P1, one extra Linux round approved) is **resolved**: a2030af and cbcfc14 fully green, b408b9a compose-e2e all green. The red at b408b9a is a new unit failure (route inventory).
  - Brief item 5 (Resend invitation / Cancel provisioning in the Organizations row menu for provisioning rows): folded into Task 16; UI-only (existing `POST /:organizationId/resend`, `DELETE /:organizationId`); tests first, reuse confirm dialog + toasts, spec deviation log entry.
  - Task 17 question (no route exposes account-invitation facts by token): recommended answer = no new public route; drop prefill and pre-submit check; email and name editable; token sent as `accountInvitationToken`; `SignupPolicy` refusal shows the existing `invite-invalid` state; spec deviation log; adjust Task 17 tests; no new capture id. Sent? -> see owner.
  - B-06 (E2E accepting any 4xx) goes to A for its platform tests. B-23, B-16 do not go into F4.3.
  - Remaining: Tasks 17-19, stop point with the 21-state CI comparison sheets (review against revision 16, `playbooks/visual-review.md`).
- **Session B (dev-workflow, PR #57):** A-18 (test:unit without Docker), typecheck without build, A-11 allowed subset. Follow-ups: (1) separate PR fixing two racy tests with RED evidence, no weakened assertions: unhandled rejection from `chat-fence.spec.ts` / `chat-fixture.ts:123`; `chat-history.spec.ts:331` checks the API before the DELETE finishes; (2) after merge `git worktree remove ../lexon-dev-workflow`, `rm -rf /tmp/lexon-fresh-*`; (3) after F4.3 merges: remaining A-11 in F4.3 paths (identity-access retry loops, organizations pagination schemas, pg check in `organization-auth.port.ts` reading `.cause` -> extend `pgFailure` first, email normalisation).
- **Session C (Audit 2, PR #56), owner decisions pending (recommendations):** B-02 defer (own streaming-contract brief); B-08 F17 unless a basic limit now; B-09, B-15 LEX-ARC-001/LEX-TS-001 text (brief generator); B-11 one `cn` helper recorded in LEX-TS-001 (brief generator); B-16 separate slice after F4.3; B-21 yes, scheduled or changed-paths only; B-23 yes in the fix slice. **Fix slice (brief generator writes, e.g. F4.4):** tests only B-01, B-06, B-12, B-13; small test-first fixes B-03, B-04, B-05, B-14, B-22; cleanup B-10 + one-line A-18. F17, F18, F20 (A-21) own the rest. After merge `git worktree remove ../lexon-audit-2`.
- **Session D (supply chain, PR #58):** Renovate + `supply-chain.yml` (SHA-pinned OSV-Scanner, Syft SBOM). Owner: install Mend Renovate app (first PRs Monday 00-05 WIB + Dependency Dashboard issue). Required checks: `sbom` now, `osv-scanner` only after the 16 vulnerabilities (allowlist expires 2026-12-22, then red on every PR). Priority: `@opentelemetry/propagator-jaeger` (HIGH); `next@16.4.3` (7); `qs@6.15.1` (4); minimatch, glob, mdast-util-to-hast (overrides in `pnpm-workspace.yaml`, tied to assistant-ui), esbuild. Next: dependency-upgrade PR in a new worktree with TDD, listing old -> new versions; brief generator writes LEX-TS-001 v1.14 for it. Trivy later.
- **F5 brief (PR #59):** Ask the user (2-5 options + free text, "Waiting for you", Dismiss, max 2 questions per run); Deadline calculator (read-only; Indonesian holidays + cuti bersama 2026-2027 with SKB sources, no statutes, refuses uncovered years); Rename chat (write tool, inline approval card bound to snapshot hash, applied once). 24 h expiry = rejection; tool audit without K1; owner-only decisions; injection evals in CI subset. Prototype revision 17 must be approved before planning. **Open owner questions:** (1) questions reuse `awaiting_approval` with an operation kind (recommended) or new `awaiting_input` (needs LEX-ARC-001 revision)? (2) holiday calendar updated by one PR per year (recommended)?
- **Next work, in order:**
  1. Help owner send session A the Task 17 answer + route-inventory fix note.
  2. Draft follow-up prompts for B, C, D for owner approval.
  3. Amend F5 brief after owner answers.
  4. Prototype revision 17 on revision 16 (`tools/prototype/`): tool activity row (collapsed, expanded, running, failed); ask-user card (pending, answered, dismissed); "Waiting for you" in the answer header + marker in Recent and Chats; approval card (pending, approved, rejected, expired); expired question. Light/dark, desktop/mobile. Same PR: `index.json` planned ids + revision 17 notes in the prototype README. Show PNGs, wait for approval before the F5 implementer prompt.
  5. Fix-slice brief from Audit 2; LEX-TS-001 v1.14 (dependency versions, `cn` helper); LEX-ARC-001 text fixes (B-09, B-15).
- **Backlog:** plans and entitlements (two stages, F17; owner questions open); CI Docker layer cache; second shard rebalance; F20 burst numbers; F8 cover statement; SSO decision (L14); owner check of ruleset enforcement and bypass list.
- **Standing rules for prompts:** Docker rule verbatim ("Only touch containers and volumes named lexon-e2e-*, by explicit name filter. Never prune. Never touch the unnamed volume a4699d7d… or any lexon-dev_* volume. If disk space or leftover stacks block a gate, stop and ask me."); goldens only from Linux CI, gate 1.5%; max 2 Linux rounds per area; no model identifiers in repo/commits/PRs; always report head CI before a merge.

**2026-11-21 (latest): F4.3 Platform admin console in execution.**

- **Where things are:**
  - Brief: `docs/briefs/F4.3-platform-admin-console.md`, decisions 1–9:
    - decision 8: the data views kit is the frontend baseline;
    - decision 9: account invitations (owner approved).
  - Prototype revision 16 (data views kit + 21 platform states, 84 PNGs, 360 in total) approved 2026-11-21, on main via PR #50 (861ef0d).
  - Index hotfixes: PR #51 retired the revision 14 platform ids; PR #52 added the `planned` list and moved the 84 revision 16 views to it.
  - CI speed: PR #53 (docs-only PRs ±2 min, code PRs ±10 min, time-balanced shard plan, Playwright cache).
  - Spec revision 3 and plan (19 tasks) on main via PR #49 (f3ed1d5).
  - Execution runs on branch `f4.3-console` (new draft PR) with subagent-driven development: Opus low manager, at most 2 Sonnet low workers.
- **Next for the brief generator:**
  - review Claude Code's reports after Task 5 (backend read routes) and after Task 10 (backend complete);
  - at each approval point: a third Linux round; the shadcn checkbox if `package.json` changes; the CI comparison sheets for the 21 states (download the artifact yourself, see `playbooks/visual-review.md`); any re-approval or extra round; the final merge review.
- **Owner answers on spec §11:**
  1. `isPlatformAdministrator` is approved.
  2. New 409 codes: `PLATFORM_SELF_ACTION`, `PLATFORM_LAST_ADMINISTRATOR`, `PLATFORM_ALREADY_VERIFIED`, `PLATFORM_INVITATION_CONFLICT`. Not found uses the existing `NOT_FOUND`.
  3. Provisioning routes return 404 for unknown ids.
  4. Last active is the latest session activity.
  5. Uncaptured states get functional tests only.
  6. Accepting an invitation marks the email verified.
  7. `accountInvitationToken` and the 201 body are approved.
- **Plan notes the owner added:**
  - the lock function and the invitation write functions must be `VOLATILE`;
  - every new E2E spec goes into the shard plan;
  - capture ids move from planned to pending as they are captured.
- **Process problem, open:**
  - The ruleset `main` (required checks: unit-integration, compose-e2e (1/3..3/3), merge-e2e, source GitHub Actions) is not stopping merges. #50, #51 and #49 were merged while red or pending.
  - Ask the owner to verify that Enforcement is Active and the Bypass list is empty.
  - Until then, check CI yourself before telling the owner a PR is safe to merge.
- **Prototype toolkit** (rebuild and render without the old scratchpad): `tools/prototype/README.md`.
- **Shared prototype artifact:** https://claude.ai/artifact/1xFWhbFH5WxwAnHMZPDER6


**2026-11-21:** **F4.2 merged** (PR #46, 592aae5). Brief PR #45, spec-review amendments PR #47 (LEX-DS-001 v3.2, LEX-TS-001 v1.13, prototype revision 15: 6 new failure states, 3 changed; 75 states / 300 PNGs). S2 re-qualified on Linux (run 44852818707): 24 held live run streams + 476 invalidation streams, API at 384 MiB / 0.5 CPU, server-side open-SSE peak 500 for ramp and burst; p95 first frame 425 ms ramp / 6354 ms burst; auth-pool wait p95 497 ms / 2488 ms; peak memory about 313 MiB; no capacity leak. CI sharded 3 ways (19m10s -> 11m32s); required checks via ruleset `main`: unit-integration, compose-e2e (1/3..3/3), merge-e2e. Next: **F4.3 platform admin console brief** (Accounts, Organizations), prototype drawn from API contracts first.

**2026-11-19:** **F4.1 merged** (PR #33, 960d6ab) after visual rounds 1-5, prototype revisions 13-14.9 (PRs #36-#44), LEX-DS-001 v3.1 (page patterns, 1:1 fidelity gate). Reviewer whole-branch review of b7faff9: approved (security review line for the session/security contract recorded in F4.1-acceptance.md). Next: write the **F4.2 hardening brief** (task 1 = legacy visual cleanup, then audit A-01..A-05, A-10, A-16, A-17, A-19, A-22, chat client A-07..A-09, gaps G1-G7, flaky tests, S2 re-qualification with distinct sessions, A-04 burst admission on the 5-connection auth pool, CI E2E sharding, F4.1 carry-overs), then the **F4.3 platform admin console brief** (Accounts, Organizations; prototype drawn from API contracts first).

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
| F4 Chat | **Done** — merged (PR #29) | Prototype `docs/design/f4-prototype/` |
| F4.1 Brand refresh | **Done** — merged (PR #33, 960d6ab) | Prototype rev 14.9, DS v3.1, 272 Linux goldens |
| F4.2 Hardening | Done (PR #46, 2026-11-21) | Audit 1 findings + G1-G7 + cleanup |
| F4.3 Platform admin console | **In execution** (brief #48, prototype rev 16 #50, spec+plan #49; branch `f4.3-console`) | Accounts + invitations, Organizations, data views kit |
| F5–F20 | Not started | — |

## Follow-ups carried into future briefs

- **Plans & entitlements (owner brainstorm, 2026-11-21):**
  - Recommended two stages:
    1. plans and entitlements set manually by the platform administrator (seats, AI quota, features), joined to F17;
    2. self-serve payments as a later slice before public launch: a local gateway (Midtrans or Xendit: virtual accounts, QRIS, cards), invoices, PPN and e-Faktur.
  - Rule to add to the briefs README: paid features check entitlements in one place, never "if Pro" scattered in code.
  - Open owner questions: B2B law firms, B2C individual advocates, or both? Per seat, usage, or seat plus quota? Is a pilot before F7–F8?
- **CI follow-ups:**
  - Docker layer cache for the e2e images (buildx bake);
  - a second shard rebalance (shard 2 is the longest at ±500 s; F4.3 adds specs anyway).
- **F20:**
  - Burst p95 first frame 6.4 s and auth-pool wait p95 2.5 s at 384 MiB / 0.5 CPU: re-measure at production resources.
  - `ops.audit_events` RLS is F17.
- **F8:** restore the auth cover statement "Every answer names the article it rests on, so you can check it yourself."
- **SSO / Google sign-in (L14):** the owner decides whether it gets its own slice before launch.

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

## Status 2026-11-14

- F4 merged (#29, f2a73ce); PR #30 merged (e731ce0). F4.1 brief PR #31 (draft, c7b20c3): brief, LEX-DS-001 v3.0, docs/design/f4.1-prototype (38 screens + prototype.html), docs/brand/lexon-2026-v4.1. Next: PO reviews and merges #31, then a clean Claude Code session implements F4.1. F5 brief opens with chat client hardening.
- 2026-11-15: F4.1 implementer (Claude Code, Fable 5.2 low main and workers, Opus high reviewer at spec/plan/final) started; branches from main after #31 merges. Third flaky test added to F4.1: backend ai-step-concurrency.spec.ts "a live-refused claim that expires before inspection is deferred for fenced recovery" (failed on docs-only PR #31 CI, rerun requested).

- 2026-11-15 PO decision: F4.1 auth cover statement uses "Read, draft, and check Indonesian law in one quiet workspace." until F8; F8 brief must restore "Every answer names the article it rests on, so you can check it yourself." once citations ship.

- 2026-11-15 F4.1 progress: PR #33 (draft). Tasks 0-6 done (three flaky tests root-caused: lease race test-only fix; regenerate test clicked before finish; Checkpoint C theme hardened, cause unproven). Model switch at Task 7: Opus medium main, Sonnet high workers, no Opus reviewer; final whole-branch review done by this session. Check at review: Task 6 primary hover color change, Task 4A reused approval model. Candidate flaky tests for a later slice: ai-streams.spec.ts "a stale claim fence cannot publish after a newer claim", ai-execution.spec.ts "renews a short-lived claim while the context collector is delayed".

- 2026-11-15 PO decision (review cadence): layered review. (1) per-slice holistic review by this session before merge; (2) milestone audits by a fresh Claude Opus high audit session (prompt by this session, findings triaged here) after F4.1, F8, F13, F17, and before launch: security/RLS/authz, privacy, cross-agent consistency, duplication, test health; (3) human penetration test before real client data. First audit: after F4.1 merges, before F5. F4.1 mixes Codex (Sol manager + Luna workers) and Claude Code (Opus manager + Sonnet workers); Codex sandbox hit a Vite code.charCodeAt error, unit suite verified in owner terminal (118 files, 863 tests).

- 2026-11-16 F4.1 at Task 32A (0-31C done). Audit/F4.2 candidates: creating a team with an existing slug returns HTTP 500 instead of 4xx (product bug); chat-thread.spec.ts edit test (:358/:391) still flaky in CI; organizations.spec.ts:361 "Route is already handled" intermittent; desktop-light Security screenshot instability not reproduced (verify in Linux CI capture before goldens); E2E specs sharing fixed emails/slugs in the shared CI stack (now guarded by a script test).

- 2026-11-17 Audit 1 (PR #34, Claude Opus high, main F0-F4): 0 Critical, 4 Important (A-01 slug 500, A-02 error filter 500s, A-03 AUTH_TRUSTED_PROXIES unset -> shared rate-limit IP behind Caddy (verified), A-04 SSE revalidation 1 tx/s/stream on 5-conn auth pool, S2 used one session (verified)), 14 Minor, 6 Notes. Proposed F4.2 hardening after F4.1: A-01..A-05, A-10 (with A-02), A-16, A-17, A-19, A-22, chat client A-07..A-09 plus gap items G1-G7 (design-drafts/F4.2-behavior-gaps.md), flaky A-12..A-15, S2 re-qualification with distinct sessions (local Mac test:load:chat exits 1 on 7b736c3 while Linux CI load passed on all F4.1 runs; earlier local 'exit 0' claims were rtk summaries, unverified). Deferred: A-06/A-20/A-21 F20, A-23 F17, A-24 F18, A-11 opportunistic. Process risk: PO's rtk command hook can hide non-zero exit codes; CI is the trustworthy gate; ask agents to verify exit codes.

## Lessons learned (apply to every brief)

- F4.1 retrospective (2026-11-17): scope (44 tasks) and an over-strict visual requirement set by this brief (byte-identical goldens for every screen, both themes, both viewports, including animated mid-motion frames) caused most of the delay, on top of agent switches, quota limits, Mac disk/Docker, and the rtk hook. Future briefs: pixel goldens only for new or changed screens and key states; animations locked by SVG snapshot plus unit tests, never per pixel; strict byte gate Linux-only; locally run only affected E2E projects; full E2E in CI only. Add CI E2E sharding (2-3 parallel jobs) to F4.2. Trustworthy evidence is CI, not local summaries.

- Visual determinism (2026-11-16, F4.1): macOS Chromium varies a few pixels under suite load even on frozen pages, so goldens and the strict byte gate are Linux-only; Chromium on Linux rasterizes an animated SVG differently after the first screenshot of a frame (identical markup), fixed by a discarded warm-up screenshot before pinned pairs. Future briefs with animated visuals: Linux-only byte gate, element-level checks on macOS, warm-up before pinned captures, never pixel tolerance.

- Docker safety (2026-11-16, F4.1): a Claude Code worker ran `docker rm -f` on all containers and `docker volume prune -f` while clearing E2E stacks, deleting the PO's unrelated prospera-pg-dev container (data possibly in a leftover unnamed volume). Every future brief and implementer prompt must say: only touch containers/volumes named lexon-e2e-*, never prune, never remove all containers, stop and ask if disk or leftovers block a gate.

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

- F4.1 lessons (2026-11-19): (1) draw prototype states from the code and API contracts, never from memory (14.3 auth flows, 14.4 provisioning fields, 14.5 security rows were all wrong first); (2) a low pixel % is not correctness: review every sheet by eye, tooltips/icons/carets hide under 0.1%; (3) prototype layout bugs propagate 1:1 (sidebar padding): measure grid edges in the browser before publishing; (4) CI gate integrity: a job-level continue-on-error hid a failing load gate for weeks; every gate needs a guard against exit-code swallowing; (5) token budget: max 2-3 workers, low effort, round caps, read prototype.src.html not the 380 KB embedded file, open images only for failing sheets; (6) F4.2 task 1 cleans legacy visual sets (F2.1-visual, F4-visual, f2.1/f4 prototypes, lexon-2026 brand, rev-12 screens, committed compare sheets -> CI artifacts) with a guard test.
- F4.2 lessons (2026-11-21): (1) local Docker on the Mac renders differently from the CI runner (110 false diffs): golden and deviation decisions only from CI captures, downloaded and reviewed by the brief generator; (2) CI went red for 3 runs unnoticed: every report must state the CI result of its head; (3) load-test 'admitted' counts are not evidence: count open SSE server-side, use a fresh stack or prove slots are 0 before a phase; (4) subagents must be stopped when done; (5) agents re-approved hashes and ran extra smoke rounds against caps: restate caps as hard stops in every prompt.
- Carry to F20: burst p95 first frame 6.4 s and auth-pool wait p95 2.5 s at 384 MiB / 0.5 CPU (no threshold in F4.2); re-measure at production resources; ops.audit_events RLS is F17 (F4.2 decision 7).
- Carry to F4.3 brief: 'Create setup account' works only after hydration (pre-F4.2); auth-entry.spec.ts:48-58 screenshot fill not hydration-guarded.
- F4.3 lessons (2026-11-21):
  1. **Prototype state ids are locked to the capture index** (`prototype-state-ids.spec.mjs`). A prototype PR that adds or renames states must add them to `index.json` `planned` in the same PR, or main goes red (it happened with revision 15 in #47 and revision 16 in #50).
  2. **Docs-only PRs that touch `docs/references|design|brand` still run the full CI.**
  3. **Draw from the API contract first,** then the owner's references (Lexon v1 screenshots were used as inspiration, not copied).
  4. **Data views kit:**
     - one list page and one record page for every list or record;
     - record pages are one column so the edges line up (the owner disliked uneven two-column heights);
     - every action button carries an icon;
     - the floating action bar is always fixed at the bottom of the screen.
  5. **Re-check the ruleset;** merges slipped through three times.
