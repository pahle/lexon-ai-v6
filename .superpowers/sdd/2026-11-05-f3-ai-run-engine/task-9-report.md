# Task 9 continuation report

**Status:** implementation and evidence are ready for controller review; Task 9 is not self-accepted. The earlier implementation is committed at `dfa0627`; this review-fix round is local on `f3-ai-run-engine` and will be committed without pushing.

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

## Review-fix round 1/5 (base `dfa0627`)

The owner review identified five lifecycle gaps. The new named integration regressions were first run against the `dfa0627` implementation and reproduced these REDs: short-lease context and retry runs lost the claim; the deadline test timed out waiting on an unresponsive gateway; hostile context reached the gateway without a data-only preamble/fence; engine metadata/publication errors left iterator cleanup incomplete; a gated checkpoint never persisted the later text revision; and retry-refusal/over-reserved terminal commits did not finish streams. These cases are included by name in the final GREEN commands below.

- **R1 — claim renewal scope:** heartbeat now starts synchronously after successful claim and before stream recovery or any subsequent await. One serialized renewal chain covers context collection, reservation, generation, checkpoints, retry settlement and backoff, and receipt settlement; all returns await renewal teardown. The production lease and renewal defaults remain 30,000 ms and 5,000 ms. The model call deadline defaults to 60,000 ms, and its test override accepts only positive safe integers. Retry backoff listens to the heartbeat signal.
- **R2 — iterator cleanup:** engine failures abort the model signal, await iterator `return()`, and preserve the original engine/permit reason if cleanup also errors. Provider-error handling remains scoped to iterator acquisition and `next()`.
- **R3 — checkpoint ownership:** checkpoint writes serialize around a captured attempt, revision, and byte prefix. Success acknowledges only that captured prefix, leaving text appended during the write dirty for the next flush. The timed flush runs while a stream is paused; teardown clears the timer and awaits checkpoint ownership before settlement or retry.
- **R4 — untrusted context:** every context piece uses the existing `fenceUntrusted(text, label)` nonce fence and the system message explicitly treats enclosed content as data. The regression inspects the actual gateway input.
- **R5 — durable terminal finalization:** after each successful terminal-capable commit, the executor reads durable run status and emits one finish only for a terminal row. Retry-reservation refusal and over-reserved `length` completion assert one finish, no successor outbox, and no later event.

Final covering GREEN command and output:

```text
pnpm exec vitest run --project backend-integration ai-execution.spec ai-step-concurrency.spec ai-attempts.spec
```

Exit **0**; **3 test files passed, 60 tests passed**. The focused review-regression run also passed:

```text
pnpm exec vitest run --project backend-integration ai-execution.spec -t 'stops claim renewal after an early context error|checkpoint ownership loss|caller cancellation reaches|model-call deadline|renews a short-lived claim while the context|renews through the bounded retry|serializes timed checkpoints|context labels and text|metadata persistence failure aborts|stale stream publication aborts|retry reservation failure|over-reserved length completion'
```

Exit **0**; **12 passed, 15 skipped**. The final covering run was repeated after the lint correction and final heartbeat checks.

Final-source gates:

- `pnpm typecheck` — exit **0** for shared, backend, frontend, and evals.
- `pnpm build` — exit **0** for shared, backend, frontend, and evals.
- `pnpm lint` — exit **0**; **86/86 boundary checks passed**. The first lint run found an unsafe throw in `finally` and a redundant catch. Cleanup now records its error through teardown and throws afterward, preserving any primary engine failure.
- `pnpm format:check` — exit **0**; all matched files use Prettier style.
- `git diff --check` — exit **0**.

The deadline composes `AbortController` signals and preserves `AbortSignal.reason`, following the official [Node.js v24.22.1 globals documentation](https://nodejs.org/download/release/v24.22.1/docs/api/globals.html#class-abortcontroller), checked 2026-11-06. No real model calls were made; no model or Valkey I/O runs in a SQL transaction.
