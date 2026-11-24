# F5 acceptance evidence

Status: implementation in progress. Task 1 (operation kinds, expiry and audit
contract, migration 0042) is implemented with local RED/GREEN and gate evidence;
task review and owner acceptance remain pending. This is not F5 completion.

Design and plan: [approved design](../superpowers/specs/2026-11-24-f5-tools-approvals-design.md).
Branch: `f5-t1-operation-kinds` (cut from `f5-tools-approvals`). Draft PR
pending. No merge to main is authorized.

## Task 1 — operation kinds, expiry columns and audit contract (0042)

`backend/drizzle/0042_ai_operation_kinds.sql` (+ `drizzle/meta/_journal.json`
entry idx 42, `when: 1793404800042`, `breakpoints: true`).

- `app.ai_operations`: `kind text NOT NULL DEFAULT 'approval'` with
  `CHECK (kind IN ('approval','question'))`; `expires_at timestamptz`;
  `status` CHECK widened to the §5 enum
  (`pending,awaiting_approval,approved,rejected,answered,dismissed,expired,succeeded,failed,outcome_unknown`);
  `decision` CHECK widened to `('approve','reject','answer','dismiss')`;
  `ai_operations_decision_lifecycle` replaced so `answer`/`dismiss` require
  `decided_at` + `decision_by_user_id`, and `expired` requires `decision IS NULL`,
  `decision_by_user_id IS NULL`, `decided_at IS NOT NULL`;
  `ai_operations_lifecycle` replaced so `answered`/`dismissed`/`expired` require
  `result IS NOT NULL AND completed_at IS NOT NULL` (same rule as `rejected`)
  and `expires_at` is non-NULL exactly while `status='awaiting_approval'`.
- Backfill `expires_at = created_at + interval '24 hours'` for legacy
  `awaiting_approval` rows; partial index `ai_operations_expiry_idx` on
  `(expires_at) WHERE status='awaiting_approval'`.
- `app.ai_expired_operations(batch int)`: `STABLE SECURITY DEFINER`,
  `SET search_path = app, pg_temp`, `REVOKE ALL … FROM PUBLIC, lexon_auth`,
  `GRANT EXECUTE … TO lexon_app`; returns exactly
  `{org_id, id, run_id, initiating_user_id}` for
  `status='awaiting_approval' AND expires_at <= clock_timestamp()`
  ordered by `expires_at` — ids only, per §5/§20.23.
- `CREATE POLICY ai_operations_internal … FOR ALL TO lexon_migrator
USING (true) WITH CHECK (true)`: required because `ai_operations` is
  FORCE-RLS and `lexon_migrator` is `NOBYPASSRLS` — without it the backfill
  UPDATE sees zero rows and the SECURITY DEFINER function cannot read the
  table (`ai_run_chat_trigger_internal` 0027 precedent). Verified empirically:
  the first upgrade-path run failed `ai_operations_lifecycle` validation on an
  unbackfilled row until the policy was added.
- `auth.lexon_validate_ai_audit` replaced (0035 superset): keeps all five
  existing `chat.*` cases and strict-json key checks; `chat.tool_operation.v1`
  status gains `answered`/`dismissed`/`expired` (success set =
  `proposed,pending,completed,answered,dismissed`); `chat.approval_decided.v1`
  gains `status='expired'` + optional `reason:'superseded_by_message'`;
  new `chat.question_decided.v1` `{runId,operationId,status,reason?}`;
  `actorUserId` is required for every event except decided events with
  `status='expired'` (actor null → `jsonb_strip_nulls` drops the key).
- `audit-event.ts`: Zod union mirrors the validator one-to-one —
  `aiToolOperation` widened, `aiApprovalDecided` widened with `actorUserId`
  optional + outcome/actor agreement refine, new `aiQuestionDecided` member.
- `ai-records.ts`: `AiOperationKind`, `AiOperationDecision`, widened
  `AiOperationStatus`; `OperationProposal.kind?` (absent ⇒ `'approval'`),
  `OperationRecord.kind`/`expiresAt`/`decision` widened.
- `ai-operation.repository.ts`: `OperationRow`/`mapOperation` cover the new
  columns; `persist` writes `kind` + `expires_at` (24 h when pausing);
  `decideApproval` is the kind-aware CAS
  (`kind='approval'` ⇒ `approve`/`reject`, `kind='question'` ⇒ `answer`/`dismiss`,
  `answer` requires `input.result`), clears `expires_at`, stamps the stored
  result (`{denied}` / `{answered_in_chat:true}` / caller answers);
  `stageApproval` stamps `expires_at`; both access-loss paths clear it;
  new `expire` CAS (`awaiting_approval` + `expires_at <= clock_timestamp()` →
  `expired` + kind-shaped stored result `{expired:'approval'}` /
  `{unanswered:true}`, `decision`/`decision_by_user_id` left NULL);
  `pendingFromPreviousStep` still returns all paused ops `FOR UPDATE`.
- `schema.ts` synced: `kind`, `expiresAt`, `decision`, `decisionByUserId`,
  `decidedAt` + the partial index — closes the documented `decision*` lag.
- `shared/src/ai-run.ts`: `OperationStatusSchema` += `answered|dismissed|expired`
  per §9 (additive wire change; emitters already map `succeeded`→`completed`).

### Test evidence

RED (recorded before implementation):

```
pnpm vitest run --config ../vitest.config.ts --project backend-unit \
  backend/test/unit/ai-audit-event.spec.ts
→ 3 failed / 3 passed (Invalid audit event: question_decided type, expired
  approval, widened tool_operation statuses)

pnpm vitest run --config ../vitest.config.ts --project backend-integration \
  backend/test/integration/ai-operation-kinds.spec.ts \
  backend/test/integration/ai-expired-operations-grants.spec.ts
→ 8 failed / 8 (42703 column kind does not exist; 23514
  ai_operations_decision_check rejecting 'answer'; Migration 0042 journal
  entry missing; permission/function absent)
```

GREEN:

```
unit:        6/6 pass (ai-audit-event), 13/13 pass (tool-recovery)
integration: 4/4 pass (ai-operation-kinds), 4/4 pass (ai-expired-operations-grants)
regression:  10 spec files, 116/116 — ai-approval, ai-approval-concurrency,
             ai-execution, ai-privacy-audit, ai-tools, rls-catalog,
             migrations, ops-privileges, audit-append-grant, audit-store
drizzle-kit check → "Everything's fine" exit 0
pnpm exec tsc --noEmit (backend) → clean
pnpm exec eslint <changed files> → clean
pnpm exec prettier --check <changed files> → clean after --write on 3 files
```

Grant-denial output (from `ai-expired-operations-grants.spec.ts`):
`lexon_auth`, `lexon_setup` and `lexon_spec_guest` (created `LOGIN` role, no
grants) each get `42501` / `permission denied for function
ai_expired_operations`, with schema USAGE granted first so the denial is
provably at the function grant. Catalog check asserts `prosecdef`, pinned
`search_path=app, pg_temp`, EXECUTE holders = `{lexon_app, lexon_migrator(owner)}`.

### Research notes (verified against official docs, 2026-11-24)

- PostgreSQL 17 `CREATE FUNCTION`: `SECURITY DEFINER` + `SET search_path`
  pinning (`pg_temp` last) per `auth.lexon_ai_actor_facts` (0018) precedent;
  functions grant `EXECUTE` to `PUBLIC` by default → explicit `REVOKE` needed.
- PostgreSQL 17 row security: FORCE RLS applies to the table owner when the
  role is `NOBYPASSRLS` → the migrator policy is mandatory for backfill+SELECT.
- Partial index predicates match only literal query clauses — the spec's
  literal `status='awaiting_approval'` is index-compatible (verified by
  `EXPLAIN` in `ai-operation-kinds.spec.ts`, `enable_seqscan=off`).
- Drizzle journal convention observed: `version:"7"`, sequential `idx`,
  `when` continuing the `17934048000xx` series, `breakpoints:true`.
- Zod 4.6.7: `z.strictObject` rejects unknown keys (K1 discipline at the
  union layer); `exactOptionalPropertyTypes` requires `| undefined` on
  optional refine parameter types.
- drizzle-orm 0.45.4 migrator applies journal entries split on
  `--> statement-breakpoint`; `drizzle-kit check` (0.31.11) validates journal
  consistency — the house equivalent gate, run clean.

### Deviations / calls within spec latitude

- Expired-question stored result uses `{unanswered:true}` (§10 tool table —
  the precise contract, consistent with `{denied:true}`/`{answered_in_chat:true}`
  boolean flags) rather than §7's `{unanswered:'question'}` shorthand.
- `expire` lands in the repository now (the sweep's CAS) even though the
  sweep job is a later task; `{expired:'approval'}` matches §6.1/§7.
- `persist` keeps `kind` optional on `OperationProposal` and defaults to
  `'approval'` — step-executor (task 4 file) keeps compiling unchanged.

## Task 2 — operation stream contracts

`shared/src/ai-run.ts` + `shared/src/chat.ts` (commit `5e5e16b3`, draft PR
#79 → `f5-tools-approvals`).

- `OperationKindSchema` (`'approval'|'question'`); `OperationStatusSchema`
  already widened in task 1 (answered/dismissed/expired).
- `ChatOperationSnapshotSchema` moved to `ai-run.ts` (the pause events carry
  it) and re-exported from `chat.ts`; now the full wire summary —
  `operationId`, `kind`, `status`, `approvalRequired`, `snapshotHash`
  (64-hex), `expiresAt`/`decidedAt` (ISO-Z, required-nullable), `toolName`,
  plus optional `input`/`display`/`output` so the 4 KiB cap fallback can
  drop them while the client refetches the tree.
- `approval-required` gains optional `kind:'approval'` + `operation`
  (summary pinned to `kind:'approval'` via `.extend`); new
  `question-required` member mirrors it (`operationId`, optional
  `kind:'question'`, optional pinned summary).
- New `RunJobSchema` member `ai.operation-expiry.v1`
  (`strictObject({type, data: strictObject({})})` — no `ctx`/`outboxId`;
  the BullMQ-scheduled sweep discovers tenants per candidate row).
- `ChatSnapshotPartSchema` gains `{type:'tool', id, toolCallId, toolName,
operationId, input?, output?, outcome}` (`outcome` = operation status).
- `ChatPageSchema` items gain required `awaitingUser: boolean`; assistant
  `ChatMessageSchema` members gain required
  `operations: ChatOperationSnapshotSchema[]`.
- `OperationDecisionActionSchema`, `OperationAnswerChoiceSchema`
  (option | options | text | skipped; `options.indexes` non-empty,
  distinct, bounded 0–4), `OperationAnswerSchema`,
  `OperationDecisionInputSchema` (discriminated on `action`; `answers`
  required exactly for `answer`, forbidden elsewhere — strict objects),
  `OperationDecisionResultSchema` (`{operationId, status, decision,
decidedAt}` — `decision`/`decidedAt` required-nullable for the
  idempotent read-back).

Server emitters updated so required fields are produced at runtime
(`ChatSnapshotSchema.parse` runs on the snapshot path):

- `ai-run.repository.ts` `authorizedChatSnapshot` SQL now selects
  `kind`, `snapshot_hash`, `expires_at`, `decided_at`, `tool_name`,
  `args`→`input`, `result`→`output`; timestamps go through
  `to_char(… AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` because
  `z.iso.datetime()` rejects Postgres' `+00:00` offset rendering.
- `stream-hub.ts` `enqueueSnapshot` filters `parts` to text/reasoning for
  the `snapshot-part` frame stream (frames cannot carry tool parts;
  `partCount`/indices stay consistent). Tool parts, when emitted, travel
  via `operations` — flagged for the stream-publisher task.
- `chat.service.ts`: `list()` emits `awaitingUser: false` and `get()`
  emits `operations: []` — type-level stubs only; real population is the
  F5 stream-publisher task (flagged).

Fixture updates: 13 frontend specs (`operations: []` on assistant
literals, `awaitingUser: false` on ChatPage items), backend e2e fixtures
(`chat-state-fixtures.ts`, `chat-history.spec.ts`,
`brand-visual-shell.spec.ts`), `stream-hub.spec.ts` and
`chat-sse-replay.spec.ts` op literals widened to the full summary.

### Test evidence

RED (before implementation):
`pnpm vitest run --project contracts` → exit 1, 10 failed / 20 passed —
3 in `ai-run.spec.ts` (OperationKindSchema undefined, pause-event
`kind`/`operation` rejected, expiry job envelope rejected), 7 in
`chat.spec.ts` (tree `operations`, `awaitingUser`, widened op summary,
tool part, decision schemas).

GREEN:

```
contracts:          102/102 pass (12 files)
backend-unit:       815/815 pass (104 files)
frontend:           896/896 pass (92 files)
backend-integration: 21/21 pass (chat-sse-replay — live services)
pnpm typecheck → 0 errors across shared/backend/frontend
pnpm exec eslint <changed files> → clean
pnpm format:check → clean (after prettier --write on 2 files)
```

### Deviations / calls within spec latitude

- `operation.kind` is pinned to the event type via
  `ChatOperationSnapshotSchema.extend({kind: z.literal(...)})` rather
  than a `.refine` — the mismatch is rejected by the discriminator shape
  itself (verified in Zod 4.6.7: extend preserves strict catchall).
- `decision`/`decidedAt` on the decision RESULT are required-nullable
  (always present on the wire; `null` for undecided ops) so the
  idempotent response shape is fixed.
- `options.indexes`/`option.index` bounded to 0–4 (spec §10: 2–5 options
  per question) and `answers` capped at 5 — server re-validates against
  the stored args regardless.
- `input`/`output` are emitted unconditionally by `authorizedChatSnapshot`
  (snapshot is the owner-authorized channel; events may still drop them
  under the byte cap). `display` is schema-only until a publisher stamps
  it.
- `awaitingUser`/`operations` emit constant `false`/`[]` — flagged; the
  stream-publisher task wires the EXISTS query and per-run ops.
