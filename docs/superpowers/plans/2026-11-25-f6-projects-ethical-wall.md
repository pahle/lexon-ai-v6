# F6 Projects & Ethical Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Matters (private-by-default projects with instructions and member roles viewer/editor + single owner), the ethical wall (org-owner/admin deny that overrides every role including the chat owner, plus a no-self-lift rule), read-only sharing of standalone chats, the `project-chat` run profile with the project context provider, and the revision-18 capture gate — under one access rule evaluated identically in the app predicate and in FORCE RLS.

**Architecture:** One `STABLE SECURITY DEFINER` `ops.lexon_project_access` (+ `lexon_project_denied`, `lexon_org_member`, `lexon_org_owner_admin`) evaluates project access; every policy and the app predicate call it — no policy reads `project_members`/`project_denies`/`projects`/`auth.member` directly, so no subquery-under-RLS flaw and no policy recursion. `chats_access_select` is disjoint by `project_id` (standalone: owner OR share; project: project access only — ownership conveys nothing). The RESTRICTIVE `*_owner_run` policies split per command: SELECT inherits the rule through RLS-filtered `EXISTS` on `chats`; writes stay `initiating_user_id` owner-only and intentionally fail for a denied owner — access-loss finalization runs inside definer primitives. `project_instructions` is its own table (no admin arm). Migration `0043` ships tables+definers+policies; `0044` ships the actor-facts extension and the access-loss finalizer; `0045` ships `ops.project_delete`.

**Tech Stack:** pnpm 10.33.1, NestJS 12, PostgreSQL 17 (raw-SQL migrations + `schema.ts`), BullMQ 6.5.3, Next.js 16.4.6, assistant-ui 0.15.33, Better Auth 1.7.14, Zod 4.6.7, TypeScript 6.0.3, Vitest 5.0.5, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-f6-projects-ethical-wall-design.md` (owner-approved through head `44b5bca0`; fixes: definer design, `project_instructions` table, disjoint owner arm, definer-executed finalization, self-lift, `SET NULL (project_id)`, share `:userId` route). Brief: `docs/briefs/F6-projects-ethical-wall.md` (decisions 1–9 settled). Each task cites spec sections and spec §20 research notes instead of repeating them. Executors read both documents first.

## Global Constraints

### Standing rules

- **Subagents:** Devin's built-in profiles only: explore for research/reading; general only for code changes and task reviews. No custom subagent files. Each parallel agent works in its own git worktree.
- **TDD with RED evidence for every task:** the failing command and its output before the change, and the passing run after. No production code without a failing test first.
- **Reviews:** a spec review and a quality review per task; the report lists every finding and how it was handled.
- **PR:** a draft PR from the first task. Every report lists every workflow run on its head with conclusion and URL, from `gh pr checks <n>` run once with its exit code. CI pending is not green.
- **Assertions:** never weaken a functional, accessibility or security assertion; log every changed assertion old → new. No retries, quarantine, skips, `test.fixme`, or longer timeouts without a proven cause.
- **At most 2 Linux UI rounds** for the revision-18 captures; owner eye-reviews CI sheets before any `approval.json` or golden writes.
- **Docker:** only touch containers and volumes named `lexon-e2e-*`, by explicit name filter. Never prune. Never touch unnamed volumes or `lexon-dev_*`.
- **Identity browser projects keep traces off** (F1 rule); local traces never uploaded or committed.
- **No K1 content** (names, matter numbers, instructions, titles, chat content) in logs, traces, errors, audit metadata, or `pg_notify` payloads (LEX-ARC-001 §6, spec §13). **No model names** in commits, PRs or repo files. Never force-push.
- **Clean room (AGENTS.md):** work only from `docs/` and the code; never read the `brief-generator` branch; never read, print or commit `.env` files or keys.
- **Session stats:** task 0 starts and ends with `/session-stats`; both outputs (cost by model) attach to its report.
- **Research first (AGENTS.md):** before each task, re-read the current official docs for the libraries it touches at the pinned versions and record them in the task's evidence (spec §20 already covers PG17 RLS/definers, Better Auth org plugin, Drizzle).
- **Full `pnpm test; echo exit=$?` and whole-repo `pnpm format:check; echo exit=$?` before every merge-back.**

### Caps and stop points

- **Stop and ask the owner** if: any golden or `approval.json` needs re-approval; official docs contradict `docs/specs/`; a contract change beyond the spec is needed; `lexon_project_access` per-row cost fails the §14 perf gate and the CTE fallback also fails; a write arm genuinely needs the chat read for finalization (spec §4.4 says it must not).
- Evidence file: `docs/references/F6-acceptance.md` — one short record per task (create in task 0).

### Branches and PRs

- Spec + plan ride PR #91 (`f6-projects`); it merges after the owner approves this plan. After it merges, `f6-projects` is **restarted from `origin/main`** and becomes the **integration branch** for the whole slice.
- **Do not merge task PRs into `main` one by one.** Every task branch `f6-t<N>-<slug>` is cut **from `f6-projects` and merges back into it** (each in its own worktree). There is **one PR to `main`, "F6 Projects & ethical wall", opened as a draft from task 0** (base `f6-projects` → `main`), which merges only after task 12.
- **Parallel tasks never touch the same file.** The chain 5→6→7→8 is sequential: `app.module.ts` registration, `audit-event.ts`, and service conventions are shared. Task 4 owns `run-events.service.ts`, `pg-notification-listener.ts`, capability/facts/finalization; tasks 5–8 call its `notifyAccessChanged` helper — so they run after 4.
- **Dependency order:** 0 is independent (parallel with 1–2 allowed). 1 ‖ 2. 3 after 1+2. 4 after 3. 5 after 4. 6 after 5. 7 after 5. 8 after 5. 9 after 5+6. 10 after 9. 11 after 4+5+6. 12 last, on a worktree branched from the merged integration head.
- **Migration numbers:** reserved at task start — `0043` (task 2), `0044` (task 4), `0045` (task 8). If a foreign migration lands first, renumber and say so in the report.

### Command conventions

- Backend unit: `pnpm vitest run --project backend-unit <file>; echo exit=$?`
- Backend integration **[Docker]**: `pnpm vitest run --project backend-integration <file>; echo exit=$?`
- Contracts: `pnpm vitest run --project contracts <file>; echo exit=$?`
- Frontend: `pnpm vitest run --project frontend <file>; echo exit=$?`
- Evals: `pnpm vitest run --project evals <file>; echo exit=$?`
- E2E **[Docker]**: `pnpm test:e2e --project=<project> <file>; echo exit=$?`
- Gate before each commit: `pnpm exec eslint <changed files>; echo exit=$?`, `pnpm --filter <pkg> typecheck; echo exit=$?` (or `pnpm typecheck` when `shared/` changed), `pnpm exec prettier --check <changed files>; echo exit=$?`, plus `drizzle-kit check` (or the house migration check) on migration tasks.

Markers: **[Docker]** needs local Docker. **[Linux]** needs CI evidence and counts against a cap.

## Review Focus

Failure modes the spec implies a lazy implementation can miss. Each has a test in its owning task.

1. **Deny > owner structurally.** A deny row inserted as migrator against a project owner must zero their rows on every table — the owner arm grants nothing on `project_id IS NOT NULL`. Task 2.
2. **Removed member ≠ denied member, same outcome.** Deleting a `project_members` row (no deny) must hide their own project chats too. Task 2.
3. **Policy subqueries never touch the project tables.** `project_denies`/`project_members`/`projects`/`auth.member` appear only inside definers; the DAG `ai_* → chat_runs → chats → {definers, chat_shares}` has no cycle. Task 2's spec asserts no recursion error.
4. **Instructions never reach admins.** No admin arm on `project_instructions`; org metadata list reads `projects` only. Tasks 2 and 6.
5. **Access-loss finalization commits under invisibility.** One `chat.run_finished.v1`, terminal reference, no retry storm — through definers, not `lexon_app` write arms. Task 4.
6. **Self-lift refused twice** — service and `lexon_project_deny_lift`. Task 6.
7. **`SET NULL (project_id)` actually applies** — project delete leaves zero live chats and tombstoned chats invisible to their owners. Task 8.
8. **Readers never see F5 panels** — operation payloads filtered from the snapshot for non-owner callers; "Waiting for <owner>" marker. Tasks 7 and 9.
9. **TenantGuard surface unchanged** — route-inventory test: every workspace route except the allowlist still rejects `userId`. Task 5.
10. **`notifyAccessChanged` targets never include denied users** for project chats (existence leak). Task 4.

---

### Task 0: F5 carry-over — four minors (independent; may parallel tasks 1–2)

Spec §2; evidence in spec table.

**Files:**

- Modify: `backend/src/modules/chat/expiry-sweep.ts` (use shared helper), `backend/src/modules/chat/step-coordinator.ts` (same helper), `frontend/src/lib/chat-stream.ts` (~line 627, keep reassembled input), `backend/test/e2e/chat-tools.spec.ts` (assert worker sweep return), `backend/test/e2e/thread-a11y.spec.tsx` (header citation → `captureBrandViews`/`runBrandAxe` in `brand-visual-support.ts`).
- Create: `backend/src/modules/chat/run-priority.ts` (or the house util location — one shared `isRouting`-style check: safe integer 1–10).
- Evidence: `docs/references/F6-acceptance.md` (create, `## Task 0`).

- [ ] **Step 0:** `/session-stats` (report only). Create worktree `../lexon-f6-t0` on branch `f6-t0-f5-carryover` **cut from `f6-projects`**; open the draft PR "F6 Projects & ethical wall" (base `f6-projects` → `main`).
- [ ] **Step 1: RED.** Integration: an expiry candidate with `priority: 1.5` / `0` / `NaN` is skipped + logged without K1 and not retried (extend `backend/test/integration/expiry-sweep.spec.ts` or the file that owns sweep candidates). Frontend unit: `tool-input-delta` chunks then a bare `tool-input-available` → emitted part keeps the reassembled input, not `{}` (extend the existing `chat-stream` spec). E2E: assert the worker sweep's return value in `chat-tools.spec.ts` (fails today — not inspected).
- [ ] **Step 2: GREEN.** Extract the helper, use it in both files, fix the `input` handling, add the E2E assertion, fix the a11y header comment.
- [ ] **Step 3: Gate + commit.** `feat(chat): F5 carry-over — shared priority check, tool input retention, sweep assertions`; push; report.

**Review focus:** identical priority rule in both call sites; the over-cap fallback still emits a `tool-input-available` (just with the real input); the header now cites the capture-harness axe, not `chat-accessibility.spec.ts`.

---

### Task 1: Shared contracts — projects, members, denies, shares, queries, enums (A, ‖ 2)

Spec §11; research notes: `shared/src/chat.ts`, `shared/src/organization.ts` current shapes.

**Files:**

- Create: `shared/src/projects.ts` — `ProjectCreateInput`, `ProjectSettingsInput`, `ProjectInstructionsInput` (≤8000 chars), `ProjectRoleSchema` (`'viewer'|'editor'`), `ProjectAccessSchema` (`'owner'|'editor'|'viewer'`), `MemberAddInput`, `MemberRoleInput`, `DenyAddInput`, `ShareAddInput` (`userIds` 1–50), `ProjectSummary`/`ProjectPage`/`OrgProjectSummary` (metadata only)/`ProjectMemberSummary`/`DenySummary`/`ChatShareSummary`, `MattersListQuery` (`filter: all|owned|shared`, `sort: name|activity`), `OrgProjectsQuery`, `OrgMemberSearchQuery` → `OrgMemberSummary`.
- Modify: `shared/src/chat.ts` (`ChatPage` item += optional `projectName`; `ChatAccessSchema` `'owner'|'reader'` + field on the chat detail payload), `shared/src/index.ts` exports.
- Test: contract spec for the new module (the repo's contracts test location for `chat.ts`-style specs).

**Interfaces produced:** every wire shape tasks 4–10 use.

- [ ] **Step 1: Failing tests** — schema spec: all inputs accept/reject per shape (8000-char boundary on instructions; `userIds` 1–50 bound; strictObject extras rejected); `ChatPage` item round-trips `projectName`; `ChatAccessSchema` accepts only `owner|reader`.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** + `pnpm typecheck` whole workspace (additive only).
- [ ] **Step 4: GREEN** → gate → commit `feat(shared): F6 project/share contracts`; push; draft PR.

**Review focus:** `strictObject` everywhere; no optional-that-should-be-required (`access` is required on the detail payload); `OrgProjectSummary` carries no `instructions`; error codes reuse the existing contract.

---

### Task 2: Migration `0043` — tables, definers, RLS, grants, indexes — RLS tests FIRST (A, ‖ 1)

Spec §3, §4.2–§4.4 (policies + recursion analysis + required RLS tests), §6 (RLS rows); research notes: PG17 RLS/RESTRICITIVE/definers, `ON DELETE SET NULL (col)`, 0026–0028 policy shapes, `psqlInTenant` precedent.

**Files:**

- Create: `backend/drizzle/0043_projects.sql` (+ `backend/drizzle/meta/` journal entry), `backend/test/integration/project-access-rls.spec.ts`, `backend/test/integration/chat-access-policy.spec.ts`.
- Modify: `backend/src/infrastructure/db/schema.ts` (5 new tables + `chats.project_id` + `chat_create_requests.project_id`).

**The migration contains:** `projects` (no instructions column), `project_members` (role viewer|editor only), `project_denies`, `project_instructions`, `chat_shares`; `chats.project_id` + `ON DELETE SET NULL (project_id)` composite FK + `chats_org_project` index; `chat_create_requests.project_id`; the §4.2 definer family (`lexon_project_access`, `lexon_project_denied`, `lexon_org_member`, `lexon_org_owner_admin`, `lexon_project_deny_add`, `lexon_project_deny_lift`) — all `STABLE`/`SECURITY DEFINER`, pinned `search_path`, `REVOKE … FROM PUBLIC, lexon_auth`, `GRANT EXECUTE … TO lexon_app`; all policy changes from §4.3 (chats select/insert gates, `chat_runs`/`chat_messages` splits, `ai_runs`/`ai_steps`/`ai_checkpoints`/`ai_operations` RESTRICTIVE splits — `ai_attempts` verified and split if it carries `*_owner_run`); triggers for `member_count`/`chat_count`/`last_activity_at` + `lexon_migrator` internal policies; grants per §4.3.

- [ ] **Step 1: Write the failing tests first — the §4.3/§6 RLS suite, before the migration exists.**
  - `project-access-rls.spec.ts` **[Docker]**, all as `lexon_app` via `psqlInTenant` (`set_config('app.org_id'/'app.user_id')`), never through a service:
    - denied editor and **denied project owner** (deny row inserted as migrator) get **zero rows** from `chats`, `chat_messages`, `chat_runs`, `ai_runs`, `ai_operations`, `projects`, `project_members`, `project_instructions`;
    - **removed member without deny** (delete their member row as migrator): own project chats vanish from `chats`/`chat_runs`/`ai_runs`;
    - org admin non-member: zero rows from `project_instructions`, sees the row in `projects` (metadata arm);
    - denied admin: `projects` row absent too (deny beats admin);
    - **no "infinite recursion" error** on any new-table SELECT;
    - `lexon_project_access` returns exactly one text column ∈ {owner,editor,viewer,none}; wrong `org_id`/`user_id` args → `'none'` (fail-closed);
    - `lexon_project_deny_add` refuses target = `projects.owner_user_id`; `lexon_project_deny_lift` refuses `actor = target`; ungranted role gets `permission denied for function`.
  - `chat-access-policy.spec.ts` **[Docker]**: project chat readable by member (viewer), not by non-member/denied; standalone chat readable by owner and share recipient; denied owner's **own** chat → zero rows; `chats` INSERT with `project_id` by a viewer/non-member/denied → RLS violation; INSERT by editor/owner → ok; `chat_runs`/`chat_messages` rows follow the parent chat's visibility; `ai_runs`/`ai_operations` rows visible to a member for a project chat's run (SELECT arm) but INSERT/UPDATE by non-initiator → RLS violation.
- [ ] **Step 2: RED** — run both specs → exit 1 (tables/functions/policies missing).
- [ ] **Step 3: Write migration `0043` + `schema.ts`** exactly per §3/§4.2/§4.3.
- [ ] **Step 4: GREEN** → exit 0. `drizzle-kit check` (or house equivalent) → exit 0.
- [ ] **Step 5: Gate + commit** `feat(db): projects, ethical wall and chat access policies (0043)`; push; draft PR.

**Interfaces produced:** the tables, definers, and policy arms every backend task uses.

**Review focus:** no policy reads `project_denies`/`project_members`/`projects`/`auth.member` directly (grep the file); the owner arm is disjoint by `project_id`; write arms keep `initiating_user_id`; every definer pins `search_path` and revokes PUBLIC/`lexon_auth`; `SET NULL (project_id)` column list; K1 columns absent from triggers/notify.

**Evidence:** RED/GREEN outputs; the migration file; `EXPLAIN`-free correctness proofs above (perf evidence is task 11's job).

---

### Task 3: Authorization predicate + repository widening + `access` field (B, after 1+2)

Spec §4.1, §5 (all rows), §6; research notes: `authorization-predicate.ts`, `chat-search.repository.ts`, `ai-run.repository.ts`, `ai-step.repository.ts` current shapes.

**Files:**

- Modify: `backend/src/infrastructure/db/authorization-predicate.ts` (new `ChatReadAuthorizationScope` + the `OwnedChat` owner-arm disjunction), `backend/src/infrastructure/db/chat-search.repository.ts` (`list` owner+project-access scope + `projects` join for `projectName`; `scope:'shared'` via `chat_shares` arm; `CHAT_SEARCH_SQL` CTE conjunct; `resolveMatch`), `backend/src/infrastructure/db/chat.repository.ts` (`readLive` full predicate; `lockLive`/`rename`/`selectLeaf` owner+access; `pg_notify` payload `{orgId,chatId}` — drops `userId`), `backend/src/infrastructure/db/ai-run.repository.ts` (`authorizedChatSnapshot` → read predicate), `backend/src/infrastructure/db/ai-step.repository.ts` (`streamActiveProof`/`streamTerminalProof`/`streamCommittedProof`/`streamRegistryState` → read predicate for viewer-level streams), `backend/src/infrastructure/db/pg-notification-listener.ts` (`ChatTitleNotificationSchema` without `userId`), `backend/src/modules/chat/chat.service.ts` / controller (detail payload gains `access:'owner'|'reader'`).
- Modify: `frontend/src/lib/chat-api.ts` (`ChatQueryScope` += `'shared'`; `chatListQueryKey` unchanged shape).
- Test: `backend/test/unit/authorization-predicate.spec.ts` (extend); `backend/test/integration/chat-read-access.spec.ts`; `backend/test/integration/chat-search-access.spec.ts`; contract spec update for the notify payload.

**Interfaces produced:** the single rule every service relies on; `access` on the chat detail payload; `scope=shared` list.

- [ ] **Step 1: Failing tests** — predicate unit tests for every arm (standalone owner/share; project viewer/editor/owner; denied; removed; non-org); integration: member opens project chat tree 200 (read-only data), non-member/denied → identical 404 bodies vs nonexistent id; denied owner → 404 on own project chat; FTS over denied owner's project chats → no hits; `resolveMatch` same; SSE proof functions accept viewer claims for project chats and reject denied/non-member.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** — all reads call the new builder / `ops.lexon_project_access`; no hand-rolled project EXISTS anywhere in repositories.
- [ ] **Step 4: GREEN** → gate → commit `feat(chat): one access rule across read paths`; push; draft PR.

**Review focus:** no read path bypasses the builder (grep for hand-written `project_`/`chat_shares` EXISTS in `src/`); the `OwnedChat` disjunction is exactly `project_id IS NULL OR lexon_project_access<>'none'`; notify payload is content-free `{orgId,chatId}`; identical-404 bodies byte-compared in tests.

---

### Task 4: `project-chat` profile + project context + capability gate + migration `0044` + SSE/notify fan-out (B, after 3)

Spec §4.4, §5 rows 10–14/16, §9; research notes: `chat-profiles.ts`, `chat-history-context.ts` (`ContextProvider` shape), `run-registry.ts`, `capability-policy.ts`, `run-events.service.ts`, `chat-runtime.providers.ts`, F4 R26 finalizer precedent.

**Files:**

- Create: `backend/drizzle/0044_project_actor_facts.sql` (extend `auth.lexon_ai_actor_facts` → `projectId`, `ownerProjectRole`, `ownerDenied`; add the access-loss finalization primitive — extend the F4 expected-state finalizer or add `ops.lexon_ai_finalize_access_loss`, returning ids/status only), `backend/src/modules/chat/project-context.ts` (`ProjectContextProvider`), `backend/test/integration/project-access-loss.spec.ts`, `backend/test/integration/project-context.spec.ts`.
- Modify: `backend/src/modules/chat/chat-profiles.ts` (`CHAT_PROFILES['project-chat']` — same engines/tools/limits as `chat` + `project` context entry; budget per provider table), `backend/src/modules/chat/run-registry.ts` (registration entry if the registry table is per-profile), `backend/src/modules/chat/chat-runtime.providers.ts` (`createProductionRunRegistry([history, project])`), `backend/src/modules/chat/capability-policy.ts` (project-chat rule: `ownerProjectRole IN ('owner','editor') AND NOT ownerDenied` else `AI_ACCESS_REVOKED`), `backend/src/infrastructure/db/run-actor-facts.repository.ts` (new fields), `backend/src/modules/chat/run.service.ts` + `approval.service.ts` + `cancel.service.ts` (route the access-loss write path through the finalizer definer — `runs.transition`, `rejectApprovalForAccessLoss`, audit appends, `terminalStreamReference` execute as definer calls, not claim-scoped repository calls), `backend/src/modules/chat/run-events.service.ts` (title fan-out: `{orgId,chatId}` → per-connected-user evaluation via the predicate; new `notifyAccessChanged(userIds, chatId|null)` helper for tasks 5–8; viewers' streams replay identically), `backend/src/modules/chat/chat.service.ts` (`profileId='project-chat'` when `chats.project_id` set), snapshot serialization (operation payloads filtered for non-owner callers).
- `ops.ai_mark_chat_deleted` gains the project-access clause (in `0044` or its own definer ALTER — plan decides which file carries it; it is a definer change, so it rides the migration).

**Interfaces produced:** `project-chat` profile; `notifyAccessChanged` helper; definer-executed access-loss path.

- [ ] **Step 1: Failing tests** — `project-context.spec.ts` **[Docker]**: a project-chat run's collected context contains project name+instructions as untrusted pieces within budget, none for standalone runs; profile resolution picks `project-chat` by `chats.project_id` with zero engine branches (assert no `project` params reach the engine). `project-access-loss.spec.ts` **[Docker]**: (a) deny the chat owner mid-run → run `failed`/`AI_ACCESS_REVOKED`, **exactly one** `chat.run_finished.v1`, terminal stream reference produced, no retry/error loop (worker log assertion); (b) member removed without deny → identical finalization; (c) a viewer opens a running project chat — replay identical to owner's, operation payloads absent from their snapshot, "Waiting for <owner>" marker data; (d) `chat.invalidated` reaches the removed member and the remaining members, and **never** a denied user for that chat. `ops.ai_mark_chat_deleted` refuses on a denied owner's project chat.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Migration `0044` + code.** Capability recompute verified at start and resume phases (facts carry the new fields).
- [ ] **Step 4: GREEN** → gate → commit `feat(ai): project-chat profile, project context and access-loss finalization (0044)`; push; draft PR.

**Review focus:** definer returns ids/status only (K3); the finalization path never widens a read policy; `notifyAccessChanged` excludes denied users; the run-facts extension doesn't leak names — `ownerProjectRole`/`ownerDenied` only.

---

### Task 5: Projects module — CRUD, instructions, members, TenantGuard allowance, audit events (C, after 4)

Spec §3, §7, §11–§13, §15; research notes: `membership.service.ts` pattern, `tenant.guard.ts` `ROUTE_ACCESS`, `audit-event.ts` unions.

**Files:**

- Create: `backend/src/modules/projects/` — `projects.module.ts`, `projects.controller.ts` (CRUD + `/projects/:id/chats` + `PATCH /projects/:id/instructions` + `GET /projects` list incl. `sort=activity&limit=5`), `project-members.controller.ts` (`GET/POST /projects/:id/members`, `PATCH/DELETE /projects/:id/members/:userId`), `projects.service.ts`, `project.repository.ts`, `backend/test/integration/projects.spec.ts`, `backend/test/integration/project-members.spec.ts`, `backend/test/integration/tenant-guard-routes.spec.ts` (route inventory).
- Modify: `backend/src/modules/identity-access/tenant.guard.ts` (opt-in `allowUserIdKey`-style metadata on the two body-carrying member/share routes), `backend/src/modules/audit/audit-event.ts` (**all** F6 event schemas+validator — single owner: project.created/settings_updated/instructions_updated/deleted, member_added/role_changed/removed, deny_added/deny_lifted, chat.shared/share_revoked), `app.module.ts` (module registration), `backend/src/modules/organizations/membership.controller.ts` (+ `GET /org/members/search` via `OrganizationAuthPort`/`listMembers` name/email search).
- Service invariants: create → creator becomes `owner_user_id`; members add/change/remove = project owner only; target must be org member AND not denied (`ops.lexon_project_denied`); member mutations emit `notifyAccessChanged`; audit emitters in the same tx; all 404s identical to nonexistent.

- [ ] **Step 1: Failing tests** — `projects.spec.ts` **[Docker]**: create/list/detail/update/delete shapes, role-gated fields (viewer gets 403 on instructions-update, non-member gets 404), `PATCH /projects/:id/instructions` owner+editor ok/viewer 403/non-member 404; the identical-404 triple (nonexistent/non-member/denied) on every project read route. `project-members.spec.ts`: add/role/remove flows; denied target refused at service + RLS; target not org member refused; member mutations emit `chat.invalidated` to the target. `tenant-guard-routes.spec.ts`: every registered workspace route rejects `{userId}` except the documented allowlist; the allowed routes accept a valid org member and refuse a non-member.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** module + guard metadata + audit contract + emits.
- [ ] **Step 4: GREEN** → gate → commit `feat(projects): Matters CRUD, members and TenantGuard allowance`; push; draft PR.

**Review focus:** editors can't touch `projects` columns (owner-only UPDATE policy + service); audit emits contain ids/roles only (K3); `OrgMemberSearchQuery` returns members (names via port — never `auth.member` joins in app code); the guard change is keyed to exact routes.

---

### Task 6: Ethical wall — org metadata list + deny add/lift + API deny matrix (C, after 5)

Spec §4.2 (deny definers), §6 (full matrix), §13, §15.

**Files:**

- Create: `backend/src/modules/projects/org-projects.controller.ts` (`GET /org/projects` metadata list + `GET/POST/DELETE /org/projects/:id/denies`), `backend/test/integration/ethical-wall.spec.ts`.
- Modify: `backend/src/modules/projects/projects.service.ts` (deny service wrapping the definers; emits `notifyAccessChanged` to denied/lifted users and project members; audits `project.deny_added/deny_lifted` + `project.member_removed` reason `deny`), `app.module.ts` if a second module file is introduced.

- [ ] **Step 1: Failing tests** — `ethical-wall.spec.ts` **[Docker]**: metadata list shows name/matter number/practice area/owner/member count — never instructions; deny-add removes the member row in the same tx and emits the right audits; denied member → identical 404s on **every** §6 path (project page, chats list, members, instructions, chat detail/tree, FTS, Recent, SSE replay+live, share lists, metadata list for a denied admin); deny of the project owner refused (service + definer); **self-deny allowed, self-lift refused** — second admin lifts (integration over the definer); concurrent deny+lift → last commit wins, no duplicate rows, both audited; project owner's re-add attempt shows the target "unavailable".
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** controllers/services on the §4.2 definers.
- [ ] **Step 4: GREEN** → gate → commit `feat(projects): ethical wall — metadata list and deny management`; push; draft PR.

**Review focus:** the deny matrix's identical-404 assertions are byte-compared; metadata list fields verified against the contract; the two audits on deny-with-member-removal; no route leaks the deny list to non-admins.

---

### Task 7: Chat sharing — shares endpoints + shared-with-me + recipient data (C, after 5)

Spec §3.5, §5 rows 2/5, §10–§12, §15; research notes: `chat.service.ts`, `chat.controller.ts` current shapes.

**Files:**

- Create: `backend/src/modules/chat/chat-shares.controller.ts` (`GET/POST /chats/:id/shares`, `DELETE /chats/:id/shares/:userId`), `backend/test/integration/chat-shares.spec.ts`.
- Modify: `backend/src/modules/chat/chat.service.ts` (share service: owner+standalone-chat only; targets = org members; revoke; `notifyAccessChanged` on add/revoke; audits `chat.shared/share_revoked`), `backend/src/modules/chat/chat-search.service.ts` or controller (`GET /chats?scope=shared` → the `chat_shares` arm), chat detail payload's `access` consumed by the recipient view (`'reader'` for share recipients and non-owner project members).

- [ ] **Step 1: Failing tests** — add/list/revoke flows; share on a project chat refused; share to a non-org-member refused; recipient sees the tree read-only with `access:'reader'` and no pending-operation payloads; revoke → next request 404 + open stream closes ≤5 s; shared-with-me list shape; recipient leaving the org → access ends.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN** → gate → commit `feat(chat): read-only chat sharing`; push; draft PR.

**Review focus:** shares never honor project chats (predicate arm + service both refuse); recipient stream revalidation actually fires ≤ `REVALIDATION_INTERVAL_MS`; no share payload leaks member names beyond the owner's own list view.

---

### Task 8: Project deletion — `0045` `ops.project_delete` + endpoint + deletion tests (C, after 5)

Spec §3.6, §8, §13, §15; research notes: F4 deletion fence (`ops.ai_mark_chat_deleted`), deletion service, cascade semantics.

**Files:**

- Create: `backend/drizzle/0045_project_delete.sql` (`ops.project_delete` SECURITY DEFINER: verify `projects.owner_user_id` = caller, lock project, mark every project chat `deleted_at` with per-chat outbox/notify records, delete `projects` row), `backend/test/integration/project-delete.spec.ts`.
- Modify: `backend/src/modules/projects/projects.service.ts` + controller (`DELETE /projects/:id` returns/requires the `chatCount` confirmation contract), `backend/src/modules/chat/chat.service.ts` only if the per-chat delete path needs a shared helper (re-read after task 3 merge).

- [ ] **Step 1: Failing tests** — delete refuses for non-owner (404) and editor/viewer members (403); confirmation contract carries `chatCount`; after delete: project 404s for everyone incl. owner; **zero chats with `deleted_at IS NULL` that belonged to the project** and `project_id IS NULL` on the tombstones (`SET NULL (project_id)` verified); members' own tombstoned chats invisible to them on every read path; a chat with an active run is fenced then wound down exactly like F4 single-chat delete; `project.deleted.v1` audit has `chatCount`, ids only.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Migration `0045` + service/endpoint.**
- [ ] **Step 4: GREEN** → gate → commit `feat(projects): project deletion via tombstone definer (0045)`; push; draft PR.

**Review focus:** the definer can't be called by non-owner (in-function check); notify/outbox records per chat are identical in shape to F4 delete; no hard-delete shortcut — the existing sweep finishes the job.

---

### Task 9: Frontend — Matters UI (D, after 5+6)

Spec §11, §16, §17; research notes: LEX-DS-001 §5.7 data views kit, `app-sidebar.tsx`, `chat-history.tsx` scope plumbing, prototype r14 `matter-*`/`matters-*`/`settings-matters*` screens.

**Files:**

- Create: `frontend/src/app/(workspace)/matters/page.tsx`, `frontend/src/app/(workspace)/matters/[id]/page.tsx`, `frontend/src/components/matters/` (list built from the data views kit, project page header + chats list + instructions panel, new-matter dialog, members dialog with restricted-member state, delete confirmation naming `chatCount`, instructions editor with char counter), `frontend/src/lib/matters-api.ts`.
- Modify: `frontend/src/components/shell/app-sidebar.tsx` (Matters group: 5 most recent + "View all matters"), `frontend/src/lib/chat-api.ts` (only if the scope/type additions from task 3 need client-facing helpers — re-read post-merge), settings dialog (Matters tab skeleton for task 10's restrict UI — or keep tab inside task 10; decide by file ownership: the settings Matters tab is task 10's, task 9 must not touch it).

- [ ] **Step 1: Failing tests** — component/unit specs per existing frontend conventions (list renders role columns + filter/sort/pagination; project page renders composer only for owner/editor, instructions read-only for viewer; members dialog shows restricted member as "Access restricted by your organization"; empty state → new-matter dialog; delete dialog names the count). E2E where the infra exists: create matter → appears in sidebar group.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** matching prototype r14 exactly.
- [ ] **Step 4: GREEN** → gate → commit `feat(matters): Matters pages, members and instructions UI`; push; draft PR.

**Review focus:** personal workspace hides member controls; 404s route to the not-found state; no permission decisions client-side beyond hiding (server still enforces); keyboard operability of dialogs.

---

### Task 10: Frontend — sharing, settings→Matters, read-only views (D, after 7+9)

Spec §10, §16; research notes: `chat-view.tsx`, settings dialog structure, prototype `chat-share`, `chat-shared-readonly`, `chats-shared`, `settings-matters`, `settings-matters-restrict`, `matter-chat-readonly`.

**Files:**

- Create: `frontend/src/components/chat/chat-share-dialog.tsx` (member picker via `/org/members/search`, current-access list, revoke), `frontend/src/components/settings/settings-matters.tsx` (org metadata table + restrict dialog + deny list management), shared read-only chrome (label "Shared by <name> · read-only").
- Modify: `frontend/src/components/chat/chat-view.tsx` (`access:'reader'` → no composer/edit/regenerate/feedback/rename/delete/decision controls; pending-operation panels hidden; "Waiting for <owner>" marker; read-only on project chats for non-owners), `frontend/src/app/(workspace)/chats/page.tsx` ("Shared with me" filter → `scope=shared`), `frontend/src/components/chat/chat-history.tsx` (filter UI only — scope plumbing exists), chat menu (share action on standalone chats, hidden on project chats/personal workspace).

- [ ] **Step 1: Failing tests** — component specs: recipient view has no composer or decision controls and shows the label; Chats page shared filter calls `scope=shared`; settings-matters table renders metadata only and restrict dialog lists org members; a denied admin sees the project absent; share dialog hidden on project chats.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** matching prototype r14 exactly.
- [ ] **Step 4: GREEN** → gate → commit `feat(chat): share dialog, read-only views and settings Matters`; push; draft PR.

**Review focus:** readers can't reach decision endpoints even if the DOM is forced (server 403/404 verified by task 7's tests — this task asserts UI state only); the "Waiting for <owner>" marker names resolve via member summaries.

---

### Task 11: Performance gate + prompt-injection evals (E, after 4+5+6)

Spec §14, §15 (injection), §20; research notes: `testing/chat-search-benchmark.ts`, F4 gate jsonl shape, `evals/test/injection-tools.spec.ts`.

**Files:**

- Create: `backend/testing/project-list-benchmark.ts` (seed 500 projects/50 members; `EXPLAIN (ANALYZE)` artifacts; p95 wall-clock under CI runner), `evals/test/project-instructions.spec.ts`, `docs/references/F6-list-gate-<date>.jsonl`.
- Modify: `evals/src/real-evals.ts` / `backend/src/evaluation/index.ts` (register the new scenarioIds — an unlisted id must fail loudly), CI workflow hook if the gate runs in CI (check how the F4 gate is wired first).

- [ ] **Step 1: Failing tests** — the gate script asserts index plans (no seq scans on `project_members`/`project_denies`; `chats_owner_activity`/project indexes used) and p95 < 1000 ms blocking / >300 ms warning; evals: instructions that try to rename the chat without approval, reveal another project's content, or claim extra permissions — all no-ops (RED proves they reach the context, not that they fail — the assertion is "no effect").
- [ ] **Step 2: RED** → exit 1 (no benchmark/evidence yet).
- [ ] **Step 3: Implement** the benchmark + eval scenarios; run the gate; if per-row definer cost fails, apply the §14 CTE fallback with measured before/after.
- [ ] **Step 4: GREEN** → attach `EXPLAIN` artifacts + jsonl → commit `test(projects): list perf gate and instruction-injection evals`; push; draft PR.

**Review focus:** seeds are realistic (500/50, mixed deny/member density); the gate's plan-shape assertion is on the RLS-enabled plan (not superuser); eval fixtures assert the pieces actually rendered into context.

---

### Task 12: Visual captures + accessibility + acceptance sweep (last)

Spec §17, §15 (a11y); research notes: `captureBrandViews`/`brandAxeTags` in `brand-visual-support.ts`, `index.json` planned→pending convention, F4.1-visual workflow.

**Files:**

- Modify: `docs/references/F4.1-visual/index.json` (16 Matters ids `planned` → `pending` on first capture), capture specs under `backend/test/e2e/` for the new states (matters-list, matters-empty, matter-new, matter-owner, matter-viewer, matter-instructions-edit, matter-members, matter-delete, matter-chat, matter-chat-readonly, settings-matters, settings-matters-restrict, chat-share, chat-shared-readonly, chats-shared, matter-personal — both viewports, both themes), `docs/references/F6-acceptance.md` (final records).
- Create: any new capture-support hooks the states need (members dialog seeded with a restricted member, etc.).

- [ ] **Step 1:** capture all 64 variants on Linux CI (first capture flips ids `planned`→`pending`); **owner eye-reviews the CI sheets before any `approval.json` or golden writes** — stop point.
- [ ] **Step 2:** at most 2 Linux UI rounds; masks for animated parts per house convention; 1.5% gate.
- [ ] **Step 3: a11y** — axe on every new capture in both themes (the `captureBrandViews` `axe` option does this); keyboard-operability specs for dialogs/tables.
- [ ] **Step 4: acceptance sweep** — full `pnpm test; echo exit=$?` + whole-repo `pnpm format:check; echo exit=$?` on the integration head; every workflow run listed with conclusion+URL; `F6-acceptance.md` completed; all F0–F5 tests still green.
- [ ] **Step 5:** final draft-PR report; stop for the owner to flip the one PR to `main`.

**Review focus:** `pending` only after first capture; no golden writes without owner eyes; new flake recorded with run URL, not retried; every spec acceptance item ticked with evidence.
