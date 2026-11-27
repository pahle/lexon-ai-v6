# F6 acceptance evidence

Status: in progress. Task evidence is recorded per task as it lands on the
`f6-projects` integration branch. Batch 1 (tasks 0–4 + the out-of-band
decide/send deadlock fix) is merged through PRs #93–#98; batch 2
(tasks 5–10) remains. Task review and owner acceptance remain pending.
This is not F6 completion.

Design and plan: [design spec](../superpowers/specs/2026-11-25-f6-projects-ethical-wall-design.md),
[implementation plan](../superpowers/plans/2026-11-25-f6-projects-ethical-wall.md).

Batch-1 execution ledger:
`.superpowers/sdd/2026-11-25-f6-projects-ethical-wall/` (per-task briefs
and reports, `batch-1-report.md`, `progress.md` flake ledger).

## Task 0 — F5 carry-over: four minors

`backend/src/modules/chat/run-routing.ts` (new, shared `isRouting`),
`backend/src/modules/chat/expiry-sweep.ts`,
`backend/src/modules/chat/step-coordinator.ts`,
`frontend/src/lib/chat-stream.ts`,
`backend/test/integration/expiry-sweep.spec.ts`,
`frontend/test/chat-stream-ops.spec.tsx`,
`backend/test/e2e/chat-tools.spec.ts`,
`frontend/test/thread-a11y.spec.tsx`.

- **0.1 shared priority check.** `isRouting` (safe-integer priority 1–10,
  `ai-interactive`/`ai-batch` queue) moved verbatim from `step-coordinator.ts`
  into `run-routing.ts`; both call sites import it. Before this change the
  sweep accepted `typeof priority === 'number'`, so a run whose stored
  `resolved_config` carried `priority: 1.5`/`0` reached
  `OutboxRepository.append`, threw `Invalid outbox routing` inside the
  candidate transaction, rolled the expiry CAS back and re-listed forever —
  the latent poison loop from `reviews/F5-review.md` deferred minor 1. Now an
  invalid routing is skipped (the `run.resume.v1` outbox row keeps
  `queue_name`/`priority` NULL → default queue), the candidate commits, and a
  single K1-free warn `ai_operation_expiry_invalid_routing`
  (`{event, runId, operationId, safeCode}` — ids and a safe code only) is
  emitted after commit via the `invalidRouting` flag on the resume
  publication. `approval.service.ts` keeps its own local check — it was not
  in the task's file list (its decide path fails the request rather than
  looping); flagged for the controller.
- **0.2 reassembled tool input.** `chat-stream.ts` accumulates
  `inputTextDelta` text per `toolCallId` in `state.toolInputText` (cleared on
  `tool-input-start`, `reset`, `snapshot-reset`, `snapshot-start`) and a bare
  `tool-input-available` (§9 over-cap, `input` dropped on the wire) now emits
  the JSON.parse of the accumulated text instead of `{}`; unparseable or
  absent text still falls back to `{}`. `onOperationSummaryMissing` still
  fires so the tree refetch fills the row's detail fields.
- **0.3 worker sweep return.** `chat-tools.spec.ts` asserts
  `await workerSweep(runId)` is exactly `{swept: true}` — the return value
  the real `OperationExpirySweep.sweep()` handler reports through the
  worker's `/run/lexon/health/chat-proof.sock` control socket, not only the
  database side effects.
- **0.4 a11y header citation.** `frontend/test/thread-a11y.spec.tsx` header
  now cites the real browser contrast pass: `runBrandAxe` (axe `brandAxeTags`,
  WCAG 2.0/2.1/2.2 A and AA) inside `captureBrandViews` in
  `backend/test/e2e/brand-visual-support.ts`, run on every capture in both
  themes — not `chat-accessibility.spec.ts`.

### RED (before implementation)

- `pnpm vitest run --project backend-integration backend/test/integration/expiry-sweep.spec.ts`
  → new test 'a candidate with an invalid resume priority skips the override,
  logs without K1 and is not retried' **failed**: the op stayed
  `awaiting_approval` (append threw inside the transaction; rollback →
  re-list → retry). Expected — the poison loop the fix removes.
- `pnpm vitest run --project frontend frontend/test/chat-stream-ops.spec.tsx`
  → new test 'keeps the delta-reassembled input when a capped
  tool-input-available drops the wire input' **failed**: the emitted chunk
  carried `input: {}`. Expected — `item.input ?? {}` clobbered the
  reassembled input.
- 0.3 is a missing-assertion gap, not a behavior bug: the socket already
  returns `{swept: true}`; the spec simply never inspected it (spec §2:
  "fails today — not inspected"). The assertion was added and run green
  against the real compose stack.
- 0.4 is a comment-only change; no test beyond lint.

### GREEN (after implementation)

- `pnpm vitest run --project backend-integration backend/test/integration/expiry-sweep.spec.ts`
  → **7 passed** (the new test asserts: three candidates with
  `resolved_config` `{queue:'ai-interactive', priority: 1.5 | 0 | null}` —
  jsonb cannot hold NaN, `JSON.stringify(NaN)` is `'null'` — all expire, runs
  resume on the default queue (`queue_name`/`priority` NULL), exactly three
  K1-free warns, and a second sweep adds nothing).
- `pnpm vitest run --project backend-integration backend/test/integration/ai-queue-routing.spec.ts`
  → **17 passed** (coordinator routing regression cover).
- `pnpm vitest run --project frontend frontend/test/chat-stream-ops.spec.tsx`
  → **16 passed**; `pnpm vitest run --project frontend frontend/test/thread-a11y.spec.tsx frontend/test/chat-transport.spec.tsx`
  → **51 passed**.
- `pnpm test:e2e backend/test/e2e/chat-tools.spec.ts --project chat-browser`
  → **5 passed (17.5s)** on a fresh isolated compose stack
  (`lexon-e2e-d364e54742e2337b`), including the expiry test that now asserts
  the `{swept: true}` socket return.

### Gate

- `pnpm exec eslint <changed files>` → exit 0.
- `pnpm --filter @lexon/backend typecheck` → exit 0;
  `pnpm --filter @lexon/frontend typecheck` → exit 0.
- `pnpm exec prettier --check <changed files>` → exit 0 (one spec file
  reformatted by `prettier --write` first).

## Task 1 — shared contracts (merged `5dceea14`, PR #94)

- `shared/src/projects.ts`: `ProjectSchema`, `ProjectRoleSchema`,
  `ProjectMemberSchema`, `ProjectDenySchema`, `ChatAccessSchema`
  (`'owner' | 'reader'`), `ChatQueryScope` `'shared'` member,
  `ChatPage.projectName` optional field — additive `strictObject`
  contracts per spec §11.
- `ChatDetailSchema` = `ChatTreeSchema` + `access` — access stays a
  per-request wire fact, not tree identity (ruling recorded in
  `progress.md`).
- `shared/test/projects.spec.ts` + projects contract coverage green.

## Task 2 — migration 0043 (merged `960a8005`, PR #95)

`backend/drizzle/0043_projects.sql` (752 lines) + journal idx 43.

- Tables: `app.projects` (matter_number, practice_area, status, owner,
  counter columns maintained by triggers only), `app.project_members`
  (owner/editor/viewer), `app.project_denies` (deny list, no lexon_app
  write policy — definer-only), `app.chat_shares` (standalone-share only:
  insert policy requires granter-owned chat AND `project_id IS NULL`),
  `chats.project_id` (composite FK `ON DELETE SET NULL (project_id)` —
  PG15+ column-list form).
- Definer family (all STABLE SECURITY DEFINER, pinned search_path,
  NULLIF-fail-closed GUC reads, EXECUTE to lexon_app only):
  `ops.lexon_org_member`, `ops.lexon_project_access` (deny-before-role
  ordering), `ops.lexon_project_denied`, `ops.lexon_project_deny_add`
  (refuses owner targets), `ops.lexon_project_deny_lift` (refuses
  self-lift).
- Policy split: `tenant_boundary` (permissive, org_id only) stays;
  `*_access_select` read arms gain the RLS-filtered `chat_runs` link;
  `*_owner_run` RESTRICTIVE write arms keep `resourceIds='[]' OR
initiating_user_id=caller` on `ai_runs`/`ai_steps`/`ai_checkpoints`/
  `ai_operations`/`chat_runs`/`chat_messages`/`chats`; `ai_attempts`
  deliberately unsplit.
- `chats_access_select`: standalone = owner OR `chat_shares`; project =
  `lexon_project_access <> 'none'` only — chat ownership conveys no read
  on project chats.
- `projects_access_select`: admin metadata arm is
  `org_owner_admin AND NOT project_denied` — deny beats admin.
- Column-scoped UPDATE on `chats` excludes `project_id` — binding
  immutable post-create; create-request trigger copies project_id with
  conflict→23514.
- RLS spec coverage: `project-access-rls.spec.ts` — deny add/lift
  refusals, ZERO_PROJECT_ROWS, lexon_auth permission denied,
  `lexon_project_access` fail-closed matrix, recursion termination,
  denied-admin loses projects row.

## Task 3 — §4.1 access predicate + repositories (merged `c5f5d527`, PR #96)

- `backend/src/infrastructure/db/authorization-predicate.ts`:
  `buildAuthorizationPredicate` produces scope-validated frozen bags;
  `ownedChatWhere` = owner AND (`project_id IS NULL OR
lexon_project_access<>'none'`); `chatReadWhere` mirrors
  `chats_access_select` (owner / project member-or-editor / share
  recipient, deny-wins via the definer).
- Every app-level read path funnels through the predicate: `readLive`
  (chat detail/tree), `lockLive` + all write paths (owned-chat),
  `hasLiveAnswerRun` (cancel), `existsForAccessibleChat` (decide/SSE),
  `authorizedChatSnapshot` + `stream*Proof` chain (SSE), lists/search
  (owned + shared scopes), `authorizedChatSnapshot` widened to chat-read
  (member-visible SSE per §5 row 10).
- Identical-404 deny matrix spec: `chat-read-access.spec.ts` — members
  get 403 only where capability differs; denied/non-member/nonexistent
  byte-identical 404s across detail, list, search, proofs, decide,
  cancel, rename, delete, title fan-out.

## Fix — decide/send 40P01 deadlock (merged `afc837c7`, PR #97)

- `ChatService.send` and `ApprovalService.decideOperation` `withTenant`
  calls wrapped in `withAuthRetry(…, { retryable: isRetryableAuthError })`
  (3 attempts, 40001/40P01). The raced endpoints take row locks in
  inconsistent order; without serialization retry the deadlock victim
  surfaced an unmapped 500 where the designed semantics resolve the loser
  through business logic (stored outcome 200 / CHAT_CONFLICT).
- `tenant-write-retry.spec.ts` 6/6: retry on 40P01/40001, no retry on
  unique-violation, retry-exhausted rethrow, non-pg business refusals
  propagate.

## Task 4 — migration 0044 + project-chat profile + access-loss settle (merged `e94b1d0b`, PR #98)

`backend/drizzle/0044_project_actor_facts.sql` (745 lines) + journal idx 44.

- `auth.lexon_ai_actor_facts` 4-arg overload: resolves the chat owner's
  project standing (`owner_project_role`, `owner_denied`) via
  `lexon_project_access` semantics — feeds the §9 capability gate.
- Access-loss settle definers — `ops.lexon_ai_access_loss_facts`,
  `ops.lexon_ai_finalize_access_loss`, `ops.lexon_ai_access_loss_decide`,
  `ops.lexon_ai_expire_access_loss`, `ops.lexon_ai_terminal_stream_proof`:
  claims-bound (GUC + `IS DISTINCT FROM` + initiator binding), advisory
  lock family, FOR UPDATE run row, CAS transitions raising 40001,
  sibling-op settlement (pending→failed, awaiting→rejected,
  approved→rejected), audit pair, `pg_notify`, idempotent stored-outcome
  arm on re-decide. Every settle definer carries the **live bound-chat
  guard**: `resourceIds->>0` chat tombstoned/absent → refuse (F4 deletion
  family owns tombstoned rows per spec §4.4).
- `ai_mark_chat_deleted` recreated (PG17 ACL path) with the
  `lexon_project_access='none'` fail-closed project clause.
- `project-chat` production profile (`chat` capabilities +
  `project` context budget 2,000); capability gate `projectBlocked`:
  deny blocks all, project-bound chats force `project-chat`,
  `project-chat` requires owner/editor standing.
- `ProjectContextProvider`: project context read under the initiator's
  claim, input/budget validated before I/O, untrusted-fenced piece.
- Reader payload boundary (§5 row 14): `stripReaderPayloads` on the chat
  detail ops; `authorizedChatSnapshot.readerView` strips
  `input`/`display`/`output` on `operations` and tool `parts`;
  `redactRunStreamEventForReader` on `StreamHub.deliver` redacts
  approval-required/question-required/tool-input-available/
  tool-input-delta/tool-output-available for non-owner subscribers —
  the same fields the §9 byte-cap fallback drops.

## Security-gate review (batch 1)

Reviewer subagent on the merged diff `5dceea14..e94b1d0b`: **APPROVED** —
10/10 checks pass, no blocking findings.

- Policy composition: RESTRICTIVE write arms AND-compose with permissive
  tenant_boundary; no policy body reads the new tables directly (all
  probes inside STABLE definers — no recursion).
- Definer hygiene: search_path pinned, claims-bound, fail-closed, narrow
  grants (lexon_app only; REVOKE from PUBLIC/lexon_auth — grant-matrix
  spec pins it).
- Predicate parity: application predicate ≡ RLS policy bodies.
- 404 uniformity: every denial path maps to `CHAT_NOT_FOUND` — invisible
  ≡ nonexistent at the HTTP boundary.
- Revocation: member-removal converges on SSE close ≤
  REVALIDATION_INTERVAL_MS (5 s), snapshot 404, proofs refuse, fan-out
  exclusion — fail-closed.
- Reader payload boundary: all three serialization surfaces covered;
  strictObject event schemas make the handled set complete.
- Migration ordering + provision unwind chain (0044→0043→0042) verified.

Non-blocking observations (recorded for batch 2 / follow-ups):

1. Demoted-viewer decide returns plain-Error 500 ('AI approval decision
   refused') rather than 403/409 — fail-closed, cosmetically
   inconsistent.
2. `chat.service.create` lacks `withAuthRetry` — consistent (no
   access-loss CAS on create), noted as asymmetry.
3. `chats.owner_user_id` remains in the lexon_app UPDATE grant though
   app code never writes it — candidate for grant tightening.
4. `ai_expired_operations` batch discovery is claim-free by design —
   per-candidate settle re-binds initiator claims; ids only.
5. `enqueueSnapshot` bypasses `eventTransform` by design — invariant
   "fallback snapshots are per-caller-authorized" documented.

## Flake ledger

Recorded in `.superpowers/sdd/2026-11-25-f6-projects-ethical-wall/progress.md`
and `batch-1-report.md`: `chat-sse-load` marginal-capacity (PR #94),
40P01 raced decision (became PR #97 fix, root-caused again on the fix
branch — see fix-batch section), `ai-execution`
proposal-limits approval-drop (root-caused and fixed — see
`f6-fix-batch3` section; 20/20 loaded runs green),
`ai-worker-crash` pause-release race (environmental; shutdown-bound
wait reappeared once in 37 loaded runs — see `f6-fix-batch3` section),
sse-load bad-object push artifact, organizations axe-scan (unrelated e2e).

## Fix batch — `f6-fix-batch1`

Three review findings fixed on one branch (commits `6fc42b64`,
`1204ffb2`, `876f7abe`, `ed5fb825`), plus minors 4–5:

1. **O(connections) invalidation fan-out** — every chat-scoped
   notification ran a `withTenant` `readLive` per connected user. Fix:
   `ops.lexon_chat_notification_audience(org, chat)` definer resolves
   the audience once per notification under org-scoped service claims;
   dispatch delivers to matching connections only (audience-once
   dispatch + `notifyAccessChanged` wiring on this same mechanism — a
   deviation from the task-4 plan location, recorded here per review).
   The payload schema gains `userIds[]` + nullable `chatId`; deny
   add/lift emit `{orgId, chatId:null, userIds:[target]}` inside the
   definer transaction, and `ChatRepository.notifyAccessChanged` covers
   the member/share emitters when those mutation paths land (batch 2).
   Tests (`chat-notification-audience.spec.ts`): 6 listeners, one event,
   `withTenant` called exactly once; denied/removed/non-member
   connections receive nothing; access-change refresh reaches exactly
   the listed user.
2. **Stream truncation regression** — root cause: `authorizeCommitted`
   ran once per stream _part_ (each a full tenant tx) inside a 250 ms
   `publicationDeadlineMs`; a 15-event batch serialized 15+ tenant
   transactions and the deadline-bound part broke the lifecycle
   publish loop. Fixed: `authorizeCommitted` takes the event batch once
   per `publishCommitted` call (spec counts calls === 1).
3. **40P01 decide/send deadlock** — DETAIL captured: decide held
   `ai_operations` (decideApproval UPDATE) and wanted `chats` via the
   0026 write-fence trigger (ops→chats); send held `chats` (lockLive)
   and wanted the op (chats→ops) — a pre-0026 inversion the 0043
   subquery weight made CI-visible. Fix: `lockLiveForRun` locks bound
   chats (ORDER BY id, FOR UPDATE) before op locks so decide takes
   chats→ops too; `withAuthRetry` stays as defense. Stress spec: 40
   raced iterations green.

**Per-statement latencies** — EXPLAIN (ANALYZE, BUFFERS) as `lexon_app`
on a seeded migrated template (postgres:17.11, warm cache, plan+exec):

| Path                                    | Pre-0043 | Post-0044           |
| --------------------------------------- | -------- | ------------------- |
| `streamCommittedProof` owner/standalone | ~3.6 ms  | ~3.2 ms             |
| `streamCommittedProof` member/project   | n/a      | ~10.5 ms (7.2 plan) |
| `chats` readLive member/project         | ~0.09 ms | ~0.44 ms            |
| step-commit UPDATE `ai_steps`           | ~2.4 ms  | ~5.2 ms             |
| decide UPDATE `ai_operations`           | ~1.8 ms  | ~5.3 ms             |

Post-0043 predicates (chat-read EXISTS arms, `lexon_org_member`/
`lexon_project_access` definers, RESTRICTIVE access_read policies) add
2–5× per statement, dominated by planning. **Task-11 perf-gate input:**
re-measure the same five statements under the 500-user/50-chat load
shape and compare against these baselines; the fix-batch commit
(`6fc42b64`) reduced `publishCommitted` to one proof per batch
regardless of event count.

Minors: `projects` UPDATE grant narrowed to
`(name, matter_number, practice_area, updated_at)`; settle definers
(`access_loss_facts`/`finalize`/`decide`/`expire`) refuse unless the
bound `resourceIds->>0` chat is one the initiator actually lost —
project-bound with `lexon_project_access='none'`, or standalone with
the initiator's org membership gone (org-removal mid-run still settles;
integration tests: healthy-run refusal and org-removal settle, both in
`project-access-loss.spec.ts`). `lexon_project_chat_activity` rewrites
`projects.last_activity_at` only when it is older than 60 s, removing
the per-message hot row. `provision.ts` upgrade-test revert chain covers
0045 (replays pre-0045 bodies from the 0043/0044 files; verified
unwind-to-041 + replay-through-045 on a live database).

## Batch-2 remaining work

Tasks 5–8 per plan (corrected from 5–10): task 5 projects module
(CRUD, instructions, members, TenantGuard, audit events), task 6
ethical wall (org metadata list, deny add/lift, API deny matrix),
task 7 chat sharing (shares endpoints, shared-with-me, recipient
data), task 8 project deletion (`ops.project_delete` + endpoint).
The access-change fan-out (`notifyAccessChanged`) shipped early on
the fix branch; member/share emitters wire onto it when those
mutation paths land. **Renumber required:** the fix batch consumed
migration `0045` (reserved for task 8's `project_delete`); per the
plan's foreign-migration rule, task 8 takes the next free number.
Hardening follow-ups: observations 1–3 above; retry/deadline
tolerance on `#publishCommittedLifecycle` per-chunk authority checks.

## Batch-2 structure deviation (accepted)

Tasks 5–8 ship on a single PR (#100, `f6-t5-projects → f6-projects`)
instead of one PR per task — accepted deviation from the plan's
per-task PR protocol. Batch-2 review fixes landed on the same branch:
the spec-suite typecheck pass (test-included `tsc --noEmit`), the
`ops.lexon_chat_notification_audience` rewrite (migration `0050` —
project-chat candidates filtered through the new
`ops.lexon_project_access_for` service-claims oracle instead of a
re-implemented deny check; the chat-owner arm admits only standalone
chats whose owner is still an org member), and the `ops.project_delete`
org-membership gate. Note for future migrations: PostgreSQL 17 requires
EXECUTE on the existing function for `CREATE OR REPLACE` — `0050`
grants EXECUTE to `lexon_migrator` around the replace and restores the
`0045` acl afterwards.

## Fix batch — `f6-fix-batch3`

**ai-execution approval-drop (4 CI occurrences)** — root cause:
`streamCommittedProof` authorized a publication batch with one correlated
`EXISTS` subplan per operation-bearing event (~4 ms per arm). Measured
inside `publishCommitted` (temporary `RUN_STREAMS_TIMING` phase marks,
since reverted): a 25-event batch spent 110 ms and a 32-event batch
120–128 ms in `authorizeCommitted` alone — over half the 250 ms
`publicationDeadlineMs` before a single part reached Valkey. Under CI
load the tx overruns the deadline outright or leaves too little budget
for the parts loop; `publishCommitted` returns `unavailable`, the
lifecycle batch is skipped, and accepted approval events never reach the
stream (the `publishedApprovalIds: []` signature). The
`#publishCommittedLifecycle` fix batch-1 commit (`6fc42b64`) had already
collapsed the call count to one tx per batch; the remaining cost was
inside the query plan.

Fix: the per-event arms now join a single `VALUES` list in one aggregate
(`count(*) = arm count` ⇔ every event's arm matched — `o.id` is unique
per run, so the join is at most one row per arm). Same row set, same
refusal semantics, one scan of the run's `app.ai_operations` instead of
N correlated subplans.

Measured after the fix (same instrumentation): `authorizeCommitted` is
flat ~7 ms regardless of batch size (25→7.0 ms, 32→6.5–7.8 ms,
14→7.4 ms); total `publishCommitted` ≤ ~10 ms — 25× headroom under the
250 ms deadline.

**Proof under load:** 20 consecutive `ai-execution.spec.ts` runs
(86 tests each) green while the full `backend-integration` suite and a
parallel `ai-worker-crash` loop contended on the same host; max
`authorizeCommitted` observed 9.9 ms, zero publication drops. Full
`backend-integration` regression: 736/736 green under the same load.
Removed from the flake ledger; the sibling test's
`publicationDeadlineMs: 2000` note (A-13 F4.2) stays — it exercises a
different invariant (mid-batch expiry recovery).

**Dropped-event visibility:** a dropped `approval-required` is
user-visible — live clients never render the approval card (the event
is the only live path to `tool-approval-request`). The durable
`app.ai_operations` row is unchanged, so a reconnect/reload rebuilds it
via the `snapshot-operation` frames (`stream-hub.ts` replays operations
from the DB snapshot, not the stream) — user-visible until reload, then
self-healing.

**ai-worker-crash (>4 s advisory waits):** the `terminate()` graceful
shutdown is asserted `<5000 ms`; the worker's finalization tx serializes
on the org claim lane (`pg_advisory_xact_lock`, bounded by
`lock_timeout=5000` → 55P03→`unavailable`). Under load a stalled lane
holder pushes the wait past the assertion. This is a distinct mechanism
from the publication drop (the read-side proof tx never held the lane);
the authorize collapse removes ~120 ms of per-publish serialized PG work
globally, which lowers lane pressure. One reproduction in 37 loaded
runs post-fix (previously: 1 CI occurrence) — tracked below.

Flake ledger update: `ai-execution` proposal-limits approval-drop —
**resolved** (this fix). `ai-worker-crash` shutdown bound — load-sensitive,
under observation (1/37 loaded reproductions post-fix).

**Hardening follow-up (owner-directed, not this batch):** a
`publishCommitted` `unavailable` result on an operation-bearing batch
stays silent until the affected client reloads (see "Dropped-event
visibility" above). The follow-up is to emit a chat refresh notification
on that path so live clients resync without a manual reload.

## Task 11 — §14 list-performance gate + §15 injection evals

**List gate (PR #107, `e1eea5d5`):** 6 surfaces under `lexon_app` RLS on
the migration-0043 image — 500 projects / 50 members, 300 chats, 30
shares, 100-project foreign org, member/deny rows, `ANALYZE`. EXPLAIN:
no seq scan on wall tables `project_members`/`project_denies`, expected
index present on every surface. HTTP p95 9.9–16.2 ms vs the 300 ms warn
/ 1000 ms block gates. Shared SQL builders (`projectListSql`,
`projectOrgListSql`, `chatListSql`) keep the gate on production text.
Definer inner-cost: `lexon_project_access` 200 calls avg 0.153 ms /
p95 0.176 ms + PK index proof. Post-0043 re-measure beats pre-project
baselines (proof-member ~2.9 ms vs ~10.5 ms). Evidence:
`docs/references/F6-list-gate-2026-11-27.jsonl`.

**Injection evals (PR #107, `e1eea5d5`):** 63/63 across
`project-instructions-{rename,disclosure,permissions}` — hostile project
instruction credited via `contextFixtures: 1`, then stopped by the wall
(rename parked at approval → rejected; disclosure inert; permissions
claim refused `failed`, `effects: 0`).

**`project_delete` claim-lane (owner-directed replacement):** project
with 200 chats (mixed owners) + 5 live `ai_runs` (one paused
`awaiting_approval`), deleted via `DELETE /api/projects` under
`lexon_app`. Measured:

- Lane hold (`ops.project_delete` advisory xact lock duration inside the
  tombstone tx, timed from a second connection): **142.44 ms** — ~35×
  under `CLAIM_LANE_LOCK_TIMEOUT_MS` (5000 ms).
- Effect on same-org work: 5 concurrent `commit()`s on claimed steps in
  _other_ same-org chats queued behind the lane and **all succeeded** —
  waits 89.7–141.5 ms, zero 55P03, zero `unavailable`. Baseline
  uncontended commit: 9.41 ms. `pg_locks` peak waiters on the lane: 5.
- Verdict: **PASS** (margin + zero concurrent failures). JSONL:
  `{"type":"project-delete-claim-lane",...,"laneHoldMs":142.44,
"commitWaitsMs":[89.7,102.65,141.47,115.98,128.46],
"commitFailures":[],"peakWaiters":5}`.

**`chat-sse-load` S2 (owner-directed replacement):** the real 500-client
burst/ramp workflow dispatched 3× on CI at f6-projects head `7356aad9`:

| Run                                                                          | Conclusion    | Ramp peak | Burst peak | Closes                                        |
| ---------------------------------------------------------------------------- | ------------- | --------- | ---------- | --------------------------------------------- |
| [45931064274](https://github.com/pahle/lexon-ai-v6/actions/runs/45931064274) | success 9m0s  | 500/500   | 500/500    | all `clientAbort` (24 run + 476 invalidation) |
| [45931077250](https://github.com/pahle/lexon-ai-v6/actions/runs/45931077250) | success 18m6s | 500/500   | 500/500    | all `clientAbort`                             |
| [45931961520](https://github.com/pahle/lexon-ai-v6/actions/runs/45931961520) | success 9m3s  | 500/500   | 500/500    | all `clientAbort`                             |

`F4-sse-load.json` plateau: 500 `activeSubscriptions` across all 30
samples in every run. All three match the F4.4/F4.5 baseline (run
[45166468664](https://github.com/pahle/lexon-ai-v6/actions/runs/45166468664):
500/500 both modes, all `clientAbort`). The cited-run dips do not
reproduce on the current head (45782643479's ramp admitted 490 with
422 `evicted` closes; 45807647830 was itself 500/500) — peak is at
baseline, so no audience-lookup/`notifyAccessChanged` root-cause is
warranted.

## Task 12 — Matters visual states (pending captures, `f6-t12-visual`)

Capture spec `brand-visual-matters.spec.ts` + fixtures
`matter-state-fixtures.ts` cover the 16 Matters states at revision 18
(64 views: 2 viewports × 2 themes). The org is real (Kantor Hukum Adil:
Dewi owner; Andi/Rina/Citra members via invitations, onboarding +
jobTitle); only the F6 payloads are fixtured (`/api/projects*`,
`/api/org/projects*`, `/api/org/members/search`, `/api/chats/:id/shares`,
`/api/chats?scope=shared`). Axe runs on every capture (WCAG tags via
`captureBrandViews` default). No goldens and no `approval.json` — the CI
run writes `visual-pending-*` artifacts + `pending-compare` sheets for
owner eye review.

**Prototype deviation (owner ruling requested on the sheet):** the
approved r18 prototype dims the restricted member row with
`opacity:.55`, which fails axe `color-contrast` (name, secondary line,
and initials badge all below 4.5:1). `members-dialog.tsx` drops the row
opacity and keeps the name in `text-muted-foreground` + the explicit
"Access restricted by your organization" line — the distinction stays
readable and passes WCAG.

**Follow-up recorded from the #108 branch-navigation fix (does not
block #108):** on regenerate, the streamed repository's new assistant
entry can record `parentId` = the _previous_ assistant leaf instead of
the user turn. `onReload` slices the AI SDK flat list at the parent,
re-pushes the old assistant, and `regenerate()` appends after it; when
the flat-list rebuild wins the sync race, the external-store mapping
parents the new answer under the old answer → a flat `user→asst→asst`
chain with no branch navigator. A **live user does see the flat chain
while the run streams**: `reconcileCanonicalTerminalMessages` is
skipped whenever `freshRun` is non-null (`chat-runtime.tsx:370-375`),
so the wrong parentage stays visible until the run terminates and the
reconcile reparents it — which post-#108 it now always does. Fixing the
mid-run parentage at the source (reparent from `freshTree`, or prevent
the mis-parented append) is a separate PR with RED evidence.

### Task 12 round-4 rebuild (r18 fidelity, owner rulings applied)

Round-3 sheets rejected (62/64 over the 1.5% gate). The rebuild on
`f6-r18-matters` matches the r18 prototype: matter page gets the full-width
layout with the standard composer surface, header avatars + Members + gear,
the Chats table (Chat/Owner/Last activity, own-chats-only row menus,
PagedFooter), and the Instructions side card with r18 mobile stacking;
matters list drops the description + Sort for the r18 toolbar and gains the
briefcase lead + paged footer; members dialog defaults to Editor, removes
via the x icon, and renders the owner row "(you)" + email; the share and
restrict dialogs match r18 copy/controls; the chat header gains the matter
chip (`<matter> › <title>` link, `ChatDetail.projectId`/`projectName` for
every access level). Project chats expose `ownerUserId`/`ownerName` for the
Owner column; deny rows expose `setByName` for "Restricted by <name> ·
<date>".

**Approved deviation (owner ruling):** the restricted member row keeps the
accessible variant — muted name + "Access restricted by your organization",
no row-wide opacity — ahead of the prototype docs PR that will adopt it.

**chat-share "could not load" root cause:** capture-fixture bug, not a
product bug — `installMatterFixtures` returned `{ items: [...] }` for
`GET /api/chats/:id/shares` while the endpoint returns (and the client
parses) a bare array. The fixture now mirrors the real payload and the
dialog shows Rina Kusuma's "Can view" row.
