# F5 Tools & approvals review (squash b333477f on main, 2026-11-25)

Verdict: merged. PR #76 (integration branch f5-tools-approvals, head bd9e13fd) squash-merged by me on the owner's instruction after `gh pr checks 76` exited 0 on that head (unit-integration, compose-e2e x3, merge-e2e, changes, osv-scanner, sbom, chat-sse-load, search-benchmark pass; visual-assemble skipped by design). Task PRs #79-#88 all merged into the integration branch (GitHub status checked).

## Strong
- Owner-only decision route with identical 404 for non-owners, CSRF/origin check, stored-answer validation before CAS on status + snapshotHash.
- Send-while-paused (option A) is one transaction: CAS, audits, run completion, message, new run, outbox. Race test proves a single winner; rename runs at most once.
- Expiry sweep: per-candidate transaction and try/catch, CAS re-checks expires_at, actor-less decided audit, resume deduplicated by stepJobId, access loss -> failed/AI_ACCESS_REVOKED with chat.run_finished.v1 (actor = initiator; owner ruling option (a), PR #86).
- Implementer found and fixed two real defects itself: the 32-event publish cap silently dropping tool parts (bdacd67e, spine-first + <=32 chunks) and the paused composer being unreachable in a real browser (task 10, paused-only send path in thread.aui.tsx; non-paused path unchanged).
- Evals cover ask_user, deadline, rename approval, expiry and prompt injection (asserts no rename and clean audit).
- Visual: 4 owner eye-review rounds against prototype r17; 40 over-gate rows recorded in docs/references/F4.1-visual/deviations.md in three cause groups (14 action bar hidden while paused per spec 6.4 item 4, 12 thread vertical offset, 14 tool row ~3 px); goldens + approval.json written after owner acceptance.

## Process notes
- Task 4 was merged before its CI finished and broke unit-integration (instructions v1 expectation). Rule since then: PR CI completed green before merge; pending is not green.
- My own instruction "run_finished with actor null" was wrong; the implementer stopped at the validator instead of loosening it. Good stop discipline.
- search-benchmark flaked once on bd9e13fd (stem p95 2354 ms vs 1000 ms); same-SHA rerun passed; F5 touches no search code.

## Deferred minors (carry to the next slice or a hardening task)
1. expiry-sweep.ts isRouting accepts any number priority; step-coordinator requires a safe integer 1-10. Latent poison loop if a profile priority were ever invalid. Share the coordinator helper.
2. RunJobSchema member ai.operation-expiry.v1 is never parsed at runtime (scheduler jobs bypass the envelope); kept, documentation-only.
3. chat-stream.ts: tool-input-available without input (over-cap) emits input:{} and clobbers the client-reassembled rawInput; tree refetch corrects it. Accumulate deltas instead.
4. Task 10 e2e: workerSweep return value not asserted; thread-a11y header comment cites the wrong spec for the contrast pass.
