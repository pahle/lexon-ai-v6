# Task 9 continuation report

**Status:** implementation and evidence are ready for controller review; Task 9 is not self-accepted. Work is local on `f3-ai-run-engine`; no push or commit was made during this implementation pass.

## Owner latency evidence

The corrected actual dispatcher → BullMQ → `QueueConsumer` → `StepCoordinator.claim` run waits for each measured handler to finish and asserts zero busy outcomes. Model time is excluded and dispatcher polling remains 1000 ms. On Node v24.22.1, macOS darwin/arm64, with shared Testcontainers PostgreSQL/Valkey and per-file isolation, the uncontended sample was cold **6.908334 ms**, median **2.826604 ms**, p95 **4.635 ms**, max **14.983958 ms**. All twenty warm values and environment are recorded in `docs/references/F3-hop-latency.json`; the ~500 ms gate did not trigger.

The previous twenty values remain in that JSON under the exact label **`contended, invalid as gate evidence`**. They included organization-permit busy deferrals and are excluded from the gate assessment.

## TDD and behavior

- Initial Task 9 RED is preserved in the earlier report section below. This continuation's metadata persistence regression first failed because `execute` resolved `{ kind: 'done' }` instead of propagating the exact persistence error.
- Dirty checkpoint RED: `pnpm exec vitest run --project backend-integration ai-execution.spec -t 'flushes dirty provisional'` failed after a text event and 1.2 seconds of paused generation with zero checkpoint calls. GREEN: an awaited one-second timer flushes the provisional text while `iterator.next()` is pending. Writes are serialized, bounded to the current attempt/claim, and awaited after timer teardown before settlement or retry. A false checkpoint result aborts the stream and propagates ownership loss.
- Retry-reservation RED: `pnpm exec vitest run --project backend-integration ai-execution.spec -t 'retry reservation failure'` observed `partialOutput: ''` instead of `known partial answer` after the first attempt's reported usage exceeded reservation and the next reservation was refused. GREEN: the terminal budget commit includes the prior attempt's latest text; the regression confirms no second provider call.
- Added execution coverage for long generation beyond a 90 ms PostgreSQL step lease; confirmed renewal loss; checkpoint ownership loss; stream publication ownership loss; metadata persistence failure; genuine gateway iterator error; the paused dirty-checkpoint timer; attempt two success with two physical attempts; terminal redelivery with zero new generation/recovery/publication/finalization events; iteration exhaustion with partial output; output and next-outbox rollback together; retry-budget refusal preserving partial output and prohibiting another call; model call after tenant transaction closure; and Valkey publication unavailability with durable completion.
- A provider error catch now surrounds only `iterator.next()`. Metadata, checkpoint, authorization, database, and publication errors escape unchanged. SQL is closed before context collection, gateway calls, and stream I/O. No model or Valkey I/O was moved into a SQL transaction.

## Research notes

- [AI SDK streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) and [generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), read 2026-11-06; installed `ai@7.0.159` docs, source, declarations, and CHANGELOG checked. The SDK stream is an async iterable; awaited event persistence must finish before requesting the next event. Existing gateway remains one physical generation with `maxRetries: 0` and `streamRetries: 0`.
- [BullMQ worker guide](https://docs.bullmq.io/guide/workers), read 2026-11-06; installed `bullmq@6.5.3` worker declarations checked. The hop test uses the existing worker and durable handler path.
- Full source/version/date/decision notes are in `docs/superpowers/specs/2026-11-05-f3-ai-run-engine-design.md` under Task 9 execution and queue-hop research.

## Selected verification

- `pnpm exec vitest run --project backend-integration ai-execution.spec ai-hop-latency.spec ai-step-concurrency.spec --silent=false --reporter=verbose` — exit **0**, **34 tests / 3 files** passed. The hop run had zero busy deferrals and measured cold 7.826916 ms, median 2.797146 ms, p95 3.476791 ms, max 3.692958 ms. The canonical owner-provided corrected sample remains the one recorded in `F3-hop-latency.json`.
- `pnpm --filter @lexon/backend build` — exit **0**.
- `pnpm --filter @lexon/backend typecheck` — exit **0**.
- `pnpm lint` — initial run exposed a `require-yield` lint error in the genuine provider-failure fixture; after adding an unreachable fixture yield, rerun passed with **86/86 boundary checks**.
- `pnpm format:check` — exit **0**, all matched files use Prettier style.
- `git diff --check` — exit **0**.
- The first full `pnpm test` run exited **1** with **704/705 tests passing**. Its only failure was `runtime-composition.spec > document-worker boot imports no AI and opens no TCP listener`: the Task 9 shared runtime provider module statically imported `MODEL_GATEWAY`, so the document worker loaded AI code. Root cause was confirmed in the import path, then AI-only providers were moved into `backend/src/bootstrap/ai-worker-providers.ts`, imported only from the AI-worker root. The module-trace assertion was kept unchanged.
- `pnpm exec vitest run --project backend-integration runtime-composition.spec` after the fix — exit **0**, **5 tests / 1 file** passed.
- After that focused fix, `pnpm lint`, `pnpm format:check`, `pnpm --filter @lexon/backend build`, and `pnpm --filter @lexon/backend typecheck` all passed; lint boundary checks were **86/86**.
- Final full `pnpm test` against final source — exit **0**, **705 tests / 134 files** passed. Actual exit was captured with `pnpm test > /tmp/f3-task9-final-source-pnpm-test.log 2>&1; result=$?; ...; exit "$result"`. The default reporter did not emit a hop sample in this full-suite log; the current-source twenty-sample result remains the separately captured focused integration run in `F3-hop-latency.json`.

## Earlier partial Task 9 report (historical)

The earlier implementation stage added the worker composition, identity-owned actor scope, metadata persistence, provisional checkpointing, retry/usage handling, durable settlement, `length` continuation, inert tool-proposal persistence, and actual queue-job harness. Earlier focused checks passed 18 tests/3 integration files, 9 unit tests for registry behavior, and backend typecheck. That earlier hop set is now explicitly historical and invalid for the owner gate due to measured busy deferrals.

Earlier setup REDs were: missing executor module in the prescribed three-file integration command; callable context registration assertion; estimator fixture below the fixed 1024-token overhead; and hop harness timeout from using a transaction-only outbox repository instead of one bound to the tenant database. Those were corrected in the prior implementation stage and are not acceptance evidence by themselves.
