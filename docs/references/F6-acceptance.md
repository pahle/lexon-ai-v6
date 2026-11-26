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
40P01 raced decision (became PR #97 fix), `ai-execution`
proposal-limits truncation (PR #97, environmental),
`ai-worker-crash` pause-release race (environmental), sse-load
bad-object push artifact, organizations axe-scan (unrelated e2e).

## Batch-2 remaining work

Tasks 5–10 per plan: access-change notification fan-out
(`notifyAccessChanged`), Matters/project repositories + sidebar,
member management endpoints, frontend reader view (panel hiding,
"Waiting for <owner>"), project deletion definer, acceptance matrix.
Hardening follow-ups: observations 1–3 above; retry/deadline tolerance
on `#publishCommittedLifecycle` per-chunk authority checks.
