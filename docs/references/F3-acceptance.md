# F3 acceptance evidence

Date: 2026-11-05
Current scope: Tasks1–3 accepted — portable contracts, registry/state, tenant persistence, capacity configuration primitives, atomic global24/org6 admission, and durable attempt accounting. Tasks4–17 remain pending; no run execution or model call is delivered yet.

## Task 3 owner capacity privilege correction (2026-11-05)

- Owner correction applied before accounting work: new append-only migration `0016_ai_capacity_privileges.sql` revokes runtime `UPDATE` and `DELETE` on `ops.ai_engine_capacity`; `0015` is unchanged. Runtime insert-or-compare keeps only `SELECT`/`INSERT`. The compare query is plain `SELECT` because PostgreSQL 17 row-locking clauses also require `UPDATE`; its existing advisory transaction lock remains.
- Research: [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html) says row-locking clauses require `UPDATE`; [PostgreSQL 17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html) supports the privilege correction. Docs read 2026-11-05 against pinned PostgreSQL 17.11.
- RED: `pnpm exec vitest run --project backend-integration ai-capacity.spec` failed because `lexon_app` could update the singleton (`UPDATE` SQLSTATE was successful/null); DELETE was denied. GREEN after migration/repository change: same command passed **8/8 tests**, including direct UPDATE/DELETE denial and independent repositories accepting an identical fingerprint while rejecting a changed fingerprint specifically as `AI capacity configuration mismatch`.
- Reviewed fixed capacity inputs remain `slot_bytes=6291456` and per-organization maximum `6`. Raising either CHECK/config ceiling requires a reviewed migration and operator step.

## Task 3 attempt accounting implementation evidence (2026-11-05)

- Research reread 2026-11-05: [AI SDK 7 generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text) and installed `ai@7.0.159` declarations/changelog; [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and installed `@openrouter/ai-sdk-provider@3.1.0` README/declarations; [PostgreSQL 17 numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html) and explicit-locking docs; Drizzle migration docs and installed `drizzle-orm@0.45.4` migrator. Detailed decisions and exact-version evidence are in the approved design's Research notes.
- Usage now owns durable reserve/settle projection with no Chat lifecycle mutation. Admission locks and revalidates the claimed run/step before reading PostgreSQL budget state; reserves estimated input plus enforced output as one amount, counts every attempt, and fails future reserves after any persisted overrun even if remaining is positive. Unknown retains both reserve components; partial usage replaces only reported components; null cost remains distinct from known zero.
- Cost stays a decimal string and uses the existing `numeric(20,10)` storage contract. Validation rejects more than 10 fractional digits before settlement; no float coercion or implicit rounding was added. OpenRouter provider 3.1.0 exposes cost metadata as a JavaScript `number`; Task 5 adapter work must validate provider metadata and resolve any unsupported precision explicitly before model execution. This implementation does not call the provider or infer cost.
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
- Remaining integration gates: Task 5 must resolve provider cost normalization/precision before real execution; Task 9 must atomically finalize a failed run with truthful usage and partial output when settlement reports overrun. Task 3 supplies accounting only. The three existing jsdom warnings remain recorded for final review.

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

Task 4 implementation is complete and awaiting main-session review; it is not
marked accepted here. Migration `0017` stores nullable initiating session and
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
