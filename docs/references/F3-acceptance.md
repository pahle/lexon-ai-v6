# F3 acceptance evidence

Date: 2026-11-05
Scope: portable run contracts, state transitions, registration validation, and model/identity/database type foundations only.

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
validation, opaque actor/claim and neutral model type foundations. Tasks2–17
have not started. No run execution, HTTP/UI, model request or database migration
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
- Final full `pnpm test` passed **531 tests / 113 files**, exit 0, 57.13s. Three existing jsdom `Not implemented: navigation to another Document` warnings appeared; no test failed. See the Task 2 report for exact RED/GREEN history, intermediate validation issues, and scope notes.
