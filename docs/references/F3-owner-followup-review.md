# Owner-authorized R1–R4 follow-up — scoped review

**Verdict: PASS for the scoped changes. R1–R4 are all ADDRESSED.** New or residual findings in this diff: **0 Critical, 0 Important, 0 Minor**.

**Spec compliance: PASS. Code quality: PASS. Ready to merge: Yes, subject to the controller's required corrected-head Linux CI and existing acceptance qualifications.** This permits proceeding to those gates; it does not claim they have passed or authorize merging, provider execution, or another implementation wave.

## Scope and authority

Reviewed the complete supplied 45,372-byte, nine-file package from `e23f777` to `f9243743ab2655b1f2cefdd51bf1846da00a964e`. This is the one owner-authorized review of the focused R1–R4 follow-up, not another whole-branch review. Necessary unchanged context was inspected only to establish the changed cancellation, proposal settlement, serialized writer, and notification-fence behavior.

Read the handoff first, followed by the owner brief, implementation report, original R1–R4 and I6 evidence qualification, and global constraints. The explicit owner choice of `maxToolProposalsPerGeneration`, default **8**, hard maximum **15**, and safe pre-staging refusal supersedes the earlier batching preference. The review does not require the superseded design.

Only this ignored report was written. No source/index/HEAD/branch mutation, subagents, tests, provider/key/account/admin calls, or paid execution occurred. No focused test was necessary: the supplied diff, relevant unchanged implementation, and reported focused results answered the scoped questions. The five controller-owned uncommitted public documents are outside this source package and are not certified as synchronized by this report.

## Evidence and qualifications

The controller independently corroborated the saved full-suite exit `0`: **895/895 tests, 148/148 files, 130.63 s**. The reported combined focused run passed **7/7**, covering the expired-cancellation path, proposal limits, actual unexpired approval-version rejection, stale tool commit, real tool timeout, timeout drain proof, and independent PREPARE epoch mismatch. Registry tests passed **13/13**. Four-package typecheck, build, root lint with **96** boundary checks, formatting, and diff checks passed.

These are local results for the candidate, not an independent suite run by this reviewer. **Corrected-head Linux CI remains pending and controller-owned.** Prior Linux Compose results do not substitute for that gate.

The implementation report distinguishes actual behavioral REDs from fixture mistakes and post-fix covering assertions: R1 observed sequence 1 instead of 2; R2 observed over-limit staging and invalid registration acceptance; R3 observed continued rather than failed on the latest tool-continuation run span. The initial malformed test outcome and wrong span selection were corrected before being counted as behavioral REDs. Explicit-15/16 and legacy-snapshot cases are labeled covering evidence. R4 is a test-correctness repair and does not claim a historical production RED. These distinctions should remain in public acceptance.

## Strengths

The production changes are small and match the authorized remedies. Cancellation fixes the durable sequence transition rather than weakening terminal proof. Proposal cardinality is bounded before operation preparation/staging, while normal attempt settlement and the saved configuration model remain intact. The telemetry correction changes only the reported outcome of a stale tool continuation. The timeout test now uses the existing serialized queue to prove completion while keeping the connection open, without a production test hook or timeout extension.

No stream event, queue, memory, TTL, dependency, migration, provider, or product-registration limit was expanded. The existing 32-event publication bound, four-publication queue bound, and 250 ms write budget remain unchanged.

## R1 — ADDRESSED: expired public cancellation and terminal lineage

**Source:** `backend/src/modules/chat/cancel.service.ts:62`, `:101`, `:109`.

The service initializes an optional next sequence, sets it only after `commitExpiredCancellation` succeeds, and supplies it to the cancelled run transition within the same `withTenant` transaction. The locked run/current-step predicates ensure the increment applies to the expired current step. A live claim still returns without terminalizing. Pending/no-committed-step cancellation leaves the optional value unset, preserving its neutral lineage. Terminal authorization itself is unchanged.

This restores the invariant required by the real non-neutral terminal reference: once the expired current step is committed, `run.nextSequence` is its sequence plus one. The existing repository path still settles active fenced attempts unknown without clearing reservations or observations; partial append, audit, admission release, and terminal reference remain inside the lifecycle transaction.

**Evidence:** The extended public-cancel regression in `backend/test/integration/ai-cancel.spec.ts:150` uses real PostgreSQL authority and a real existing Valkey stream. It asserts sequence 2, committed step, unknown settled attempt with preserved generation/reservation fields, one partial append, cancelled status followed by finish, removal from active membership, terminal membership using `runId|generation`, and TTL greater than zero and no more than 3600 seconds. Repeated cancellation and a terminal reference returned by the real reconciliation authority add no event or audit and do not change sequence/output. Late publication under the old claim is stale. Existing neutral pending-cancellation tests remain in the full suite.

The new test does not independently exercise every historical crash/redelivery schedule; it directly closes the previously demonstrated lineage/stream failure, and terminal redelivery behavior was not changed.

## R2 — ADDRESSED: bounded proposals and genuine unexpired stale-version proof

**Sources:** `backend/src/modules/chat/run-contracts.ts:5`; `backend/src/modules/chat/run-registry.ts:96`; `backend/src/modules/chat/run.service.ts:141`; `backend/src/modules/chat/step-executor.ts:1053`, `:1214`, `:1551`.

The optional profile field follows the existing profile conventions. Registration accepts positive safe integers up to 15, with omitted configuration using 8. Run start records the resolved value in the immutable profile snapshot. Executor resolution validates a present snapshot value against the same range, and resolves an older missing field to 8 without rewriting that saved snapshot. The run continues to use its saved numeric configuration; current capability checks remain separate and unchanged.

The executor compares the full generation's proposal array length before preparing any operation. This counts all tool proposals, not merely approval-required ones. An excess successful generation sets the existing invalid-proposal path, producing finite `AI_INVALID_TOOL`, terminal failure, no staged operations, and no approval pause/effect. It does not truncate proposals or introduce a policy retry. Text and successful physical-attempt observations still pass through the existing terminal commit/settlement path.

At the maximum, the initial lifecycle batch contains at most one status plus two events per operation: **1 + 2×15 = 31**, within the unchanged 32-event writer limit. Later operation continuations notify their relevant operation rather than expanding the original batch beyond that bound.

**Evidence:** `backend/test/unit/run-registry.spec.ts:139` covers omitted/default and maximum acceptance plus zero, fraction, and 16 rejection. The real executor/Valkey matrix in `backend/test/integration/ai-execution.spec.ts:2161` covers default 8 accepted / 9 refused, explicit 15 accepted / 16 refused, and an older snapshot missing the field with 9 refused under fallback 8. Accepted cases compare every stored operation ID with both operation-status and approval-required IDs. Refused cases assert failed/`AI_INVALID_TOOL`, zero operations, no approval-required notices, and zero effects. Snapshot assertions distinguish persisted defaults from the legacy resolution fallback.

**I6 evidence qualification is also closed:** The revised test starts executor work without awaiting the held publication's timeout. It records the held incoming version and server expiry, advances the durable approval decision and guard through a second writer, confirms the guard version is newer, and verifies actual Valkey TIME remains before expiry immediately before release. The actual held `APPEND_COMMITTED_RUN_STREAM` returns **-1**, whereas that script's expiry branch returns **-3**. The version comparison is therefore exercised while unexpired, rather than inferred from an already-expired command. The subsequent fresh publication separately checks database stale refusal. Relevant assertions are at `ai-execution.spec.ts:2012`, `:2117`, and `:2120`.

The test remains subject to normal CI timing: if the controlled work cannot complete within the unchanged budget, its explicit unexpired assertions should fail rather than silently treating timeout as guard proof. The supplied local focused/full runs passed; corrected-head Linux evidence remains pending.

## R3 — ADDRESSED: stale transactional-tool span outcomes

**Source:** `backend/src/modules/chat/step-executor.ts:568`.

The normal transactional-tool continuation now derives both ended statuses from the coordinator result: committed gives run continued / step succeeded; stale gives failed / failed. The correction does not alter authorization, effects, receipts, retries, or the separate actual tool-timeout path, which retains continued / failed.

**Evidence:** `backend/test/integration/ai-execution.spec.ts:636` expires the real claim immediately before delegating to the actual coordinator commit. It observes the real stale result, zero effect, a still-pending operation, and the latest ended run/step spans for that run both failed. It does not substitute a fake stale return. The existing actual PostgreSQL tool-timeout test now also asserts the run/step continued/failed pairing; both cases passed in the combined focused run. The report's receipt safety claim is supported by the real coordinator's pre-effect fence/transaction path; the new test explicitly asserts effect and operation state rather than a separate receipt-count assertion.

## R4 — ADDRESSED: underlying writer completion before absence assertions

**Source/test:** `backend/test/integration/ai-streams.spec.ts:2172`, `:2200`; necessary unchanged queue context `backend/src/infrastructure/queue/run-streams.ts:950`.

After the initial public wrapper returns unavailable, the test releases delayed authorization and enqueues a normal `publish` probe on the same claim and still-open writer. Normal publication does not invalidate the preceding task. The queue's drain awaits each task before starting the next. The probe's one-shot TIME rejection therefore cannot be observed until the previous underlying task has finished, and the test explicitly waits for that observation and for the probe's unavailable result.

The probe is rejected before its mutation path; it does not deliberately recreate the target or use a second invalidation as a drain. No disconnect/close or arbitrary post-release sleep is used as settlement evidence. Absence assertions then inspect stream, guard, active membership, and actual terminal members by the `runId|` prefix. The barrier and TIME spy are released/restored in `finally`, with connection cleanup after the assertions. The independent deterministic PREPARE epoch-mismatch test is unchanged and was included in the seven-case covering run.

This supplies the completion ordering missing from the prior test without adding a production hook or relying on the already-resolved timeout wrapper.

## Findings and out-of-scope observations

**Critical:** None. **Important:** None. **Minor:** None identified in this scoped package.

No new untouched-code defect is introduced by this review. The old terminal-proof, operation-commit, and serialized-queue code was read solely to verify the changed paths. No broader F3 requirement or previously closed finding was reopened.

Actual account/key/ZDR setup, real smoke/calibration/paid evaluation, physical-region evidence, production K1 acceptance, and hosted post-main workflow activation remain owner-deferred and were not judged here. F4 transport/UI, external write adapters, product profiles/tools, broader crash/fairness guarantees, and historical TDD certification remain outside scope. Historical SIGKILL uncertainty, earlier intermittent late-write failures, and prior process deviations are not erased by this pass.

## Final assessment

**R1, R2, R3, and R4: ADDRESSED. Spec compliance and code quality: PASS for `e23f777..f924374`.** No residual Important issue triggers the owner's stop rule. Proceed to the controller-owned corrected-head Linux gates and public evidence reconciliation; do not describe those pending gates or deferred real-provider acceptance as complete.
