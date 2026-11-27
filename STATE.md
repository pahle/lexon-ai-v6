# Project state

Last updated: 2026-11-25 by the brief generator.

## Next action

**2026-11-26 (F6 minors closed):** implementer logged all three batch-review notes in spec §23 "Deviation log" (b8904025, docs-only, verified). Invariant argument sound: ops persist only inside step-coordinator.commit()'s tx (step leaves 'claimed' in the same tx), so `s.sequence < input_sequence` is complete; decide/expire settle the whole run anyway (`o.id <> op_row.id`). Share-survives-owner-departure recorded as intended. DISTINCT dedupe accepted-not-applied. No code changes. Still open: #92 head red on compose-e2e 2/3 (chat-thread anchor-selection-after-reload) — batch 3 waits on triage.

**2026-11-26 (F6 batch 1+2 diff review DONE):** owner confirmed the two fix batches were implementer self-review, so I reviewed `main..origin/f6-projects` myself (9 migrations + predicate/guard/services). **Verdict: approved.** Verified: deny beats owner at every layer (definer order + disjoint chats_access_select); policy DAG acyclic (chats->chat_shares only; project tables only inside definers); no admin arm on project_instructions; write arms keep initiating_user_id/owner; access-loss settle definers require access actually lost (no false AI_ACCESS_REVOKED) + idempotent decide; self-lift refused twice (service + definer constraint); project_delete claims-bound owner-only definer w/ tombstone cascade; project_id immutable via column-grant exclusion + bind-once trigger; TenantGuard allowlist = exactly POST /projects/:id/members + POST /org/projects/:id/denies (per-method metadata, body-only, inventory test); audience fan-out once per notification via access_for (service-claims only after 0051; denied/removed excluded); readerView strips op payloads on snapshot + live frames; audit validator ids-only; deny_add DO NOTHING idempotent; claim-lane lock_timeout 5s + pg_blocking_pids monitor. Minors sent to implementer: (1) access-loss settle only covers ops on EARLIER steps — confirm the invariant that a pending/claimed step never holds an outstanding op (same shape as deleted-chat family); (2) standalone shares outlive owner org-removal — intended? record as decision; (3) notify loop in access-loss definers emits one pg_notify per chat_run row — DISTINCT chat_id would dedupe. #92 head 6990510c red on compose-e2e 2/3 (chat-thread anchor-selection-after-reload) — triage before batch 3 continues.

**2026-11-26 (F6 execution deep in flight):** #91 (F6 spec+plan) squash-merged as 328cbbea after my 3 corrections landed (72a4f88a: TenantGuard allowlist = POST /projects/:id/members + POST /org/projects/:id/denies only; f6-projects restart via `git switch -C f6-projects origin/main && git merge -s ours` — executed as 327ba3d3; batches 0-4 / 5-8 / 9-11 / 12 with per-task merge gate). Two extra fixes: 3aa797fe Prettier, 937bfe5c PROTOTYPE_REVISION pin 17->18 (required because the PR bumps the README lead line to revision 18; spec asserts pin == max README revision). Execution did NOT wait for my batch reviews to be recorded here: tasks 0-4 merged (#93-#98, incl. #97 decide/send 40P01 fix), fix batch 1 #99 (notification audience-once, batch commit authorization, lock order), tasks 5-8 #100, fix batch 2 #101 (service-claims oracle -> migration 0051, deny audit once, 5s claim-lane lock_timeout + pg_blocking_pids monitor). Integration PR #92 (f6-projects -> main, 18 commits). Currently task 9 Matters UI = PR #102 (draft, base f6-projects). **#92 head 6990510c is RED: compose-e2e (2/3) failed on chat-thread anchor-selection-after-reload (chat-browser); everything else green.** Open: who reviewed batches 1-2 (fix batches suggest numbered findings; not recorded in STATE) and whether the red is a known flake or F6 regression — owner to relay the session's report.

**2026-11-25 (F6 plan): PR #91 (spec + plan, head 834348da, CI pending at review). Spec reviews: round 1 Critical = policy subqueries on RLS'd project_denies/project_members (deny never applied + projects<->members recursion) -> definer ops.lexon_project_access; instructions moved to app.project_instructions (admin leak); no self-lift; SET NULL (project_id); share route :userId. Round 2 Critical = owner arm bypassed deny on project chats -> disjoint owner arm; access-loss finalization via definer. Plan approved with 3 corrections sent: TenantGuard allowance = POST members + POST denies only (guard rejects only `userId`; shares use userIds); restart f6-projects with merge -s ours; batches 0-4 / 5-8 / 9-11 / 12 (stop after each). Execution prompt (fresh session) given for after #91 merges. Next: review batch 1 diff myself (0043 migration, RLS, predicate, 0044 finalizer).**

**2026-11-25 (F6 planning): #90 merged by owner (790b61a2); remote branches = main + brief-generator. Local cleanup verified: worktrees lexon-ai-v6 (main b333477f, needs pull), lexon-brief-generator, lexon-docs; no lexon-e2e containers; F5 ledger moved to lexon-ai-v6/.superpowers/sdd. F6 planning prompt given: spec docs/superpowers/specs/2026-11-25-f6-projects-ethical-wall-design.md, plan docs/superpowers/plans/2026-11-25-f6-projects-ethical-wall.md, branch f6-projects (integration, task branches into it). Stops: spec, plan. Review focus: single access rule + RLS widening of chat reads (writes owner-only), deny matrix on every read path incl. streams/run context, TenantGuard narrow allowance, project-chat profile via registry, perf gate, PROTOTYPE_REVISION 17->18 in slice.**

**2026-11-25 (F6 prototype): owner approved revision 18 (16 states x 4 variants) by eye. PR #90 (ready, branch f6-prototype-r18): prototype src/html, 64 PNGs, index.json planned (+16 ids), README revision 18 section (lead line and PROTOTYPE_REVISION stay 17 until the slice captures, r17 precedent), state-ids spec regex for the Matters row, LEX-DS-001 v3.6 (sidebar Matters, Settings -> Matters, §5.8 Matters patterns). Review branch review/f6-proto-r18 deleted. Owner asked: files in matters -> F7, retrieval F8, memory -> F9, workflows F10, tabular F13. Next: owner merges #90 when CI green; then I give the F6 planning prompt.**

**2026-11-25 (F6 brief): draft PR #89 (docs/briefs/F6-projects-ethical-wall.md + LEX-ARC-001 v1.8 §3.2 + README row). Owner decisions 2026-11-25: (1) private by default, explicit membership only (ARC "configurable per org" deferred); (2) roles Viewer/Editor, creator = single owner, transfer F18; (3) deny set/lifted only by org owner/admin, locked against the project owner, owner cannot be denied, admins see project metadata only; (4) no break-glass in F6 (F18); (5) standalone chats shareable read-only within the org; (6) fields like the reference (name, matter number, practice area) + instructions (plain text, 8,000 chars, untrusted context provider); (7) chats bound to a project at creation, no moving; (8) delete project cascades chats (owner, F4 fence); (9) F5 minors = task 0. My own design calls in the brief (owner may revise): project chats owned by their creator, members read them; UI label "Matters" (LEX-DS-001 §4), code entity "project"; readers never see F5 panels. Next: owner reviews/merges #89; then I draw prototype revision 18 (states listed in the brief) for approval before planning; then the planning prompt. Notes: notes/F6-projects.md. Local implementer cleanup prompt given (12 F5 worktrees, branches, stack lexon-e2e-0444100d3262e160); awaiting report.**

**2026-11-25: F5 COMPLETE. PR #76 squash-merged by me on owner instruction (b333477f) after gh pr checks 76 exit 0 on bd9e13fd. Review: reviews/F5-review.md (4 deferred minors). Remote branches deleted on owner instruction: all f5-* (incl. f5-tools-approvals) and review/f5-visual-r3; remote = main + brief-generator. Local implementer worktrees (../lexon-f5-*) still exist; implementer removes them at the start of the next slice. Next: owner picks the next slice (F6 per roadmap); I ask scope questions and write the brief.**

**2026-11-24 (F5 decision 8, during execution): owner asked where Mike's clarifying questions come from (answer: model's general knowledge + a generic system-prompt rule; domain checklists only via workflows/templates -> Lexon F10). Owner approved three question kinds (single, multiple = select all that apply, text only) and 1-5 questions per call; document questions -> F7. PR #77 (docs): brief decision 8, LEX-DS-001 v3.5, prototype r17 + chat-question-text / chat-question-select (8 PNGs, 60 planned views), spec deviation 2, plan counts. Implementer must hold before task 2 until #77 merges, then merge main into f5-tools-approvals.**

**2026-11-24 (F5 plan approved): PR #75 head 1f808dc0, CI all green; every missing path in the plan is a Create entry (checked by script). Owner merges #75, then starts the execution session with the prompt given today (integration branch f5-tools-approvals restarted from origin/main + `git merge -s ours` old tip, no force-push; stop after every task for my diff review).**

**2026-11-24 (F5 plan review, PR #75 head c64cc629, CI all green): spec approved (fix 3 corrected to lexon_app). Plan findings sent: (1) wrong paths - migrations are backend/drizzle/ (not backend/src/infrastructure/db/migrations), audit-event.ts is backend/src/modules/audit/, run-contracts.ts is backend/src/modules/chat/, tool registry is backend/src/modules/chat/run-registry.ts (shared/src/tool-registry.ts does not exist - create only for Zod schemas), chat-stream.ts is frontend/src/lib/, E2E/brand-visual specs are backend/test/e2e/; (2) one PR per task merging to main would ship tools on chat profiles (task 4) before the UI (task 7) - use one integration branch f5-tools-approvals with task branches merged into it, one PR to main at the end; (3) deps: task 6 after 4; task 7 after 4 and 5; no two parallel tasks touch the same file; (4) task 10 E2E are acceptance tests - no fake RED; expiry E2E via a test-side DB update, no product knob; (5) /session-stats output in the report only, never in repo files (model names).**

**2026-11-24 (F5 spec re-review, head 21414703): fixes 1,2,4,5,6,7 OK. Fix 3 is wrong as written: there is no worker DB role - LEX-ARC-001 line 184 says lexon_app serves API, AI Worker, Document Worker and Outbox Dispatcher. "Grant to worker role only / API-role denial test" is impossible without an ARC revision. Ruling sent: GRANT EXECUTE TO lexon_app (as 0018 does), REVOKE PUBLIC, pinned search_path, ids only; tests: lexon_auth, lexon_setup and PUBLIC cannot execute, output columns are ids only. No new role. After that: spec approved, implementer writes the plan.**

**2026-11-24 (F5 spec review): PR #75 head spec docs/superpowers/specs/2026-11-24-f5-tools-approvals-design.md. Owner ruled send-while-paused option A + 5 conditions (in spec §3/§6.4). Verified: ARC line 487 lists awaiting_approval -> completed; AI_EVENT_BYTES pinned 4096 (ai-config.ts:33,84). Findings sent as one fix prompt: (1) max ask_user input (3 x (300 + 5 x (80+140)) = 4200 chars) exceeds the 4096-byte event cap for approval/question-required, tool-input-available and snapshot frames -> define over-cap fallback (omit summary, client fetches tree), test with max multibyte payload; no change to brief limits or AI_EVENT_BYTES; (2) sweep poison when the initiator is deactivated/removed -> expire via access-loss path, batch continues; (3) ai_expired_operations hardening: REVOKE PUBLIC, grant worker role only, pinned search_path, ids only, test API role cannot call; drop the "caller-visible under tenant context" claim; (4) audit validator lives in 0042 (task 1) but task 7 is separate while tasks 5/6 emit new events -> fold into task 1; (5) state the user-visible surface at AI_ITERATION_LIMIT with maxIterations 6; (6) client renders the stored outcome when the idempotent route returns a different decision (two tabs). #74 (F5 brief sync) still open - owner to merge.**

**2026-11-24 (F5 planning start): PR #74 (docs) syncs the F5 brief before planning: failed tool row red per decision 7 (item 1 said muted), Depends on F4.5, acceptance F0-F4.5, README row "approval panel above the composer". Owner merges #74, then starts the F5 planning session with the prompt given today: brainstorming -> design spec (stop for owner) -> plan (stop for owner) -> execution in a fresh session. Spec/plan paths: docs/superpowers/specs/<date>-f5-tools-approvals-design.md, docs/superpowers/plans/<date>-f5-tools-approvals.md. Visual: rev 17 states in docs/references/F4.1-visual/index.json planned + prototype.html.**

**2026-11-24 (cleanup before F5): owner merged #72 (F4.5) and #73. F4.5 COMPLETE. Cleaned: kept stack lexon-e2e-f45510-3 torn down via visual-capture-stack.mjs down (0 lexon-e2e-* containers/volumes left); worktree ../lexon-f45-flakes removed; 21 local branches deleted (all had merged PRs, no commits after the merged head except f4.4-deps 6c0a6f1b, carried by #69); remote branches f4.2-hardening, f4.4-deps, f4.4-hardening deleted. Now: remote = main + brief-generator; local = main + brief-generator; worktrees = lexon-ai-v6 (shared, detached at old b2a70eb2, 15 untracked .claude/skills symlinks, untouched), lexon-brief-generator, lexon-docs (detached at origin/main). Next: F5 planning prompt.**

**2026-11-24 (F4.5 STOP C review): PR #72 ready, head e5d2d0e5 (docs-only delta from 6dd09c1c). Verified myself: flake-round 45339579872 logs - 40x "1 passed" for the two Playwright legs, 20x "2 passed | 12 skipped" for ai-cancel; load run 2 45341825270 artifact ramp 500/500 p95 126 ms/53, burst 500/500 p95 1802 ms/262 (stressed band, zero early closes). No skip/only/console/.superpowers in diff; branch contains main. CI on e5d2d0e5: all pass except compose-e2e 3/3 pending at check. #73 green. Verdict: merge #72 when compose-e2e 3/3 is green, then #73. Next: F5 planning prompt. Carry-overs: organizations.spec.ts:244 axe empty-heading flake (possible product a11y); item 4 ramp-peak cause unreproduced (counters now complete); kept local stack lexon-e2e-f45510-3 to tear down.**

**2026-11-24 (F4.5 STOP B review): head 6dd09c1c. Revert of trace verified byte-identical to base; end-rendezvous pairing (close() runs inside withStreamKey) closes the double-count gap. Run 1 45331381956 green: 500/500, reasonSum = closedTotal = 500 both windows, all clientAbort, renewal missing/rejected 0. BUT I checked the artifact: ramp poolWait p95 515 ms, waitingMax 96 = unstressed (failing ramps were 2.1-2.5 s, 210-374), so the cause is unreproduced, not absent. Decision given: run 2 as workflow_dispatch on the final code head (second sample); if ramp peak < 500 the counters name the reason -> stop and report (no third run without owner). Item 4 acceptance wording: "diagnosability delivered; cause unreproduced under complete counters (run 1 unstressed)". New flake recorded: organizations.spec.ts:244 axe empty-heading (compose-e2e 1/3, run 45331389265). compose-e2e 3/3 passed on 6dd09c1c. PR #73 (docs): F4.5 brief withdraws identity-browser trace line.**

**2026-11-24 (F4.5 STOP A review): 6 local commits ba5164d3..4a5512f6 reviewed (diff read). Items 1-3 fixes OK. Findings sent: (1) T1 conflicts with the F1 credential rule (F1 plan: identity browser projects keep trace off, "do not enable retained traces to debug them"; repo is PUBLIC so CI artifacts are public) - my F4.5 brief line 21 was wrong; recommend revert T1 + gate spec; owner to confirm; I fix the brief via docs PR; (2) no in-run check that recorded reasons == closedTotal; a counted stream with no sink write gets key undefined at response close -> possible double count; barrier/mismatch must fail only after evidence is written; (3) split flake-round-e2e into two jobs/stacks so legs do not share the totp ip bucket (local leg 2 hit 429 at iter 11 when run after leg 1).**

**2026-11-24 (F4.5 plan re-review): #72 head ee42c29c fixes all five points (diff checked; rate-limit claim matches scripts/e2e.mjs:121-138; signup/setup-redemption 600 s windows not discussed but the local 20x dry run covers them). Plan approved pending green CI (unit-integration was still pending at check). Execution prompt given to owner: same branch/PR, three stop points (before first push after task 5 with local evidence; after chat-sse-load run 1 naming the close reason; final).**

**2026-11-24 (F4.5 plan review): #71 merged by me (172cff1f, all checks green). F4.5 plan = PR #72 (head 51f15738), doc docs/superpowers/specs/2026-11-24-f4.5-flakes.md. Verdict: approve with 5 fixes (sent to implementer as one prompt): (1) unit-integration fails on Prettier - assertion-log row broken by an unescaped `|` in the toHaveURL regex; implementer's "Prettier applied" claim was false; (2) local 20x dry run of each flake-round leg on one kept stack before dispatch (protects the 2-dispatch cap; rate-limit check for 20 sign-ins/TOTP); (3) item 4 exactly-once dedupe between service-reason recordClose and writableFinished classification; drain barrier fails loudly with the missing count; (4) item 3 wording "sufficient mechanism" (CI shows no deadline evidence) and 250->2000 logged as a timeout margin with cause; (5) no push between task 1 and task 5 completion. Checked: test names for -t/-g match; open-signup uses `additional` so unique emails make it repeatable; identity-browser trace is off (playwright.config.ts).**

- Next: implementer fixes #72, checks CI once; I re-review; then execution prompt (fresh session).

**2026-11-24 (latest, after night): F4.4 COMPLETE. #66 merged by owner (3e69b5ef) with the S2 ramp-peak deviation, carried to F4.5 item 4 (PR #71). Main CI on 3e69b5ef was in progress at merge.**

- Main now: F0-F4.4, LEX-TS-001 v1.14, LEX-DS-001 v3.4, prototype revision 17 approved, F5 brief with decisions 5-7, F4.5 brief (#70) + item 4 (#71, draft).
- Next: owner merges #71; owner starts the F4.5 planning session (prompt in this session, typo fixed); then F5.
- Cleanup: ../lexon-f44-merge removed. Implementer worktrees ../lexon-f44-deps (branch f4.4-ts-guard) and ../lexon-f44-hardening are stale; implementer removes them at the start of F4.5.
- SWE-2 max F4.4 assessment (owner trial, not policy): strong tests and RED evidence; misses caught only by my diff review (an unreported CI failure, two wrong clock claims, a pgFailure spec deviation, an unverified CI step, incomplete close counters). Recommendation: Fusion for root-cause/spec/plan phases; SWE-2 max for execution with my per-task diff review.

**2026-11-24 ~02:10 WIB: owner asleep; owner asked me to merge tonight (green only).**

- Merged by me on owner request: #68 (2aa770bc, LEX-TS-001 v1.14), #67 (16b8e24a, revision 17 + DS v3.4 + F5 decision 7), #70 (240ed7a2, F4.5 brief). Earlier by owner: #65, #69.
- #66 NOT merged: I merged origin/main into f4.4-hardening from my own worktree ../lexon-f44-merge (merge commit 155d6a6a; resolved chat-markdown.spec.tsx (kept both tests) and F4.4-acceptance.md (task 1 section + tasks 2-13); local lint/typecheck/format/test:unit 1700/1700 green). Required checks green, but chat-sse-load failed again on 155d6a6a (run 45241596238): ramp serverPeakOpenSse 484/500, admitted 500, authPoolWaitP95 2113 ms. Close counters show only clientAbort, but they count only 179 closes for 500 ramp streams (run B also counted < 500), so the counters do not cover every close path: "no server-initiated close" is not proven.
- Owner decision needed for #66: (a) merge with an owner-approved deviation (load not a required check; intermittent ramp peak < 500 since task 10; cause unproven) and carry to F4.5 or B-02; or (b) investigate first (counter coverage gap, then one more run). Recommend (a) + add the load intermittency as item 4 of F4.5.
- Implementer's local f4.4-hardening is behind origin (my merge commit): it must `git pull` before any further work. Remove ../lexon-f44-merge after #66 merges.
- F4.5 prompt typo fix: "brief-generator" (not "brigef-generator").

**2026-11-24 (later): #65 merged (cbb39da6, main green). #69 (test guard follow-up, unblocks #68) flaked in compose-e2e 3/3 (TOTP + setup nav race, unrelated); failed job rerun once. F4.5 Flakes brief PR #70 (owner decision: small slice before F5; TOTP account-security:111/238, platform-setup-open-signup:39/169 nav race, ai-cancel :786/:207). F5 now depends on F4.5.**

- Merge order now: #69 -> I merge main into #68 -> #68 -> implementer merges main into #66 -> #66 -> #67 -> #70. Then F4.5 implementer session (spec+plan in one doc, stop for review; execution session after).

**2026-11-24 (earlier): F4.4 ready to merge; revision 17 approved; LEX-TS-001 v1.14 and LEX-DS-001 v3.4 written.**

- Open PRs: #65 F4.4 deps (19319967, green incl. osv-scanner and chat-sse-load; lockfile reviewed: only listed chains + their own deps); #68 LEX-TS-001 v1.14 (merge with/after #65); #66 F4.4 hardening (01014961, green, run B load 500/500 both modes, zero server closes; must merge main after #65); #67 revision 17 + LEX-DS-001 v3.4 + F5 brief decision 7 (owner approved 2026-11-24).
- Merge order: #65 -> #68 -> implementer merges main into #66, CI -> #66 -> #67. After #65: owner makes osv-scanner a required check.
- F5 decision 7 (owner, 2026-11-24): tool rows follow text; question/approval panels docked above composer; 1-3 questions per ask_user call (pager top right, Skip this question), max 2 calls/run; one click answers; Enter never approves (Ctrl+Enter); message sent while panel open = question answered in chat / approval rejected first; red-text for failed/rejected/expired; decision records in thread. Clean room: interaction pattern from Claude/Mike screenshots the owner supplied; all copy and visuals our own.
- Next: F5 brainstorming/spec prompt (recommend Fusion for spec/plan, SWE-2 max for execution with per-task diff review). Prototype revision bump (PROTOTYPE_REVISION 16 -> 17 + README lead line) belongs to the F5 slice.

**2026-11-24 00:25 WIB (earlier): F4.4 near done; prototype revision 17 drawn (PR #67, draft, awaiting owner approval).**

- F4.4: #65 deps (step B: typescript-eslint 8.73.0 eligible from 2026-11-23 17:08 UTC; then my review + LEX-TS-001 v1.14 docs PR); #66 tasks 2-13 done and final-reviewed by me (I-1 pgFailure, I-2 compose logs, M-1, M-2 fixed); load check: run B (health-bucket race fix) pending; if it fails -> owner-approved deviation carried to B-02 brief. Merge order: #65 + v1.14, merge main into #66, CI, #66. Backlog flakes: account-security TOTP (73/74), ai-cancel.spec.ts. Burst auth-pool wait p95 3488 ms vs F4.2 2488 ms -> B-02/F20.
- Implementer twice mis-stated the clock; run B and step B prompts make it check `date -u`.
- SWE-2 max trial (owner, not recorded as policy): good tests/RED; misses caught only by my diff review. Recommendation for F5: Fusion for brainstorming/spec/plan, SWE-2 max for execution with per-task diff review.
- Prototype revision 17 (PR #67): 12 states x 4 variants, `planned` ids in the same PR; README lead line still revision 16 (PROTOTYPE_REVISION=16 in scripts; F5 slice bumps both). Review sheets in /tmp/proto17/review/. After approval: LEX-DS-001 v3.4 (tool row, question card, approval card, waiting marker patterns).

**2026-11-23 (later): F4.4 spec session running; F5 answers in PR #63; prototype revision 17 PAUSED.**

- **PR #63** (F5 brief: decisions 5 question = `awaiting_approval` + operation kind, 6 yearly calendar PR + CI guard failing within 90 days of the last covered year; open questions closed; depends on F4.4; visual criterion = sheets by eye, max 2 Linux UI rounds): draft, CI green on head 2d9640ee. Owner merges.
- **Prototype revision 17 paused by the owner until F4.4 reaches its final review.** Planned 12 states x 4 variants: tool activity row (collapsed, expanded, running, failed); question card (pending with "Waiting for you" + Recent marker, answered, dismissed); approval card (pending, approved, rejected, expired); Chats page with the waiting marker. Toolkit check done (Playwright 1.64.1 in a scratch folder works with the cached Chromium). LEX-DS-001 has no tool/approval pattern yet: add one (v3.4) with the approved revision 17.
- **F4.4 implementer question answered (dev-only chains):** override all four, scoped `parent>child`: `typed-rest-client>qs` (Stryker 10.1.1 pins typed-rest-client ~2.3.0 -> qs 6.15.1), `archiver-utils>glob` (testcontainers 12.2.x -> archiver ^7 -> archiver-utils 5 -> glob ^10), the ESLint parents of minimatch (>= 11.0.1), `@esbuild-kit/core-utils>esbuild` (drizzle-kit itself uses ^0.25.4). Each guard proves the feature works (Stryker dry run, Testcontainers directory copy, ESLint fixture fails in a linted path and passes in an ignored one + same file count, drizzle-kit command). A failing guard stops for the owner; allowlist only with owner approval; the allowlist ends empty.

**2026-11-23: F4.4 brief merged (#62, 6b7bf7df, decisions 1-9); superpowers skills vendored (#61, 817f0152; both PR heads green before merge). Next: owner starts the F4.4 brainstorming/spec session (prompt in this session's reply; Fusion via /fusion, after quota reset). Main CI on 817f0152 was still running at merge time: check it once before the next merge. Worktree `lexon-superpowers-skill` removed; `lexon-docs` detached at origin/main.**

**2026-11-23 F4.4 Hardening 2 brief being written; then F5. One implementer session at a time.**

- **Main:** F0-F4.3 (#55, 84 revision 16 goldens approved); #58 supply chain (Renovate, OSV-Scanner gate, Syft SBOM); #56 Audit 2 (`docs/references/audits/2026-11-audit-2.md`); #57 dev-workflow (Docker-free `test:unit`, build-free typecheck, part of A-11, `chat-fence` race fix); #59 F5 brief.
- **No implementer session running;** all earlier worktrees removed. Implementer = one Devin session in **Fusion (frontier lead + SWE-2 sidekick)**, superpowers flow, fresh session per phase. **Claude weekly quota hit 100% on 2026-11-23: start the F4.4 implementer only after reset.**
- **Worktrees:** home `lexon-brief-generator`; docs PRs from `lexon-docs` (`git switch -c docs/<topic> origin/main`, Prettier, draft PR). Never touch the shared checkout `lexon-ai-v6` or the implementer's worktree.
- **Mend Renovate app:** owner installs it. Do not merge Renovate PRs touching the 16 OSV vulnerabilities (F4.4 handles them). After F4.4 item 1 lands, owner makes `osv-scanner` a required check. **OSV allowlist expires 2026-12-22.**
- **Order: F4.4 -> F5.**
- **Model policy (owner, 2026-11-23; Opus-only drained the Devin quota):**
  - Implementer sessions run in **Fusion (frontier lead + SWE-2 sidekick)**: a Claude frontier model leads (brainstorming, spec, plan, reviews); SWE-2 writes code and tests.
  - Routine steps (CI checks, merging main, lint fixes, worktree cleanup) use SWE-2.
  - The brief generator also runs in Fusion. Ask the owner to switch to Opus only for a heavy decision: final spec review, visual approval, a security finding, or a debugging dead end.
  - **F4.4 setup (owner, 2026-11-23):** implementer on Fusion = lead Claude Opus 5.5 at low effort + SWE-2 sidekick; the owner selects it with `/fusion` before pasting, the prompt does not set the model. SDD uses Devin's built-in subagents only, no custom subagent files: `subagent_general` (inherits the parent's Fusion model) for implementers and task reviewers; `subagent_explore` (router-chosen, read-only) for research and reading. Prompt line: "Use explore subagents for research and reading; use general subagents only for code changes and task reviews." The implementer attaches `/session-stats` output (cost by model) before and after task 1.
  - **Trial = F4.4 task 1 (dependency upgrades).** In its review check that RED -> GREEN evidence, spec/quality reviews and CI reporting meet the standard; then assess cost (session-stats before/after task 1) and the quality of RED evidence and reviews, and recommend keep or change (for example a medium lead for the final whole-branch review).
- **F4.4 scope (owner, 2026-11-23; no UI, no visual rounds, lean):**
  1. Dependency upgrades first (16 OSV vulns): propagator-jaeger 2.8.0 via sdk-node 0.219.0 (HIGH, fixed 2.9.0); next 16.4.3 (7, fixed 16.4.5); qs 6.15.1 via typed-rest-client 2.3.1 / Stryker (4, fixed 6.16.1); minimatch 9.0.9 + 10.2.6 (fixed 11.0.1); glob 10.5.0 via archiver-utils / testcontainers (fixed 14.0.2); mdast-util-to-hast 13.2.0 override (fixed 13.2.1); esbuild 0.18.20 via drizzle-kit @esbuild-kit (fixed 0.25.0). LEX-TS-001 v1.14 = paired docs PR by me after the spec lists old -> new.
  2. Tests: B-01, B-06, B-07, B-12, B-13.
  3. Small fixes: B-03, B-23 (incl. `ORG_STATE_CHANGED`), B-14, B-18, A-11 rest (identity retry loops, pagination schemas, `pgFailure` reads `.cause` first, email normalisation), A-18 leftovers, other B-20 items re-checked.
  4. Chat perf for F5: B-04, B-05, B-22, B-19.
  5. CI: B-21 mutation gates (changed paths / schedule).
  6. Docs (mine, docs PR): B-09, B-15, B-11 (`cn` choice in LEX-TS-001; code change in Polish slice).
- **Not in F4.4:** Polish slice after F5 (F4.3 UI carry-over list in `F4.3-handoff.md`, app-wide mobile dialog footer = deviation §13 entry 11, B-10, B-11 code, B-16); B-08 -> F17; B-02 -> own brief.
- **F5:** brief merged (#59). Owner questions open: (1) questions reuse `awaiting_approval` + operation kind (recommended) or new `awaiting_input` (LEX-ARC-001 revision)? (2) holiday calendar one PR per year (recommended)? Prototype revision 17 (small: tool activity row, ask-user card, "Waiting for you", approval card; light/dark, desktop/mobile) approved before planning; `planned` ids in the same PR. Max 2 Linux UI rounds in F5.
- **Next work, in order:**
  1. Write F4.4 brief + README row, docs PR, report CI, stop for owner approval.
  2. After approval: implementer prompt for F4.4 brainstorming/spec (TDD + RED evidence, draft PR from first task, CI per report, never weaken assertions (log old -> new), Docker rule, own worktree).
  3. While F4.4 runs: ask the two F5 questions, amend F5 brief, draw prototype rev 17, show PNGs, wait.
  4. Review each F4.4 report (spec, plan, tasks, final review, CI).
  5. Backlog: plans and entitlements (two stages, F17; owner questions open); CI Docker layer cache; second shard rebalance; F20 burst numbers; F8 cover statement; SSO decision (L14); owner check of ruleset enforcement and bypass list.
- **Standing rules for prompts:** Docker rule verbatim ("Only touch containers and volumes named `lexon-e2e-*`, by explicit name filter. Never prune. Never touch the unnamed volume `a4699d7d…` or any `lexon-dev_*` volume. If disk space or leftover stacks block a gate, stop and ask me."); own worktree; goldens only from Linux CI, 1.5% gate for app goldens; max 2 Linux UI rounds per area; no model identifiers; report head CI before every merge; `gh pr checks` once per question, no polling.

**2026-11-22: F4.3 Tasks 17-19 left; four parallel sessions; F5 brief in review.** (superseded)

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

**2026-11-21: F4.3 Platform admin console in execution.**

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

- Review habits (owner, 2026-11-23): this session is the only reviewer. Full list in `playbooks/review-implementation.md` "Review habits": decide gaps from the spec and contract, not the prototype alone (a prototype value that breaks its own pattern is a prototype error -> deviation); never invent data the contract lacks; prefer no new public route and reuse endpoints/components, any contract change stops for the owner; prototype sheets approved by eye, group noise / approved deviation / real, fix only real spec violations, cap rounds, leftovers to a named slice; before every merge check head CI, branch contains main, and scan the diff for skips, removed assertions, `.superpowers/`, secrets, console/TODO; merge the large feature PR first when small PRs are docs/config only, code PRs merge main after; real PR titles; remove temporary worktrees after merge; start implementer phases only with Claude quota available.

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

## 2026-11-26 — F6 batch 3 checkpoint (reconciled from a second reviewer session)

- #102 task 9 merged into f6-projects as 0accec6c (CI green on f58ea27d). Post-merge run 45807656646 (unit-integration, ai-execution publishedApprovalIds empty) and 45807647830 (SSE S2 peak 456/500) green on attempt 2.
- Task 9 fixed real bugs: project chats were created under profile 'chat' instead of 'project-chat'; viewer create was 500, now 403; denied/absent 404; matter 404 -> not-found page.
- Owner decision: additive ownerName on ChatDetail (readers) and shared-scope ChatPage items; implementer also added restrictedCount on OrgProjectSummary (admin metadata) without asking.
- index.json now has 190 pending ids (all app-shell states, sidebar Matters group). Those views have NO golden protection until the owner approves the CI sheets (run 45805110278). Linux UI round 1 of 2 used.
- Open: ai-execution flake uses the same 250 ms publication-deadline mechanism as the batch-1 stream truncation; demand evidence. SSE peak dropped 490 -> 456; re-check in task 11. b8904025 was pushed straight to f6-projects (no PR).
- Implementer is mid task 10 (reader gating, share dialog, settings Matters, shared tab).

## 2026-11-26 — PR #104 (sidebar re-baseline packet) review: REJECTED as built

- Each shard's visual-pending review/ folder holds a file for every id; only the shard that ran the spec has the real capture, the others carry baseline bytes. The packet took the wrong shard for 96 ids, so its "96 pixel-identical" are baseline copies (verified: chat-approval-desktop-light real capture in shard 1 shows Matters; shards 2/3 = baseline md5). The 6 no-baseline ids also show no Matters, so they are suspect too.
- The 88 sidebar-only diffs looked correct by eye (Matters row, Recent shifted, content untouched), but approval waits for a rebuilt packet.
- #104 head b1a7f8ce: unit-integration red on ai-execution "proposal limits preserve every accepted approval event" (3rd occurrence, docs-only PR). The report did not mention it.

## 2026-11-26 — PR #104 rebuilt packet (c9a5893c): reviewer recommends approval

- Shard selection verified against my own md5 check (chat-approval shard-1, settings-general shard-3). 176 sidebar-only deltas, all inside x<=250 desktop / 293 mobile; 8 identical are non-shell pages (not-found, onboarding*); 6 no-baseline ids are svg-snapshot/engine-test views and must get no pixel golden.
- Eye check: Matters row present on every app-shell capture, content untouched.
- c9a5893c unit-integration red on eslint (unused readdirSync); the gate was not run before the push again.
- #103 added 12 more pending ids for task-10 content changes; they need their own task-10 review packet.

## 2026-11-26 — #104 merged (b5cedd98, pending 0, goldens = correct-shard captures); #105 + #106 reviewed

- #106 (fix batch 3, 07ecdb22, CI green): authorizeCommitted per-event EXISTS arms -> one VALUES join with count(*) = arm count. Semantics verified (o.id unique per run, duplicates counted per arm). Measured 125 ms -> ~7 ms; 20/20 loaded runs. Approve. Follow-up: a dropped operation-bearing publication is still silent until reload; should trigger a chat refresh notify (record as F6 hardening follow-up). ai-worker-crash shutdown bound under observation (1/37).
- #105 (task-10 delta packet, round 2/2 Linux UI, CI green): 56 ids; eye-checked settings nav Matters (matches prototype order), chats All/Shared tabs, floating menu Share. Approve. README counts disagree with results.json (identicalToCheckedIn 15 vs "0", drift 2 vs "17"): fix the text.
- #103 head 24b46622: sbom red = syft download HTTP 504 (infra, rerun); compose-e2e pending.
- Linux UI rounds for F6 are now used up (2/2); task 12 captures need owner approval for an extra round.

## 2026-11-27 — #107 task 11 review: changes requested

- #103, #105, #106 merged. #107 head d56a2d4a: list-gate pass, unit-integration + compose-e2e pending at review time.
- Good: 6 list surfaces, EXPLAIN as lexon_app with RLS forced, no seq scan on wall tables, p95 10-16 ms (gate 300 warn / 1000 block), repo SQL shared with the gate, 63/63 injection evals with contextFixtures:1.
- Gaps: (1) "project-delete-claim-lane" deletes EMPTY projects (chatCount 0) and times HTTP; my ask was 200 chats + live runs, lane hold time and concurrent same-org claims. (2) "sse-three-run-peak" = 3 connections' first-byte; my ask was chat-sse-load S2 ramp peak (490 -> 456 of 500) x3 on CI vs F5 baseline. Both mislabeled as done.
