# F3 acceptance evidence

Date: 2026-11-06
Current scope: Tasks1–7 accepted — contracts, tenant storage/admission, attempt accounting, authorization, guarded model adapter, deterministic transport, and atomic run/step coordination. Tasks8–17 remain pending; generation execution is not composed yet. Provider tests use mocked responses; no live model call has been made.

## Task 3 owner capacity privilege correction (2026-11-05)

- Owner correction applied before accounting work: new append-only migration `0016_ai_capacity_privileges.sql` revokes runtime `UPDATE` and `DELETE` on `ops.ai_engine_capacity`; `0015` is unchanged. Runtime insert-or-compare keeps only `SELECT`/`INSERT`. The compare query is plain `SELECT` because PostgreSQL 17 row-locking clauses also require `UPDATE`; its existing advisory transaction lock remains.
- Research: [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html) says row-locking clauses require `UPDATE`; [PostgreSQL 17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html) supports the privilege correction. Docs read 2026-11-05 against pinned PostgreSQL 17.11.
- RED: `pnpm exec vitest run --project backend-integration ai-capacity.spec` failed because `lexon_app` could update the singleton (`UPDATE` SQLSTATE was successful/null); DELETE was denied. GREEN after migration/repository change: same command passed **8/8 tests**, including direct UPDATE/DELETE denial and independent repositories accepting an identical fingerprint while rejecting a changed fingerprint specifically as `AI capacity configuration mismatch`.
- Reviewed fixed capacity inputs remain `slot_bytes=6291456` and per-organization maximum `6`. Raising either CHECK/config ceiling requires a reviewed migration and operator step.

## Task 3 attempt accounting implementation evidence (2026-11-05)

- Research reread 2026-11-05: [AI SDK 7 generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text) and installed `ai@7.0.159` declarations/changelog; [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and installed `@openrouter/ai-sdk-provider@3.1.0` README/declarations; [PostgreSQL 17 numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html) and explicit-locking docs; Drizzle migration docs and installed `drizzle-orm@0.45.4` migrator. Detailed decisions and exact-version evidence are in the approved design's Research notes.
- Usage now owns durable reserve/settle projection with no Chat lifecycle mutation. Admission locks and revalidates the claimed run/step before reading PostgreSQL budget state; reserves estimated input plus enforced output as one amount, counts every attempt, and fails future reserves after any persisted overrun even if remaining is positive. Unknown retains both reserve components; partial usage replaces only reported components; null cost remains distinct from known zero.
- Task 3 initially retained `numeric(20,10)` and deferred provider cost precision. Task 5 resolves this with append-only migration `0018`: `cost_usd` becomes unconstrained exact `numeric` with a finite/nonnegative check; the repository accepts canonical decimal strings up to 512 characters. Provider 3.1.0 exposes cost as a JavaScript number, so the adapter expands its shortest `number.toString()` exponent form using string operations only, with no currency arithmetic or rounding. The exact provider-provided decimal representation is covered through PostgreSQL settlement/reload; original JSON precision cannot be recovered after provider parsing to JavaScript number.
- Estimator version 1 canonicalizes sorted JSON for all model-visible messages and schemas, measures UTF-8 bytes, and adds 64/message, 256/tool, and 1024 framing tokens. Non-finite/cyclic/non-JSON inputs and unsafe arithmetic are rejected. No tokenizer dependency was added.
- Initial RED `pnpm exec vitest run --project backend-unit --project backend-integration token-estimator.spec attempt-budget.spec ai-attempts.spec` observed the new-symbol import failures. The first integration harness attempt then failed at `AI capacity unavailable` because the test-only database clone had not configured the singleton; no behavior conclusion was drawn from that setup failure. After composing the fixture through the existing Testcontainers AI fixture, an integration RED exposed zero output tokens being rejected in usage ledger arithmetic; the implementation was corrected to allow zero actual output. A cost expectation was also corrected to PostgreSQL's stored scale (`0.0000000000`) for the known-zero case.
- Step 0 RED/GREEN: `pnpm exec vitest run --project backend-integration ai-capacity.spec` first failed because runtime UPDATE succeeded; after migration 0016 and plain-SELECT comparison it passed **8/8 tests**.
- Accounting focused GREEN: `pnpm exec vitest run --project backend-unit --project backend-integration token-estimator.spec attempt-budget.spec ai-attempts.spec` passed **24/24 tests, 3 files**. The integration cases use real Testcontainers PostgreSQL and cover restart reconstruction, unknown/failed/partial usage, aggregate overrun persistence and admission block, concurrent overspend, attempt limit 2, cost null/zero/scale rejection, metadata state, duplicate settlement, rollback and expired sessions.
- Final gates: `pnpm build`, `pnpm typecheck`, `pnpm lint` (**85/85 boundary checks**), `pnpm format:check`, and `git diff --check` all passed. One final `pnpm test` passed **561 tests / 116 files**, exit 0, in 58.75s. The three baseline jsdom `Not implemented: navigation to another Document` warnings appeared; no additional warnings or failing tests were observed.

### Task 3 review round 1 corrections (2026-11-05)

- RED: `pnpm exec vitest run --project backend-unit --project backend-integration token-estimator.spec attempt-budget.spec ai-attempts.spec` failed **3 tests / 26, passed 23**, exit 1. The estimator undercounted parsed own `__proto__` tool-result/schema data (**1,426 estimated vs 21,498 expected**); unit and real integration regressions showed unknown reported overruns returned `budgetExceeded=false`.
- Correction: canonical JSON objects now have a null prototype so own `__proto__` keys remain enumerable data. Unknown attempts still consume both full reservation components for remaining-budget accounting, while available reported usage is independently compared against the total reservation; a reported overrun sets the durable stop regardless of outcome.
- GREEN: the same command passed **26/26 tests, 3 files**, exit 0. The Testcontainers regression settles an unknown attempt above reservation, verifies positive remaining reserve survives construction of a new service, and verifies the next reservation fails with `AI_BUDGET_EXCEEDED`.
- Changed-code gates after the corrections: `pnpm build`, `pnpm typecheck`, `pnpm lint` (**85/85 boundary checks**), `pnpm format:check`, and `git diff --check` all passed, exit 0. The full suite was not rerun for these two scoped fixes; the prior 561/561 baseline remains recorded above.

## Task 3 acceptance after review (2026-11-05)

- Implementation `38297e881e9c88e4c8a1711c5414937c41f5167d`; review corrections `2050dd6c80f419c2cc445810c1003fe987aec015`. Main-session spec and code-quality review accepted the task after both Important findings were fixed and scoped re-review confirmed no new blocking issues.
- Main-session final verification: `pnpm exec vitest run --project backend-unit --project backend-integration token-estimator.spec attempt-budget.spec ai-attempts.spec ai-capacity.spec` passed **34 tests / 4 files**, exit 0, 14.21s. This includes the privilege, fingerprint, estimator, restart and overrun regressions. Full-suite evidence above predates the scoped fixes; covering tests and workspace gates passed after them.
- Remaining integration gates: Task 9 must atomically finalize a failed run with truthful usage and partial output when settlement reports overrun. Task 3 supplies accounting only. The three existing jsdom warnings remain recorded for final review.

## Estimator calibration follow-up (owner, 2026-11-05)

The current estimator reserves one token per UTF-8 byte plus overhead. The owner notes this is roughly 3–4 times typical real usage; this is an expectation, not a measured result, and remains within the approved conservative-admission rule. Task 15 must record the measured estimated/reported input-token ratio. Calibrate the estimator before F8 sends large document context. No estimator behavior changes in Task 4.

## Research checked

- [AI SDK 7 UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), read 2026-11-05; installed `ai@7.0.159` verified from backend package metadata and the approved design notes. Selected the versioned text/tool/step parts and retained Lexon's status, reset, approval-required, finish, and safe error envelope events. Provider SDK types remain outside `shared/`.
- [Zod 4 API](https://zod.dev/api), installed `zod@4.6.7` verified from package manifests; official `llms.txt` fetched and read 2026-11-05. Used strict objects and discriminated unions for versioned jobs/events.
- [Node.js 24 documentation](https://nodejs.org/docs/latest-v24.x/api/), runtime `24.22.1` verified. No Node crypto API is used by Task 1.
- Architecture source: LEX-ARC-001 §4.7 and approved F3 design Research notes. No dependency or package version changed.

## Initial implementation evidence (before review)

- RED: `pnpm exec vitest run --project contracts --project backend-unit ai-run.spec run-state.spec run-registry.spec` initially failed all three suites at imports for the not-yet-created contract, state, and registry modules; no tests ran. This was the expected missing-symbol RED.
- GREEN: the same focused command passed **3 files / 10 tests** after implementation.
- `pnpm --filter @lexon/contracts build` passed.
- `pnpm --filter @lexon/backend typecheck` passed.
- `pnpm --filter @lexon/contracts lint` and `pnpm --filter @lexon/backend lint` passed, including repository boundary checks (85 checks each).
- Initial pre-review `pnpm test` exited **0**: **110 files / 511 tests passed**, 56.56 seconds.
- `git diff --check` passed.

## Failures and warnings observed during iteration

- Intermediate GREEN attempts exposed implementation/type issues: callback narrowing in write-mode validation, the default per-step attempt limit not applied when omitted, widened fixture literals in tests, and lint rejecting deep imports across Identity/DB boundaries. Each was corrected; the final focused, package, and full-suite gates above passed.
- The final full suite printed the known three jsdom `Not implemented: navigation to another Document` warnings. This matches the supplied baseline note; no unrelated frontend warning was changed or attributed to Task 1.
- An initial full-suite invocation's wrapper discarded its session id before the summary was available. It was repeated with session capture (exit 0, 510 tests at that point) and once more after the final compatibility test was added (exit 0, 511 tests). No test code changed between the first two invocations.

## Scope review

- Shared contains only Zod contracts and no Node or provider SDK import. No dependency was added.
- Identity defines and re-exports opaque `RunActor`; DB defines and re-exports `StepClaim`; Chat consumes only public Identity/DB barrels. AI model contracts are neutral and provider-free.
- Production registration is empty. There is no run execution, provider adapter, transactional effect, route, UI, or feature profile implementation in this task.

Implementation commit: `760c02881c516658f3cf8e7f8467a0b99979f755`. Review-fix commit: `2ce57a9974e973c1f4abd27716267651eb376e1c`. The public evidence below records task acceptance without depending on ignored workspace files.

## Review round 1 fixes (2026-11-05)

- Added a strict versioned `operation-status` event with stable UUID `operationId` and finite `OperationStatusSchema` values: `pending`, `awaiting_approval`, `approved`, `rejected`, `completed`, `failed`, and `outcome_unknown`. Positive and negative parsing cases cover every status, missing identity, unknown status, and raw error rejection.
- Kept the omitted attempt limit default at 2 while allowing server-owned profiles to set higher positive safe-integer limits. Tests accept 3 and reject 0 and non-integer values.
- Review RED: focused tests failed on the absent operation status schema and explicit attempt limit 3 being rejected. Review GREEN: focused 3-file suite passed 13/13.
- `pnpm exec prettier --write` and `pnpm exec prettier --check` passed for all seven files listed in review finding I3.
- Contracts build, backend typecheck/lint, contracts lint, and `git diff --check` passed.
- Final full suite after these changes: `pnpm test` exit 0; 110 files / 514 tests passed in 55.24s. The same three baseline jsdom navigation warnings appeared.

## Task 1 acceptance and main-session review (2026-11-05)

**Accepted:** portable contracts, all49 state transition pairs, registry
validation, opaque actor/claim and neutral model type foundations. At this Task1 acceptance point, Tasks2–17
had not started. No run execution, HTTP/UI, model request or database migration
ships in this task. Owner's org6 admission and opt-in first-install telemetry
amendments are recorded in the approved plan for Tasks2 and13.

- Implementer: gpt-6-luna/high, confirmed in actual session turn metadata.
- Independent task review: gpt-6.1-sol/high; spec compliance reviewed before code
  quality. Initial review found3Important issues (missing operation-status,
  default2misread as ceiling, formatting). All3were addressed in one fix round.
- Scoped re-review accepted each fix; no new Critical/Important issue. Main
  session checked the findings against source/design and accepted this scope.
- Main-session verification on final source2ce57a9: focused contracts/backend
  command passed13tests/3files, exit0,3.83s; Prettier check on ALL changed files
  passed; diff whitespace check passed. Implementer final full suite on that
  source passed514tests/110files, exit0,55.24s, with package build/typecheck/lint
  results listed above. No production source changed after those checks.
- The3jsdom navigation warnings predate Task1 (main baseline326tests/66files)
  and remain recorded as existing test-output noise.

Deferred Minor review observations are visible handoffs, not silently discarded:

| Observation                                                                                   | Owning later work                                                    |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Context registration could reject a missing/non-callable collect callback earlier             | Task4 context composition and final branch review                    |
| DecimalUsdString template type permits more numeric spellings than a validated decimal format | Tasks3/5 accounting/provider cost validation and final branch review |

Execution-time context budgets, operation recovery, usage settlement and SDK
translation remain the explicit deliverables of Tasks3–5 and9–12; the reviewer
did not claim them proven by foundational types. At Task5, ensure terminal model
outcomes are observable through the neutral gateway before Task9 consumes it;
the standalone ModelOutcome type alone does not prove adapter delivery.

## Task 1 owner contract corrections (2026-11-05)

- RED: `pnpm exec vitest run --project contracts ai-run.spec` failed four
  behavioral checks (run jobs missing tenant context; Lexon UUID event IDs;
  opaque SDK IDs were trimmed; positive run-job fixture omitted required ctx).
  The failures exercised absent behavior; no import/setup failure.
- GREEN: the same command passed **8 tests / 1 file** after correction.
- Run start/advance/resume now require strict `{orgId,userId}` UUID context and
  UUID run IDs. The legacy platform no-op keeps optional userId. Stream run IDs,
  Lexon message IDs, and both operation ID event fields use UUID validation.
  SDK text/tool/approval IDs are nonempty, max-256-code-unit opaque strings and
  are preserved without trimming. Task 2 repositories consume this schema only
  after the GREEN above.

## Task 2 research and implementation evidence (2026-11-05)

- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html),
  [RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), and
  [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
  were read 2026-11-05 for pinned PostgreSQL 17.11. Row locks serialize the
  singleton admission path; RLS is default-deny without a tenant policy and
  `FORCE ROW LEVEL SECURITY` applies to the owner. Trigger helpers use a fixed
  search path and never discover an org from a run ID.
- [Drizzle migration guidance](https://orm.drizzle.team/docs/migrations) was
  read 2026-11-05; installed `drizzle-orm@0.45.4` migrator source was inspected.
  It reads the ordered `_journal.json`, hashes SQL files, and splits statements
  on `--> statement-breakpoint`. Installed `drizzle-kit@0.31.11` and existing
  `0014_admin_setup.sql` were checked. Task 2 uses one append-only `0015` SQL
  migration and an appended journal record.
- Capacity inputs follow the approved sizing addendum and
  [F3-stream-memory.json](F3-stream-memory.json): `maxLen=1024`,
  `eventBytes=4096`, `slotBytes=6291456`, default memory budget 30 slots,
  terminal slots 6, and active slots derived as `floor(budget/slotBytes)-6=24`.
  The 4096-byte probe observed 5,269,728 bytes for 1024 stream entries using
  the pinned Valkey 9.0.7 image on aarch64.
- The first migration validation found the checkpoint→attempt composite FK
  needed a matching unique `(org_id,id)` key; this was added before re-running.
  Integration assertions use `withTenant` under `lexon_app`, and the test
  fixture seeds identities only with the migrator; runtime behavior is never
  exercised through a migrator connection.

- Task 2 focused final verification: `pnpm exec vitest run --project backend-integration --project backend-unit ai-storage.spec ai-capacity.spec ai-config.spec` passed **14/14 tests, 3 files**, exit 0. Tenant/auth regression verification `pnpm exec vitest run --project backend-integration ai-storage.spec ai-capacity.spec tenant-isolation.spec auth-privileges.spec` passed **17/17 tests, 4 files**, exit 0.
- Final gates on Task 2 source: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `git diff --check` passed, exit 0.
- Initial pre-review full `pnpm test` passed **531 tests / 113 files**, exit 0, 57.13s. Three existing jsdom `Not implemented: navigation to another Document` warnings appeared; no test failed. Implementation source: `c0c201dd5b9809f0f05097308aad6ded2f409c71`; review-fix source and final evidence are below.

## Task 2 review fixes I1/I2 and R6 (2026-11-05)

- I1 RED: `pnpm exec vitest run --project backend-integration ai-storage.spec -t 'in-flight attempt insert'` failed because takeover did not block behind the uncommitted attempt write (`writerRetainedRunLock=false`). `pnpm exec vitest run --project backend-integration ai-storage.spec -t 'in-flight checkpoint|run transition waits|retry attempt replaces'` failed all three corresponding lock/retry assertions on the old implementation.
- I1 GREEN: repository claim-dependent writes now lock and revalidate the run first, then the step, retaining both row locks through the caller-provided `TenantSession` transaction. Takeover also uses run-then-step ordering. The deterministic fixture holds the write transaction open, lets the lease expire by observing PostgreSQL's clock, starts takeover/terminal transition on another connection, and observes that specific backend's ungranted lock in `pg_locks` before releasing the writer. No production failpoint or timing-only outcome assertion is used. After serialization the takeover fences the old owner and marks its inserted active attempt `unknown`; checkpoint and commit races serialize against takeover and terminal/version transition.
- I2 RED: the retry checkpoint test failed on the old implementation because attempt 2 under the same claim/fence could not replace attempt 1's checkpoint.
- I2 GREEN: checkpoint upsert now replaces a checkpoint only when the prior checkpoint attempt is already inactive; the incoming attempt must still be active and match the current claim/fence. No migration change was needed. The two-attempt/same-claim test passes.
- Root R6 evidence: `losingStartCounts().slots` and `orgSlotCount()` inspect `ops.ai_run_slots` through the private test fixture's migrator connection. Runtime privileges remain unchanged; refusal, rollback, per-org count, and terminal release assertions now read actual slot rows. Content-bearing job negatives share a valid base with UUID `ctx`, assert that base is valid, and vary only the required version or forbidden field.
- Final focused storage/capacity/config: `pnpm exec vitest run --project backend-integration --project backend-unit ai-storage.spec ai-capacity.spec ai-config.spec` passed **18/18 tests / 3 files**. Contracts: `pnpm exec vitest run --project contracts ai-run.spec` passed **8/8**. Tenant/auth regression: `pnpm exec vitest run --project backend-integration ai-storage.spec ai-capacity.spec tenant-isolation.spec auth-privileges.spec` passed **21/21 tests / 4 files**.
- Final gates: `pnpm build`, `pnpm typecheck`, `pnpm lint` (85/85 boundary checks), `pnpm format:check`, and `git diff --check` passed. The final `pnpm test` passed **535 tests / 113 files**, exit 0, 56.73s; the three baseline jsdom navigation warnings remain.
- Cannot verify in Task 2 and retained as later-task handoffs: production worker bootstrap invoking `AiCapacityRepository.configure`, worker-boundary job context mismatch behavior, lifecycle atomic effects/outbox/receipt composition, and accounting policy. These are not claimed as delivered by this fix.

## Task 2 acceptance and main-session review (2026-11-05)

Accepted source: `164756720e5a501b7a3553b452f56d7ea48ec53a`.
Implementer gpt-6-luna/high and independent reviewer gpt-6-astra/high were
confirmed through actual session metadata. Spec compliance preceded quality
review. The reviewer confirmed two Important persistence defects with isolated
PostgreSQL17.11 probes; both were fixed in one round. Scoped re-review accepted
I1/I2 and both R6 test corrections, with no new Critical/Important issue.

Main-session checks on the final source:

- `pnpm exec vitest run --project contracts --project backend-unit --project backend-integration ai-run.spec ai-storage.spec ai-capacity.spec ai-config.spec`: **26/26 tests,4files,exit0,14.79s**.
- Prettier on all changed supported files passed (`--ignore-unknown`, because
  this repository has no SQL Prettier parser); whitespace check passed.
- Implementer full suite **535/113,exit0,56.73s**, workspace build/typecheck/
  lint/format and isolated regression results are recorded above. No production
  source changed after these checks; final closeout edits are documentation only.
- Tracked `.superpowers` scratch report was removed from the index while kept
  locally. No ignored workspace artifact remains tracked. No migration was
  modified by the review fix. Main branch remains untouched.

Minor coverage limitation retained for Task12 and the final branch review:
the repository barriers pause after the insertion/checkpoint method completes.
They demonstrate retained transaction blocking, but do not directly gate the
original SELECT-before-INSERT window, and observed locks may also include
FK KEY SHARE locks. The independent reviewer verified that the production
run→step FOR UPDATE guard closes that window; the exact-window regression
probe is a later test-strengthening handoff, not an unresolved production defect.

Integration still due in later tasks: actual production capacity configuration
at bootstrap (explicit Task7 handoff); worker forged-context flow7 (Task7);
receipt/outbox lifecycle composition (Tasks6–9); accounting policy (Task3).
Do not infer those features from storage acceptance. The three existing jsdom
warning messages remain a baseline follow-up for final review.

## Task 4 implementation evidence (2026-11-05)

Task 4 is accepted after main-session review and the scoped lock-order fix. Migration `0017` stores nullable initiating session and
MFA verification provenance without coupling run retention to auth session
lifetime. Worker authorization combines that immutable provenance with current
locked user, organization, and membership facts. The facts function accepts
caller-supplied tenant identity, has a fixed search path, and contains no run
lookup or policy logic. Identity owns active-scope actor minting and capability
policy. Resource grants remain empty pending their owning product slices.

- Focused RED was recorded before implementation; final focused verification
  `pnpm exec vitest run --project backend-unit --project backend-integration run-capability.spec untrusted-context.spec canonical-operation.spec run-authorization.spec`
  passed **14/14 tests, 4 files**.
- Final workspace gates `pnpm build`, `pnpm typecheck`, `pnpm lint` (85/85
  boundary checks), `pnpm format:check`, and `git diff --check` passed.
- One final `pnpm test` run passed **577 tests / 120 files**, exit 0, 60.03s.
  The three existing jsdom navigation warnings appeared; no tests failed.
- Concurrency regression coverage confirms current membership removal serializes
  with worker effects through the F1 parent-org locks. No model I/O is performed
  inside the authorization transaction.

### Task 4 review fix round 1 (2026-11-05)

- RED: a controlled two-connection PostgreSQL interleaving held the F1
  selection user lock, started authorization until it waited for that user,
  then advanced selection to its parent lock. The original exclusive parent
  lock produced SQLSTATE `40P01` (deadlock detected).
- GREEN: migration `0017` now reads/locks the organization `FOR SHARE`,
  compatible with F1 selection's parent `FOR SHARE` and still conflicting with
  F1 membership/policy writers' exclusive parent lock. User and membership
  locks remain `FOR UPDATE`; lock order remains organization → user → member.
  The same-actor removal regression uses the actual
  `lexon_lock_organization` pre-lock protocol before deleting that actor's
  membership and confirms deletion waits until the authorized effect commits.
- `pnpm exec vitest run --project backend-unit --project backend-integration run-capability.spec untrusted-context.spec canonical-operation.spec run-authorization.spec organization-switch.spec membership-actions.spec run-authorization-module.spec`
  passed **27/27 tests, 7 files**. The standalone `RunAuthorizationModule`
  boot trace observed no Better Auth/SMTP imports and no TCP calls.
- `node --test scripts/test/boundaries.spec.mjs` passed **79/79 fixtures**;
  the added fixture rejects infrastructure importing run capability policy.
  `pnpm build`, `pnpm typecheck`, `pnpm lint` (86/86 boundary tests),
  `pnpm format:check`, and `git diff --check` passed.

### Task 4 acceptance after review (2026-11-05)

- Implementation `7addde85bcdd6ec24b3958ec5a2ac0c57b1a510c`; review fix `c4804015a8e0373b8924cf704c70ab7dcefb0418`. Spec compliance and code quality approved after fixing the selection deadlock and adding direct worker-safe module/boundary proofs. Migration numbers remain unchanged; accepted 0015/0016 were not edited.
- Main-session final verification used the seven-file focused command above: **27 tests / 7 files passed**, exit 0, 18.09s. The full 577/120 result predates the scoped fix; covering tests and workspace gates passed after it. Runtime-event logs appeared in the focused integration output; the three known jsdom warnings remain a full-suite qualification.
- Minor follow-up for Task 17/final review: the module trace detects ordinary `better-auth` imports but its scoped `@better-auth` regex arm has an extra slash. Correct the detector and add a direct scoped-package assertion. No forbidden runtime dependency was observed; this is a regression-detector limitation.
- Task 7 still must persist session/MFA provenance from the live verified actor and reconstruct worker context from persisted initiator IDs. Approval snapshot matching, once-only decisions, access-loss finalization, and transaction boundaries around model calls remain later lifecycle gates. Task 9 owns context-collector runtime validation, including the earlier registration callback validation follow-up. Resource-specific capability policies belong to their owning slices; roles add no grants in F3.

## Task 4 owner lock clarification / Task 5 follow-up (2026-11-05)

The user/member FOR UPDATE locks were conservative defaults, not a deliberate F1 lock-order requirement. F1's membership mutation protocol uses the exclusive organization parent fence. Following the owner's preference, Task 5 first adds migration0018 for shared user/member reads, retaining the organization's shared lock and accepted migration0017 unchanged. Shared reads still conflict with relevant updates/removal while allowing simultaneous authorization of the same user. A real PostgreSQL concurrent-run regression must prove this before the adapter work is accepted. Authorization transactions stay short and end before model or Valkey I/O; the later engine integration must preserve this boundary.

## Task 5 implementation evidence (2026-11-05)

- Initial implementation commit: `8c811b2e317771b0eed0ad189f9d1109b01e16ec` (`feat(f3): implement guarded single-generation model adapter`).
- Migration `0018_ai_authorization_shared_reads.sql` changes only the AI actor-facts function's user/member lock modes to `FOR SHARE`; organization remains `FOR SHARE`. Migrations `0015`–`0017` were not edited. Real PostgreSQL regression holds one same-user authorization transaction while the second completes, while F1 selection and same-actor removal tests remain green. Each authorization transaction ends before any model or Valkey work.
- The dev allowlist is exactly `{id:"openai/gpt-6-luna",provider:"azure/us",region:"us",zeroDataRetention:true,reviewedAt:"2026-11-05T00:00:00.000Z"}`. `provider` is the OpenRouter route slug, not the SDK gateway. Every request sets `only` and `order` to `['azure/us']`, fallback disabled, ZDR enabled, and data collection denied. Actual provider metadata is preserved separately; no physical datacenter claim is inferred. Allowlist review date is not the real-account ZDR attestation date.
- One `streamText` call uses `maxRetries:0`, `streamRetries:0`, no executable tools, `maxOutputTokens`, explicit disabled telemetry recording, and a no-op SDK `onError`. The no-op is required because installed AI SDK 7.0.159 defaults provider errors to `console.error`, which the initial canary captured with both a private provider body and key. Safe outcomes contain no raw SDK/provider error. Caller abort and consumer cleanup abort the transport; interruption without authoritative provider completion stays `unknown`. Definitive HTTP failures map to safe codes and `failed`.
- Neutral model messages explicitly represent assistant tool calls and tool-result JSON, validate bounded opaque IDs/names and call/result name pairing, and map results to AI SDK v7 `{type:"json",value}` output. A scripted gateway in `ai/testing/` emits only neutral JSON events. No run engine lifecycle or SDK tool execution was added.
- Provider usage preserves optional cached/reasoning token details, null versus explicit zero cost, and exact decimal cost. Mocked OpenRouter SSE streams through the actual provider parser, persists generation ID in a short tenant transaction while provider continuation is gated, then routes the >10-scale cost through `AttemptService.settle` and reloads the exact PostgreSQL decimal.

### Task 5 TDD and verification

- RED: same-user authorization returned `secondFinishedWhileFirstStepHeld:false`; cost `0.00000000001` was rejected by the old scale boundary; new adapter tests initially failed on missing exports and then caught the routing mismatch (`only:['us']`, no `order`) and raw SDK error logging. Each failure was fixed with new migration or targeted adapter/repository changes. Accepted migrations `0015`–`0017` were preserved.
- Focused adapter command `pnpm exec vitest run --project backend-unit model-gateway.spec provider-stream.spec real-model-prerequisites.spec ai-compatibility.spec`: **21 tests / 4 files passed**.
- Real PostgreSQL command `pnpm exec vitest run --project backend-integration run-authorization.spec ai-attempts.spec`: **23 tests / 2 files passed**. Covers authorization overlap, F1 selection/removal regressions, early metadata persistence, and exact normalized cost settlement/reload.
- Final workspace gates: `pnpm build`, `pnpm typecheck`, `pnpm lint` (**86/86 boundary checks**), and `pnpm format:check` all passed. `pnpm test` passed **600 tests / 124 files**, exit 0, 63.97s. The integration suite emitted existing runtime-event logs; three baseline jsdom warnings remain as noted above. The first full run exposed two stale fixture expectations (PostgreSQL unconstrained numeric returns canonical `0.001`; the token estimate includes 64 tokens per each of two messages). Both were corrected, their focused tests passed, and the final full run passed.

### Task 5 review fix round 1

- Fix-round commit: `b1a16df59345b3694840d6c51b0157d6fa982828` (`fix(f3): tighten model terminal and retry outcomes`).
- I1: neutral message conversion now validates exact message/part discriminators and keys before `streamText`; tool-call IDs are unique and matching results consume each outstanding ID once. Malformed discriminator and duplicate-result gateway tests prove zero injected fetch calls.
- I2: actual mocked OpenRouter parser tests cover authoritative `length` (succeeded) and `content_filter` (failed) finishes while preserving usage/cost. Both are nonretryable. Caller abort/interruption remains unknown and nonretryable.
- I3: prerequisite date tests inject a fixed `now` and cover same-day valid, missing, malformed, impossible calendar and future dates without clock dependence.
- I4: required `ModelOutcome.retryable` is true only for allowlisted transient HTTP statuses 408/429/500/502/503/504 or recognized SDK/network transport failures. Permanent 400/401/403/422/501 and unclassified errors are false. Gateway tests prove 503 carries true, 422 carries false; no retry/backoff was added.
- Fix-round RED command `pnpm exec vitest run --project backend-unit model-gateway.spec provider-stream.spec real-model-prerequisites.spec ai-compatibility.spec`: **16 failed / 21 passed**, exit 1, confirming all four defects. GREEN same command: **38 passed / 4 files**, exit 0. `pnpm --filter @lexon/backend typecheck` passed.
- Changed-code workspace gates: `pnpm build`, `pnpm typecheck`, and `pnpm lint` passed; lint reported 86/86 boundary checks. `pnpm format:check` initially found seven changed AI files; after Prettier, it passed. `git diff --check` passed. Full suite was not repeated for this scoped review fix; the recorded 600/124 full-suite result predates it.

### Task 5 review fix round 2

- RED command `pnpm exec vitest run --project backend-unit model-gateway.spec provider-stream.spec`: **3 failed / 29 passed**, exit 1. A copied `{name:"AI_APICallError",isRetryable:true}` record was trusted; actual injected fetch with TLS `CERT_HAS_EXPIRED` was wrapped by OpenRouter's pinned `handleFetchError` into a branded retryable APICallError.
- Retry classification now authenticates SDK errors with installed `APICallError.isInstance` and `StreamProviderError.isInstance`; raw causes must be genuine `Error` chains with a documented retryable transport code. Unknown cause chains and known TLS certificate codes remain nonretryable even when the SDK wrapper flag is true. No error message or raw cause is emitted.
- GREEN focused command `pnpm exec vitest run --project backend-unit model-gateway.spec provider-stream.spec real-model-prerequisites.spec ai-compatibility.spec`: **40 tests / 4 files passed**, exit 0. Includes copied-name rejection, genuine SDK-instance positive, raw unknown/certificate causes, and actual injected-fetch certificate failure through the SDK.
- `pnpm build`, `pnpm typecheck`, `pnpm lint` (**86/86**), and `pnpm format:check` all passed. The full suite was not rerun, per the scoped fix instruction.

### Task 5 acceptance after review (2026-11-05)

- Reviewed implementation `8c811b2e317771b0eed0ad189f9d1109b01e16ec`, first fix `b1a16df59345b3694840d6c51b0157d6fa982828`, and final fix `e52583582033fa78c20d2df0e8a746dee8ac9be9`. Spec compliance and code quality approved after two scoped re-reviews; all four Important findings are addressed with no remaining blocking issue.
- Main-session final command `pnpm exec vitest run --project backend-unit --project backend-integration model-gateway.spec provider-stream.spec real-model-prerequisites.spec ai-compatibility.spec run-authorization.spec ai-attempts.spec ai-storage.spec token-estimator.spec` passed **76 tests / 8 files**, exit 0, 19.04s. The recorded full suite **600/124** predates the scoped review fixes; covering tests and workspace build/typecheck/lint/format checks passed after them. Existing runtime-event logs and baseline jsdom warnings remain qualified above.
- The owner-requested lock clarification is resolved by append-only migration0018 and the real PostgreSQL same-user authorization overlap test. All three facts reads use FOR SHARE. Authorization transactions must end before model or Valkey I/O; Tasks7–12 must preserve this boundary in the actual engine. Applied migrations0015–0017 remain unchanged; future operation/audit migrations are0019/0020.
- Task3's cost-precision handoff is resolved with exact unscaled numeric persistence and provider-parser-to-settlement reload evidence. The SDK's upstream JavaScript-number parsing limitation remains explicit. No real key, account verification, physical-region evidence, or live model execution is claimed by these mocks; Tasks15–16 retain those operator-gated checks.
- Task9 must honor explicit `retryable === true`, preserve known length/filter usage, retain unknown reservations, and atomically finalize run/partial output. Tool-history validation and metadata backpressure are provided here; durable orchestration and tool effects remain later tasks.
- Review manifest reconciliation: the existing provider constructor already supplies key/fetch injection. New gateway options/prerequisite validation own the new boundary; capacity configuration stays in ai-config.ts. No dummy source edits were added. Minor final-review follow-ups remain the provider constructor's stale F0 comment, existing test-output noise, and Task4's scoped-import detector assertion.

## Owner real-model verification deferral (2026-11-06)

The owner instructed continuous F3 implementation and will configure OpenRouter afterward for the final check/review with real models. Tasks15–16 will implement and test the guarded commands/workflow using injected responses and refusal tests. Actual ai:smoke, measured estimated/reported input ratio, paid eval results, account verification date, and actual route/provider evidence remain pending owner setup. No real execution or prerequisite skip is a passing result. Final branch/PR evidence must show this distinction explicitly; the scheduling-hop gate remains required during implementation.

## Task 6 implementation evidence (2026-11-06)

- Added deterministic RFC 9562 UUIDv5 step job IDs and strict versioned `run.start`, `run.advance`, and `run.resume` envelopes. Outbox append is deterministic and idempotent only when immutable payload, tenant context, queue, and priority match; claimed routing is preserved through dispatcher into the real interactive or batch BullMQ queue. Existing outbox UUID remains the BullMQ `jobId`.
- Added infrastructure-owned durable handler contracts and a typed platform registry while retaining the F0 `TenantJobHandler` composition path. Durable handlers bypass the F0 receipt/effect transaction and do not create an early receipt. Busy handlers use BullMQ delayed state without consuming failure attempts; queue retry/backoff and retention defaults are unchanged. Runtime currently registers only the F0 noop handler; run handlers are a Task 7 handoff.
- Durable deliveries acquire one of two per-organization Valkey permits with random owner tokens, bounded TTL, periodic renewal, cancellation on lost ownership, and token-checked release. The database remains authoritative: AI step claims serialize through a per-organization advisory transaction guard before run→step locks and enforce at most two live leases. The neutral guard is exposed for Task 7 coordination.
- Research reread 2026-11-06 against pinned versions is recorded in the approved design's Research notes: BullMQ 6.5.3, `@nestjs/bullmq` 12.0.0 / Nest 12.3.2, ioredis 6.0.0 / Valkey 9.0.7, PostgreSQL 17.11, and Node 24.22.1. Official BullMQ delayed-job docs support `moveToDelayed(timestamp, token)` with `DelayedError`; official Valkey docs support `SET NX PX`, owner-checked `SET ... IFEQ ... PX`, and `DELIFEQ`; PostgreSQL 17 advisory locks and transaction-scoped locks support the database claim guard. No dependencies or versions changed.
- RED/GREEN: UUID tests first failed on missing symbol, then passed 6/6. Envelope tests first failed on missing run schemas, then UUID+envelope passed 9/9. Real Testcontainers queue-routing integration first exposed nondeterministic append IDs, then single-queue routing and duplicate-conflict handling; after implementation it passed routing through both real BullMQ queues. Real queue consumer integration exposed missing durable-handler delay behavior, then passed with `attemptsMade=0` through repeated busy delay. Permit integration first failed on missing manager, then passed owner fencing, expiry, renewal, cleanup, organization isolation, cross-queue two-slot fairness, and lost ownership cancellation. PostgreSQL cap regression first observed three simultaneous same-org claims; after the advisory guard it observed exactly two, denied a concurrent third while renewals were serialized, and admitted another organization.
- Focused GREEN: `pnpm exec vitest run --project backend-unit --project backend-integration step-job-id.spec job-registry.spec job-envelope.spec ai-queue-routing.spec dispatcher.spec worker-crash.spec queue.spec runtime-composition.spec` passed **32 tests / 8 files**, exit 0.
- Workspace gates: `pnpm typecheck`, `pnpm lint` (**86/86 boundary checks**), `pnpm format:check`, `pnpm build`, and `git diff --check` passed, exit 0.
- One final `pnpm test` run completed with **633 tests / 127 files passed**, 61.73s. Full output is captured at `/tmp/lexon-f3-task6-pnpm-test.log`. Its tail has no failures. The shell wrapper returned 1 after the test process because zsh rejected `status` as a readonly special variable; the complete test summary in the log reports all tests passed. The suite was not repeated.
- Handoff: Task 7 must call `lockTenantClaimGuard` before any run mutation, then use the existing run→step fence protocol; durable run handlers are intentionally not registered by Task 6. No live OpenRouter/model call was made.

### Task 6 review fix round 1 (2026-11-06)

- I1 RED: after correcting the test to use two batch worker slots, `pnpm exec vitest run --project backend-integration ai-queue-routing.spec -t 'durable consumer progresses through limiter disconnect'` failed because the active handler signal was aborted during a private limiter proxy outage (`expected false, received true`). The first test attempt with one batch slot left the second job `prioritized`; that was a fixture concurrency setup failure and was corrected before using the RED result. The proxy only targets the permit connection; shared queue Valkey was not interrupted. GREEN: the same consumer's bounded ioredis reconnect recovers after `FaultProxy.restore()`, ongoing work remains un-aborted, new work is delayed while unavailable, then completes after recovery.
- I2 RED: the permit integration expected explicit renewal outcomes and observed boolean `true` instead of `renewed`; existing expired/replaced-token assertion also used boolean `false` instead of `lost`. GREEN: renewal returns `renewed`, `lost`, or `unavailable`; only confirmed `lost` aborts, and transport errors preserve the handler signal. New proxy test separately observes `unavailable` then `renewed` on recovery.
- I3 RED: the DB-backed BullMQ test observed the signal cancellation but `attemptsMade=1` instead of 0 after a handler rejected with the signal reason. GREEN: confirmed ownership-loss cancellation is converted into a typed delay before generic sanitization. The Testcontainers handler creates a real 1.8s PostgreSQL claim (longer than the configured three-attempt 250ms backoff window), releases its Valkey permit, rejects on abort, observes repeated busy delays with zero failure attempts, then claims after DB lease expiry under a higher fence and completes. It verifies no `processed_jobs` receipt exists for the durable delivery at claim time.
- I4: `insertCrossTenantStep` and `seedPendingStep` now call one shared fixture insertion helper. Existing cross-tenant FK rejection plus real claim/admission tests exercise the two fixture entry points; no SQL behavior changed.
- GREEN focused RED fixes: `pnpm exec vitest run --project backend-integration ai-queue-routing.spec -t 'confirmed permit loss|limiter disconnect|permit renewal distinguishes'` passed **3/3**. A later initial run with the wrong concurrency setup timed out the pre-existing fairness case; with that setup corrected, `pnpm exec vitest run --project backend-integration ai-queue-routing.spec` passed **8/8**. Combined affected regressions `pnpm exec vitest run --project backend-integration ai-queue-routing.spec dispatcher.spec worker-crash.spec queue.spec runtime-composition.spec ai-storage.spec ai-attempts.spec` passed **49 tests / 7 files**, exit 0.
- Corrected Task 6 report wording: durable handlers bypass the receipt/effect transaction and no receipt is written at claim. `schema.ts` was not edited because `queue_name` and `priority` columns already exist from migration0015; no dummy source change was made.

- Review-fix final gates: `pnpm typecheck`, `pnpm lint` (**86/86 boundary checks**), `pnpm format:check`, `pnpm build`, and `git diff --check` passed, exit 0. The full suite was not rerun for this scoped review round; the controller already verified the unchanged pre-fix baseline full suite at 633/633 with exit 0.

### Task 6 acceptance after review (2026-11-06)

- Implementation `ad7dd888b10f1da56419a93ce8bd20a0f3e5cc84`; review fix `12827e9ee2af0c9c2b0a1775f34307362bdcf749`. Spec compliance and quality approved after resolving all four Important findings. Existing routing schema fields were reused; the plan manifest now reflects that placement.
- Main-session final command `pnpm exec vitest run --project backend-unit --project backend-integration step-job-id.spec job-registry.spec job-envelope.spec ai-queue-routing.spec dispatcher.spec worker-crash.spec queue.spec runtime-composition.spec ai-storage.spec ai-attempts.spec` passed **60 tests / 10 files**, exit 0, 26.38s. Workspace checks passed on the fix. Root's independent direct `pnpm test` before the scoped fix passed **633 tests / 127 files**, exit 0, 62.63s; this resolves the implementer's reserved-zsh-variable wrapper caveat without representing that wrapper as successful. The full suite predates the scoped fix; current covering tests are recorded separately. Baseline warnings/runtime-event logs remain qualified.
- Task7 must acquire `lockTenantClaimGuard` before run mutations and preserve organization-advisory → run → step ordering. Durable work creates no receipt at claim; the coordinator must atomically commit effects, receipt, and continuation. Current tests intentionally do not implement that later coordinator.
- Renewal returns renewed/lost/unavailable. Only confirmed ownership loss aborts; limiter transport uncertainty leaves already admitted DB-fenced work active while new work delays. Reconnection must recover the same consumer. Task9 must propagate the supplied signal.reason for permit-loss cancellation, or explicitly translate a known SDK abort wrapper at its handler boundary, so the consumer delays without consuming failure attempts. Unrelated errors retain ordinary failure handling. Actual DB lease renewal and model/checkpoint progress through outages remain later integration checks.

## Task 7 acceptance after review (2026-11-06)

- Initial implementation `3a23892eb0350ba5fd232ebe29b33f1e94bab26e`; fixes `d3e2389e4dfc48221cf1ad554b2e9c42aace4ed7`, `366ed5637d55b44b234c4e147d8842ab48b82481`, and `7fa65d1714050e8d674aaa793fec6fc16d129be1`. Spec and quality approved after four original Important findings and the subsequent stale-settlement regression were resolved. No remaining blocking finding.
- RunService requires the exact live Identity actor, rechecks current policy, persists session/MFA provenance and a complete resolved profile snapshot, then inserts run, initial step, admission and deterministic outbox in one tenant transaction. Copied/escaped actors, unreviewed route, and injected outbox failure create no run/outbox/admission. Real API module startup refuses a persisted capacity mismatch; actual API/worker lifecycle configures capacity before consumer activation.
- Caller-owned `JobExecutor.executeWithin` verifies tenant/user context and commits receipt with caller effects. Coordinator preserves version/sequence through claim/recovery, guards existing mutations organization-advisory → run → step, rejects mismatched outer IDs, and atomically commits output, settlement, status/counters and one continuation. Duplicate/stale/terminal deliveries add nothing.
- RED/GREEN: live-actor assertion initially missing then 7/7 unit tests; caller-session receipt execution initially missing then rollback/context-mismatch controls passed. First-step approval originally returned stale; guarded queued→running→awaiting_approval commit now succeeds without double-consuming version. Missing profile snapshot and missing iteration update each had behavioral RED; generation increments once, continuation does not, and saved limits/routing survive registry mutation.
- Budget-overrun RED completed the run without error/partial text. Coordinator now uses Usage settlement in the receipt transaction: truthful reported usage plus failed `AI_BUDGET_EXCEEDED`, one partial-text append, null final output, no successor, and admission release. Both requested completion and continuation are covered; duplicates do not repeat output, counters or usage.
- Re-review found stale settlement initially threw generic Usage error. Typed `UsageClaimLostError` preserves rollback-and-stale semantics at the initial guard and later repository-false path; valid-claim invalid settlements still reject. Actual PostgreSQL takeover and expiry tests assert receipt/usage/output/counter/outbox rollback and replacement/claim preservation. Final affected concurrency/usage run passed **32/32 tests**.
- Main-session final command `pnpm exec vitest run --project backend-unit --project backend-integration run-capability.spec run-registry.spec ai-run-start.spec ai-step-concurrency.spec job-receipts.spec ai-capacity.spec runtime-composition.spec ai-storage.spec ai-attempts.spec run-authorization.spec` passed **89 tests / 10 files**, exit 0, 20.19s. Final scoped build/typecheck/lint (**86/86 boundaries**)/format/diff checks passed. The prior full `pnpm test` passed **654 tests / 129 files**, exit 0, 66.54s, before the scoped fixes; it is not a full-suite claim for the final fix head. Existing jsdom warnings/runtime logs remain qualified.
- Staging: the harness does not fabricate generation; drain explicitly reports that the executor is not enabled. Task9 must mark a claimed queued run running in a short guarded reservation/policy transaction before model I/O, preserving version/sequence. It must use the immutable snapshot, explicit generation/continuation advancement, actual durable terminal state after budget policy, and typed claim-loss handling. Lease-renewal scheduling, streaming, tools/approvals/cancellation and owner-deferred paid checks remain later tasks. No schema, dependency or applied migration changed.

## Task 8 implementation evidence (2026-11-06)

- Added the bounded/fenced run-wide Valkey stream pool with exact `MAXLEN 1024`, maximum serialized event envelope of 4096 UTF-8 bytes, 24 active + 6 retained terminal slots, and a 3600-second terminal TTL. PostgreSQL active proof, committed terminal proof, and bounded registry reconciliation are tenant-scoped and complete before Valkey operations. Terminal proof matches latest committed step ID, sequence, expected version, and fence; later run-version movement is permitted.
- Text and structured tool-argument events split on Unicode code points with byte counts over serialized JSON. Oversized completed tool input ends with typed `operationId` metadata for durable F4 lookup. Whole tool outputs are represented as `operation-status` and do not copy raw result values into the stream. No new migration, dependency, consumer group, or AI SDK import outside `infrastructure/ai` was added.
- Fresh-DB-proof/terminal-close/early-eviction race is covered: an old pending publisher is released after its run was terminalized and evicted; it returns stale and creates neither stream nor guard. A separate test confirms approval-paused active runs are preserved during reconciliation after their step lease is cleared.
- Focused `pnpm exec vitest run --project backend-unit --project backend-integration run-stream-parts.spec ai-streams.spec ai-stream-memory.spec`: **12 tests / 3 files passed**, exit 0. This covers exact trimming at 1024 after 1025 writes, active admission/retention bounds, same stream across step sequences, stale fence rejection, terminal TTL and no append after guard deletion.
- Real pinned-image memory test measured **5,294,840 bytes** for the stream, guard, active/terminal registries, epoch, and context registry at 1024 retained events whose serialized envelope is exactly 4096 bytes; events vary and use noncompressible alphanumeric data. This is a local Linux/aarch64 Testcontainers measurement, not CI evidence. It is below 6,291,456 bytes by 996,616 bytes and is recorded in `docs/references/F3-stream-memory.json` with `ci:false`.
- Final full `pnpm test` against the exact source passed **675 tests / 132 files**, exit 0, 66.65s; log: `/tmp/lexon-f3-task8-pnpm-test-final.log`. `pnpm typecheck`, `pnpm lint` (**86/86 boundary checks**), `pnpm format:check`, `pnpm build`, and `git diff --check` also passed.
- The stream service is exported for Task 9 composition and remains headless. No product profile, UI, model call, customer data, or production generation was added. Cross-store PostgreSQL/Valkey commits remain non-atomic; PostgreSQL stays authoritative during Valkey outage.
