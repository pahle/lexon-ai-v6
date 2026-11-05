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
