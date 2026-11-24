# F5 Tools & Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three tools (`ask_user`, `deadline_calculator`, `rename_chat`) with owner-only snapshot-hash decisions, the 24-hour expiry sweep, the send-while-paused supersede transaction, versioned stream events, and the revision-17 thread surfaces (rows, panels, records, waiting markers), with evals incl. prompt injection and the r17 capture gate.

**Architecture:** Everything builds on the F3 machinery: `app.ai_operations` gains `kind`/`expires_at`/widened enums (migration `0042`, incl. the audit validator and Zod union — one atomic schema change); `ApprovalService` gains `decideOperation` and a real route `POST /api/runs/{runId}/operations/{operationId}/decision`; expiry is a BullMQ `upsertJobScheduler` 60 s sweep over a SECURITY DEFINER candidate function; the client keeps a paused run alive (`awaiting_approval`) and renders decision panels from the operation summary (with the tree-fetch fallback under the 4 KB event cap).

**Tech Stack:** pnpm 10.33.1, NestJS 12, PostgreSQL 17 (Drizzle SQL migrations), BullMQ 6.5.3, AI SDK 7.0.159, assistant-ui 0.15.33, Zod 4.6.7, TypeScript 6.0.3, Vitest 5.0.5, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-f5-tools-approvals-design.md` (owner-approved incl. review fixes 1–7, head `bd7d05ff`). Brief: `docs/briefs/F5-tools-approvals.md` (as synced by #74). Each task cites spec sections and the spec §17 research notes instead of repeating them. Executors read both documents first.

## Global Constraints

Copied from spec §1–§2 and the owner's session brief. Every task's requirements include this section.

### Standing rules

- **Subagents:** Devin's built-in profiles only: explore subagents for research and reading; general subagents only for code changes and task reviews. No custom subagent files. Each parallel agent works in its own git worktree.
- **TDD with RED evidence for every task:** the failing command and its output before the change, and the passing run after. No production code without a failing test first.
- **Reviews:** a spec review and a quality review per task; the report lists every finding and how it was handled.
- **PR:** a draft PR from the first task. Every report lists every workflow run on its head with conclusion and URL, from `gh pr checks <n>` run once with its exit code.
- **Assertions:** never weaken a functional, accessibility or security assertion; log every changed assertion old → new. No retries, quarantine, skips, `test.fixme`, or longer timeouts without a proven cause.
- **At most 2 Linux UI rounds** for the revision-17 captures; re-approvals and extra rounds stop for the owner. A new flake is recorded with its run URL, not fixed.
- **Docker:** only touch containers and volumes named `lexon-e2e-*`, by explicit name filter. Never prune. Never touch the unnamed volume `a4699d7d…` or any `lexon-dev_*` volume. If disk space or leftover stacks block a gate, stop and ask the owner.
- **Identity browser projects keep traces off** (F1 rule); local traces are never uploaded or committed.
- **No K1 content** (questions, answers, titles, tool inputs/outputs) in logs, traces or audit metadata (LEX-ARC-001 §6). **No model names** in commits, PRs or repo files. Never force-push.
- **Clean room (AGENTS.md):** work only from `docs/` and the code; never read the `brief-generator` branch; never read, print or commit `.env` files or keys. The implementer does not edit `docs/specs/`.
- **Session stats:** task 1 starts and ends with `/session-stats`; both outputs (cost by model) are attached to the task 1 report.
- **Research first (AGENTS.md):** before writing each task, re-read the current official docs for the libraries it touches at the pinned versions and record them in the task's evidence.

### Caps and stop points (spec §2)

- **Stop and ask the owner** if: any golden or `approval.json` needs re-approval; an official SKB source can't be cited for a future year; official docs contradict `docs/specs/`; a contract change beyond the spec is needed; the §6.4 supersede CAS cannot be made atomic in one transaction.
- Evidence file: `docs/references/F5-acceptance.md` — one short record per task (create in task 1).

### Branches and PRs

- Spec + plan ride PR #75 (`f5-tools-approvals`); it merges after the owner approves this plan. After it merges, `f5-tools-approvals` is **restarted from `origin/main`** and becomes the **integration branch** for the whole slice.
- **Do not merge task PRs into `main` one by one.** Task 4 enables the tools on the chat profiles before task 7 ships the client — on `main` that would advertise tools the client cannot render and would tear paused runs down. Every task branch `f5-t<N>-<slug>` is cut **from `f5-tools-approvals` and merges back into it** (each in its own worktree). There is **one PR to `main`, "F5 Tools & approvals", opened as a draft from task 1** (base `f5-tools-approvals` → `main`), which merges only after task 10.
- **Parallel tasks never touch the same file.** Shared files: `backend/src/modules/chat/step-executor.ts`, `backend/src/modules/chat/run-events.service.ts`, `backend/src/modules/chat/run-registry.ts`, `backend/src/modules/chat/chat-profiles.ts` — owned by task 4; later tasks re-read them after the merge-back.
- **Dependency order:** task 3 (calendar) is the only task that may run parallel with tasks 1–2. Task 6 runs after 4 (it resumes through the question/approval resume path). Task 7 runs after 4 and 5 (step-executor emitters + the decision route client). Task 8 runs after 4.
- Task 9 (visual) and task 10 (a11y/E2E sweep) are last, on a worktree branched from the merged integration head.

### Command conventions

- Backend unit: `pnpm vitest run --project backend-unit <file>; echo exit=$?`
- Backend integration **[Docker]**: `pnpm vitest run --project backend-integration <file>; echo exit=$?`
- Contracts: `pnpm vitest run --project contracts <file>; echo exit=$?`
- Frontend: `pnpm vitest run --project frontend <file>; echo exit=$?`
- Evals: `pnpm vitest run --project evals <file>; echo exit=$?`
- E2E **[Docker]**: `pnpm test:e2e --project=<project> <file>; echo exit=$?`
- Gate before each commit: `pnpm exec eslint <changed files>; echo exit=$?`, `pnpm --filter <pkg> typecheck; echo exit=$?` (or `pnpm typecheck` when `shared/` changed), `pnpm exec prettier --check <changed files>; echo exit=$?`, and the project's migration check (`drizzle-kit check` or its house equivalent) for task 1.

Markers: **[Docker]** needs local Docker. **[Linux]** needs CI evidence and counts against a cap.

## Review Focus

Failure modes the spec implies that a lazy implementation can miss. Each has a test in its owning task.

1. **The supersede tx is truly atomic.** A send racing an approve must leave exactly one winner; the rename executes at most once; a lost CAS falls back to `CHAT_CONFLICT`. Task 5.
2. **`expires_at` is set in the same commit as the pause** — an op that reaches `awaiting_approval` without `expires_at` never expires and fails the index invariant. Task 4.
3. **Byte length, not char length, decides the 4 KB cap.** A multibyte `ask_user` payload must trip the fallback; tests measure `Buffer.byteLength`. Task 7.
4. **`result.previousTitle` is stamped server-side in the decide tx**, never taken from client or model input. Task 5.
5. **The sweep never emits a `run.resume.v1` for an access-lost initiator** — the run goes `failed`/`AI_ACCESS_REVOKED` instead. Task 6.
6. **A paused run is never reaped as terminal** — `findActiveRun` keeps `awaiting_approval` alive and the poll does not tear down the stream within the 5 s window. Task 7.
7. **`pending` read ops on a superseded run settle as `failed`/`not_run`** in the same tx — no row can stay `pending` on a `completed` run. Task 5.
8. **Eval allowlists** (`backend/src/evaluation/index.ts`, `evaluation-harness.ts`) name the new scenarioIds — an unlisted scenarioId must fail loudly. Task 8.

---

### Task 1: Migration `0042` + operation types + audit types/validator + cross-tenant tests (A)

Spec §5, §8; research notes: migrations 0019/0020/0026 shapes, `lexon_validate_ai_audit`, `auth.lexon_ai_actor_facts` (0018) precedent.

**Files:**

- Create: `backend/drizzle/0042_ai_operation_kinds.sql` (+ its `backend/drizzle/meta/` journal entry per the migration convention), `backend/test/integration/ai-operation-kinds.spec.ts`, `backend/test/integration/ai-expired-operations-grants.spec.ts`.
- Modify: `backend/src/infrastructure/db/ai-records.ts` (kind/expires_at/statuses on `OperationProposal`/`OperationRecord`/`AiOperationStatus`), `backend/src/infrastructure/db/ai-operation.repository.ts` (`persist` kind, `decideApproval` kind-aware CAS, `pendingFromPreviousStep`, expiry helpers), `backend/src/infrastructure/db/schema.ts` (sync all columns incl. the `decision*` lag), `backend/src/modules/audit/audit-event.ts` (widened enums + new `chat.question_decided.v1`).
- Evidence: `docs/references/F5-acceptance.md` (create, `## Task 1`).

**Interfaces produced:** the new op columns/statuses and the audit union that every emitter task (5, 6, 7) uses.

- [ ] **Step 0:** `/session-stats`; save output **for the report only — never a repo file** (it names models). Create worktree `../lexon-f5-t1` on branch `f5-t1-operation-kinds` **cut from `f5-tools-approvals`**; open the draft PR "F5 Tools & approvals" (base `f5-tools-approvals` → `main`).
- [ ] **Step 1: Write the failing tests.**
  - `ai-operation-kinds.spec.ts` **[Docker]**: `it('rejects a pause op without expires_at and an unknown kind')` (CHECK violations); `it('requires result+completed_at for answered/dismissed/expired')`; `it('backfilled rows carry created_at + 24h and are indexed')` (seed an `awaiting_approval` row pre-migration shape, assert `expires_at IS NOT NULL` and `EXPLAIN` uses `ai_operations_expiry_idx`); `it('a tenant cannot read or write kind/expires_at on another org\'s op')` (RLS under `withTenant` of org B on org A's row).
  - `ai-expired-operations-grants.spec.ts` **[Docker]**: `it('returns only the four id columns')` (`SELECT *` → keys are exactly `org_id,id,run_id,initiating_user_id`); `it('returns candidates across orgs, ids only')`; `it('lexon_auth, lexon_setup and an ungranted role are denied')` (`permission denied for function ai_expired_operations` for each).
  - `audit-event` unit spec (extend the existing file): `chat.question_decided.v1` accepts `{runId,operationId,status:'answered'|'dismissed'|'expired',reason?}` and rejects any extra key and any status outside the enum; `chat.approval_decided.v1` accepts `status:'expired'` and `reason:'superseded_by_message'`; `chat.tool_operation.v1` accepts the three new statuses; every new payload rejects a `question`/`title`/`args`/`result` key (K1 discipline).
- [ ] **Step 2: RED.** `pnpm vitest run --project backend-integration backend/test/integration/ai-operation-kinds.spec.ts backend/test/integration/ai-expired-operations-grants.spec.ts; echo exit=$?` → exit 1 (columns/function missing). Unit audit spec → exit 1 (unknown event type/status).
- [ ] **Step 3: Write migration `0042` and apply the code changes** exactly per spec §5 (columns, CHECKs, partial index, `expires_at` backfill `created_at + interval '24 hours'`, replaced `lexon_validate_ai_audit`, `ai_expired_operations` with `REVOKE EXECUTE … FROM PUBLIC; GRANT EXECUTE … TO lexon_app; SET search_path = app, pg_temp`) and §8 (Zod union entries incl. `outcome:'failure'` for `expired`).
- [ ] **Step 4: GREEN** — same commands → exit 0. Migration check (`drizzle-kit check` or house equivalent) → exit 0.
- [ ] **Step 5: Gate + commit.** `pnpm exec eslint <files>`, `pnpm typecheck`, `pnpm exec prettier --check <files>`; commit `feat(chat): operation kinds, expiry and audit contract (0042)`; push; draft PR "F5 task 1 — operation kinds & audit".
- [ ] **Step 6:** `/session-stats`; attach both outputs to the report.

**Review focus:** the widened CHECKs exactly match spec §5 (no extra status); the backfill is present; grants are to `lexon_app` only with `PUBLIC` revoked; `search_path` is pinned; no K1 key is anywhere in the validator or the Zod union; `schema.ts` no longer lags `decision*`.

**Evidence:** RED/GREEN outputs; the migration file; the grant-denial outputs; `/session-stats`.

---

### Task 2: Shared contracts — op summary, `question-required`, statuses, decision schemas, job envelope (A, after 1)

Spec §9 (schema bullets), §7 (job envelope); research notes: `shared/src/ai-run.ts`, `shared/src/chat.ts` current unions.

**Files:**

- Modify: `shared/src/ai-run.ts` (`OperationStatusSchema` += `answered|dismissed|expired`; `approval-required` += optional `operation`; new `question-required`; `ai.operation-expiry.v1` in `RunJobSchema`), `shared/src/chat.ts` (`ChatOperationSnapshotSchema` += `kind,snapshotHash,expiresAt,decidedAt,toolName,input?,display?,output?`; `ChatSnapshotPartSchema` += `tool` member; `ChatPageSchema` items += `awaitingUser`; new `OperationDecisionInputSchema`/`OperationDecisionResultSchema`), any server emitters' types that consume them.
- Test: extend the contract specs under `contracts`/shared test dir (whichever the repo uses for `ai-run.ts`/`chat.ts` — find the existing event-schema spec and extend it).

**Interfaces produced:** the wire shapes task 7 publishes and the client maps.

- [ ] **Step 1: Failing tests** — schema spec cases: `OperationStatusSchema` accepts the three new statuses; `question-required` parses `{operationId, operation}`; `approval-required` parses with and without `operation`; a `snapshot-operation` frame parses with and without `input/display/output` (cap-fallback shape); `ChatOperationSnapshotSchema` round-trips `snapshotHash`; `OperationDecisionInputSchema` accepts each action and rejects a non-answer payload on `action:'answer'` and a missing `answers` array; `RunJobSchema` accepts `ai.operation-expiry.v1` with `data:{}`.
- [ ] **Step 2: RED** — `pnpm vitest run --project contracts <schema spec>; echo exit=$?` → exit 1.
- [ ] **Step 3: Implement** the schema changes; `pnpm typecheck` whole workspace (server emitters may need type updates — only type-level, no behavior).
- [ ] **Step 4: GREEN** → exit 0; gate; commit `feat(shared): F5 operation stream contracts`; push; draft PR.

**Review focus:** additive only (nothing removed/renamed); the `tool` snapshot-part member carries `operationId`; `awaitingUser` is a required boolean on page items (never optional so clients can't forget it); job envelope registered like the existing types.

**Evidence:** RED/GREEN outputs; the schema diffs.

---

### Task 3: Calendar data file + `deadline_calculator` + 90-day guard (B)

Spec §10 (deadline row), §11; research notes: SKB 2026 (1497/2/5-2025) + SKB 2027 (1205/3/2-2026) verified sources and date lists.

**Files:**

- Create: `shared/src/calendar/id-national-holidays.ts` (typed const + `CalendarDataSchema` + `version:'id-national@2027.1'` + per-year `decree` blocks citing the two SKB PDFs + setneg/kemnaker lampiran URLs), `shared/src/calendar/index.ts`, `backend/src/modules/chat/deadline-calculator.ts` (tool impl beside `tool-executor.ts`), `backend/test/unit/deadline-calculator.spec.ts`, `scripts/test/id-calendar-guard.spec.mjs` (CI repo-health convention, `node --test`).

**Interfaces produced:** `ID_NATIONAL_CALENDAR` + the calculator `execute` used by task 4's registration.

- [ ] **Step 1: Failing tests.**
  - `deadline-calculator.spec.ts`: arithmetic matrix — `calendar_days`/`working_days` with `countStartDay` true/false; `months`/`years` clamp (2026-01-31 + 1 month → 2026-02-28) with `countStartDay` ignored; `working_days` across a 2026 cuti bersama week (`skippedDays` lists each skipped date + name, weekends named "Saturday"/"Sunday"); `nonWorkingDayRule:'next_working_day'` vs `'none'` on a holiday landing; `calendarVersion` in the result; outside covered years → `failed` result `{refused:'outside_calendar_range', coveredYears:[2026,2027]}`.
  - `id-calendar-guard.spec.mjs`: schema spec — every `date` parses ISO, kinds are `holiday|cuti_bersama`, `decree` fields non-empty with `https` URLs; the guard — `today` injected as `new Date('2027-10-02')` fails with the add-year message, `new Date('2027-10-01')` passes (reads `lastCoveredYear` from the module, never a literal).
- [ ] **Step 2: RED** → exit 1 (module/tool missing).
- [ ] **Step 3: Implement** — the data file verbatim from spec §17 lists; the calculator per spec §10 semantics (approach F refusal as a `failed` op result, not a throw past the boundary).
- [ ] **Step 4: GREEN** → exit 0; gate; commit `feat(shared): Indonesian national calendar + deadline calculator`; push; draft PR.

**Review focus:** date lists match the spec §17 lists exactly (diff them); `countStartDay` cannot affect months/years; `skippedDays` scope per unit per spec; the guard reads the module (no hard-coded year anywhere); refusal is a `failed` op result the model reads.

**Evidence:** RED/GREEN; the SKB citation block; guard output with both injected dates.

---

### Task 4: Tool registration, profile caps/iterations, engine question-kind, instructions (B, after 1)

Spec §10 preamble + all three tool rows; research notes: `PRODUCTION_ENGINE_REGISTRATIONS`, `chat-profiles.ts`, `step-executor.ts` proposal flow, `chat-instructions.ts` — all under `backend/src/modules/chat/`.

**Files:**

- Create: `shared/src/chat-tools.ts` (the three tools' Zod input schemas — `shared/` gains a module **only** for the schemas; registration stays backend-side).
- Modify: `backend/src/modules/chat/run-contracts.ts` (`ToolBase.pauseKind`; `ToolDefinition` union += `kind:'pause'` member), `backend/src/modules/chat/run-registry.ts` + `index.ts` (`PRODUCTION_ENGINE_REGISTRATIONS` += the three tools), `backend/src/modules/chat/chat-profiles.ts` (`capabilities: ['chat.ask','chat.deadline','chat.rename']`, `maxIterations: 1 → 6`), `backend/src/modules/chat/step-executor.ts` (kind propagation, one-pause-per-generation, ask_user ≤2-per-run counter incl. same-generation, refusal→`failed`-op path), `backend/src/modules/chat/chat-instructions.ts` (Tools section + version bump).
- Test: extend `backend/test/unit/run-registry.spec.ts`, create `backend/test/unit/step-executor-tools.spec.ts` (or extend the existing executor spec), `backend/test/integration/step-executor-tools.spec.ts` **[Docker]** for the DB-backed flows.

**Interfaces produced:** the engine paths task 5's decide/resume and task 6's expiry resume rely on.

- [ ] **Step 1: Failing tests.**
  - `run-registry.spec.ts` (extend): the three tools registered with correct `kind`/`pauseKind`/capabilities/mode; the `shared/src/chat-tools.ts` schemas reject out-of-range (empty questions, 4 questions, 6 options, label >80, text >300, `newTitle` >120, `currentTitle` present in args → schema strips/rejects); `.describe()` present on key fields.
  - `step-executor-tools.spec.ts` **[Docker]** where the flow needs DB: a generation proposing `ask_user` persists a `kind:'question'` op in `awaiting_approval` **with `expires_at` set in the same commit**; a generation proposing two pause tools → first pauses, second persisted `failed`/`one_decision_at_a_time`; the 3rd `ask_user` in a run → `failed`/`question_limit` with `maxPerRun:2`; an `ask_user` result from a stored decision is fed to the next generation via `toolResultsAsMessages` + `fenceUntrusted` (never raw); `pending` read op + pause op in one generation → run pauses, read op executes on the resumed continuation.
  - Profile spec: chat profiles carry the three capabilities and `maxIterations: 6`; a run reaching the limit after tool flow ends `failed`/`AI_ITERATION_LIMIT` (existing failure surface — records the safe copy).
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** per spec §10 (incl. `CHAT_INSTRUCTIONS` Tools section + `.describe()`).
- [ ] **Step 4: GREEN** → exit 0; gate; commit `feat(chat): register the three F5 tools`; push; draft PR.

**Review focus:** `expires_at` written only in the pause commit; refusal ops always carry a stored result (never a dropped tool call); capabilities gate proposals exactly as F3 (`AI_INVALID_TOOL` for non-permitted tools); `maxIterations` bump is the only profile change besides capabilities.

**Evidence:** RED/GREEN; profile diff; instruction version bump note.

---

### Task 5: Decision route + send-while-paused supersede tx (B, after 4)

Spec §6.2–§6.4, §9 decision schemas; research notes: `ApprovalService.decide` skeleton, `ChatService.send` conflict path, `0026` trigger ordering.

**Files:**

- Create: `backend/src/modules/chat/operations.controller.ts`, `backend/test/integration/operation-decision.spec.ts`, `backend/test/integration/send-while-paused.spec.ts`.
- Modify: `backend/src/modules/chat/approval.service.ts` (`decideOperation` generalized by kind; `result.previousTitle` stamped in-tx), `backend/src/modules/chat/chat.service.ts` (send-while-paused branch before the `CHAT_CONFLICT` check), `backend/src/modules/chat/chat.module.ts` (controller), `ai-run` `transitions` += `awaiting_approval→completed` (repository transition table).

**Interfaces produced:** the route + tx the client (task 7) and the E2E (task 10) exercise.

- [ ] **Step 1: Failing tests.**
  - `operation-decision.spec.ts` **[Docker]**: owner `approve` → CAS → audit → resume outbox + run `running`; `answer` validated against stored args (unknown `questionId`, out-of-range index, text when `allowFreeText:false`, >500 chars, incomplete coverage → 400); `dismiss`; **idempotent replay** — repeat same action → 200 stored outcome; **conflicting action** → 200 stored outcome (no error); **owner-only**: member/org owner/platform admin/other org → 404; stale/mismatched `snapshotHash` → the CAS-loss refusal; kind/action mismatch → 400.
  - `send-while-paused.spec.ts` **[Docker]**: send while a question is open → op `dismissed`/`{answered_in_chat:true}`, run `completed`, audit `reason:'superseded_by_message'`, new run queued, all questions recorded "Answered in chat"; send while an approval is open → op `rejected`/`{denied:'superseded'}`, same pattern; **leftover `pending` read ops settle `failed`/`not_run`**; **`run_finished.v1` audit for the superseded run**; **the CAS race** (approve+send in flight — exactly one wins; rename executes at most once — run the pair concurrently and assert final state); CAS-loss path → `CHAT_CONFLICT`.
- [ ] **Step 2: RED** → exit 1 (route 404; send → `CHAT_CONFLICT`).
- [ ] **Step 3: Implement** — `decideOperation` (kind-aware CAS + stored results + audit + resume), the controller (404 for non-owners incl. platform admin — never a distinguishing status), the supersede tx per spec §6.4 steps 1–3 (op CAS → settle others → run `completed` + `run_finished.v1` → message → new run → `run.start.v1`).
- [ ] **Step 4: GREEN** → exit 0; gate; commit `feat(chat): operation decision route + send-while-paused supersede`; push; draft PR.

**Review focus:** the whole supersede is one tenant tx (verify no interleaving point — read the tx boundary); `previousTitle` is stamped server-side only; the 404 never differs by role; no `run.resume.v1` is emitted for the superseded run; `answer` validation happens before the CAS and is skipped on replay.

**Evidence:** RED/GREEN; the race-test output (both interleavings asserted); audit rows (no K1).

---

### Task 6: Expiry job — scheduler + sweep + resume + poison candidates (B, after 4)

Spec §7; research notes: `upsertJobScheduler` (BullMQ 6.5.3), `QueueConsumer` strategy pattern, `rejectApprovalForAccessLoss` precedent.

**Files:**

- Create: `backend/src/infrastructure/queue/expiry-sweep.ts` (or the consumer-strategy file convention), `backend/test/integration/expiry-sweep.spec.ts`.
- Modify: `backend/src/infrastructure/queue/queue-consumer.ts` (route `ai.operation-expiry.v1` by job name), `backend/src/entrypoints/ai-worker/main.ts` (`upsertJobScheduler('ai-operation-expiry', {every:60_000}, …)` — spec §7 exact options).

**Interfaces produced:** none consumed by later tasks (terminal consumer).

- [ ] **Step 1: Failing tests** `expiry-sweep.spec.ts` **[Docker]**: candidate → `expired` + result + audit actor-null + run `running` + `run.resume.v1` enqueued (the resumed run then completes the notice turn per §6.5); question variant (`{unanswered:'question'}`); CAS-loss no-op (decide between listing and processing); **poison candidate** (initiator deactivated → op `expired`, run `failed`/`AI_ACCESS_REVOKED`, no resume); **batch isolation** (poison first, healthy second still expires); scheduler registration spec (bootstrap calls `upsertJobScheduler` once per replica with id `ai-operation-expiry` — a second upsert is a no-op).
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** per spec §7.
- [ ] **Step 4: GREEN** → exit 0; gate; commit `feat(chat): operation expiry sweep`; push; draft PR.

**Review focus:** per-candidate try/catch + own tx; `withTenant({orgId, userId: initiating_user_id})`; `expires_at` re-checked inside the tx; audit actor `null`; no `publicationDeadlineMs` machinery on this job; `stepJobId` dedup on the resume.

**Evidence:** RED/GREEN; poison + isolation outputs; registration proof.

---

### Task 7: Stream publishers + client mapping + rows/panels/records + waiting markers + composer rules (C, after 4 and 5)

Spec §9 (all client bullets), §15; research notes: `chat-stream.ts` `chunksFromFrame`, `findActiveRun`, `run-events.service.ts`, `authorizedChatSnapshot`, `use-tree-polling`, r17 `prototype.html` panel markup.

**Files:**

- Modify: `backend/src/modules/chat/run-events.service.ts` + `step-executor.ts`/`step-coordinator.ts` emitters (publish `tool-input-available`, `tool-output-available`/`tool-output-denied`, `*-required` with summary, `operation-status` new statuses; **event-cap drop logic** per spec §9), `backend/src/infrastructure/db/ai-run.repository.ts` (`authorizedChatSnapshot` ops summary incl. `snapshotHash`/`display`; cap-fallback frame shape), the chat page mapper (`awaitingUser`), `chat.invalidated` on pause/decision/expiry transitions.
- Create: `frontend/src/components/chat/chat-operation-panel.tsx` (the docked panel in `ComposerPrimitive.Root`, `useAuiState` selector, calls the decision route), `frontend/src/components/chat/chat-tool-row.tsx` (the `components.tools.Fallback`/`by_name` row + decision records).
- Modify (client): `frontend/src/lib/chat-stream.ts` (`chunksFromFrame` event→part mapping + missing-summary tree-fetch fallback), `frontend/src/components/chat/chat-runtime.tsx` (`findActiveRun` learns `awaiting_approval` — new `ChatAwaitingContext`; send enabled while paused; Stop hidden when paused), `frontend/src/lib/chat-client.ts` (decision route client), `frontend/src/components/assistant-ui/elements/thread.aui.tsx` (wire the row + records components), `frontend/src/components/chat/chat-history.tsx` (waiting markers), `frontend/src/components/chat/use-tree-polling.ts` (keep the paused run's stream alive).
- Test: `backend/test/unit/run-events-ops.spec.ts`, `backend/test/integration/chat-ops-stream.spec.ts` **[Docker]**, `frontend/test/chat-stream-ops.spec.tsx`, `frontend/test/chat-awaiting-panel.spec.tsx`, `frontend/test/chat-page-awaiting.spec.tsx`.

**Interfaces produced:** the full live path task 10's browser specs exercise.

- [ ] **Step 1: Failing tests.**
  - Backend: `tool-input-available` published on proposal (running row); `approval-required`/`question-required` carry the op summary under the cap; **over-cap events (maximal multibyte `ask_user` input — `Buffer.byteLength` > 4096) drop `operation`/`input` but keep `operationId`/`kind`/ids**; `snapshot-operation` frame cap-fallback shape; `operation-status` emits `answered|dismissed|expired`; `chat.invalidated` fires on pause + on decision; `awaitingUser` true while paused, cleared after.
  - Frontend: `chunksFromFrame` maps each event to the right part state; a missing-summary `question-required` triggers a tree fetch (spy) and still renders the panel; paused run is not torn down (poll stays active past the 5 s window); panel renders options as a radio group, number keys select, Esc dismisses, Ctrl+Enter approves, Enter never approves; send enabled while paused → calls send (the supersede is server-side); **two-tab case** — a 200 stored-outcome response different from the sent action renders the stored record and closes the panel; decision records render from op state (approved/rejected/expired/"Answered in chat"/"Not run"); rows render live and identically after a replayed snapshot.
- [ ] **Step 2: RED** → exit 1 per suite.
- [ ] **Step 3: Implement** per spec §9 mapping table + §15 keyboard/a11y rules (radio-group pattern from `frontend/src/components/settings/appearance-settings.tsx`, `role="status"` announcements).
- [ ] **Step 4: GREEN** → exit 0; gate; commit `feat(chat): tool rows, decision panels, waiting markers`; push; draft PR.

**Review focus:** the cap logic compares **bytes** not chars; the fetch fallback is exercised (not just coded); `requires-action`/Stop/composer states match D7 (no Stop while paused); decision records are derived from op state, never from model text; no K1 in any log/audit path touched; axe runs on the new components in both themes.

**Evidence:** RED/GREEN; the byte-length test; the fetch-fallback spy output; the paused-run survival proof.

---

### Task 8: Evals (C, after 4)

Spec §13; research notes: `evals/` layout, `backend/src/evaluation/index.ts` + `evaluation-harness.ts` allowlists, fixture `context.decide` precedent.

**Files:**

- Create: `evals/test/ask-user.spec.ts`, `evals/test/deadline.spec.ts`, `evals/test/rename-approval.spec.ts`, `evals/test/injection-tools.spec.ts`, `evals/test/expiry.spec.ts` (+ scenario fixtures under the evals fixture layout).
- Modify: `backend/src/evaluation/index.ts`, `backend/src/evaluation/evaluation-harness.ts` (scenarioId allowlists, scoreCountKeys, audit assertions), `evals/` fixture tools (`ask_user` as a real pause tool).

- [ ] **Step 1: Failing tests** — the five spec files per spec §13 assertions (`ask-user`: asks when missing/doesn't when given; `deadline`: calculator used with correct inputs, inputs shown; `rename-approval`: proposes only when asked, pause, approve→once, reject→no effect; `injection-rename`/`injection-skip-approval`: at most one panel, `effects:0`, no effect until owner approves; `expiry`: expired op → resume → one-sentence notice → completes). Also `it('rejects an unlisted scenarioId')` for the allowlist itself.
- [ ] **Step 2: RED** → exit 1.
- [ ] **Step 3: Implement** fixtures + allowlists.
- [ ] **Step 4: GREEN** → exit 0; gate; commit `test(evals): F5 tool scenarios incl. prompt injection`; push; draft PR.

**Review focus:** all new specs live under `evals/test/` (they ride the CI eval subset via root `pnpm test`); fixture `ask_user` pauses like production (kind question); injection assertions assert the _absence_ of effect, not just copy.

**Evidence:** RED/GREEN; the allowlist diff.

---

### Task 9: Visual captures — r17 planned→pending, masks, Linux rounds, 1.5% gate (last)

Spec §14; research notes: `index.json` 52 planned ids, `captureBrandViews` convention, `PROTOTYPE_REVISION` binding.

**Files:**

- Modify: `docs/references/F4.1-visual/index.json` (52 ids → `pending`), `backend/test/e2e/brand-visual-chat.spec.ts` (12 `captureBrandViews`), `backend/test/e2e/brand-visual-chats-settings.spec.ts` (`chats-waiting`), `scripts/visual-compare-prototype.mjs` (`PROTOTYPE_REVISION` → 17), `docs/design/f4.1-prototype/README.md` (lead line 16 → 17), app-side capture fixtures (`installChatFixtures`/`installRunStreamFixture` for `awaiting_approval`/tool events/panels/records), the mask list (shimmer label, waiting dot/pill if animated).
- Evidence: CI `pending-compare` artifacts, `deviations.md` rows, golden `update` output.

- [ ] **Step 1: Failing tests** — `node scripts/test/prototype-state-ids.spec.mjs` + `visual-index.spec.mjs` → exit 1 (ids still `planned`, revision 16).
- [ ] **Step 2: GREEN-code** — the `pending` moves + `captureBrandViews` calls + `PROTOTYPE_REVISION` 17 + README line; specs pass → exit 0.
- [ ] **Step 3:** `run chat --ids <f5 ids> --linux`; push; **[Linux]** CI `pending` captures + `pending-compare` sheets → owner eye review (round 1 of ≤2).
- [ ] **Step 4:** accepted over-gate rows logged in `deviations.md`; approval + `update` writes `baseline/` goldens; the new app goldens pass the 1.5% gate (`maxDiffPixelRatio` + `--gate`).

**Review focus:** every r17 state appears (13 × 4 = 52, call-count invariant); masks added before capture (no shimmer flakiness); axe on each new capture both themes; deviations logged, not silently accepted; **any golden re-approval is a stop point**.

**Evidence:** spec-test RED/GREEN; CI artifact links; `deviations.md` rows; gate output.

---

### Task 10: Accessibility + acceptance sweep + E2E (last)

Spec §15, §18 (every row), spec §6.4 test list.

**Files:**

- Create/extend: `backend/test/e2e/chat-tools.spec.ts` **[Docker]** (pause→decide→resume in browser; the expiry case sets `expires_at` in the past via a **test-side DB update through the existing E2E helpers** — no product config, env var or route that shortens the 24 h; send-while-paused redirect; reload parity), `frontend/test/thread-a11y.spec.tsx` (axe on panel/rows/records both themes, keyboard order).
- Evidence: the completed §18 map — every brief criterion ticked against a named passing test; `docs/references/F5-acceptance.md` final entry; `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `gh pr checks` once.

- [ ] **Step 1:** write the browser specs and the a11y spec. These are **acceptance tests, no RED** — the flows ship in tasks 4–7; a green run here is the expected outcome, not a skipped discipline.
- [ ] **Step 2:** fix gaps found by the sweep only — each fix gets its own RED first (a reproduction spec that fails before the fix); anything beyond spec → stop point.
- [ ] **Step 3:** final gates green; report every workflow run on the head with conclusion + URL.

**Review focus:** every §18 row maps to a named, passing test; no assertion weakened anywhere in the slice (the old→new log is empty or justified); E2E covers live, reload, and the send redirect.

**Evidence:** the full §18 checklist; final CI head report.

---

## Spec coverage

| Spec section                                            | Task(s)                      |
| ------------------------------------------------------- | ---------------------------- |
| §5 data model + migration + cross-tenant + grants       | 1                            |
| §6.1–§6.3 kinds/hash/route, §6.4 supersede, §6.5 resume | 1, 4, 5 (6.5 also 6)         |
| §7 expiry job                                           | 6                            |
| §8 audit                                                | 1 (+ emitters in 4, 5, 6, 7) |
| §9 stream contract + client + cap fallback + two-tab    | 2, 7                         |
| §10 tools + profiles + instructions                     | 3, 4                         |
| §11 calendar + guard                                    | 3                            |
| §12 injection guard                                     | 4 (instructions), 8 (evals)  |
| §13 evals                                               | 8                            |
| §14 captures                                            | 9                            |
| §15 accessibility                                       | 7, 10                        |
| §18 acceptance map                                      | 10 (final sweep)             |

Every §18 acceptance criterion is owned by a named test in tasks 1–10; task 10 closes the map.
