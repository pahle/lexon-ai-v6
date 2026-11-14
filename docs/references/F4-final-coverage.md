# F4 brief coverage crosswalk

This crosswalk maps the 29 numbered brief criteria, 12 user flows, and material
owner amendments to the detailed implementation and evidence records in
[F4 acceptance](F4-acceptance.md). Task section references below describe the
current implementation evidence; they do not imply that final-head gates or
owner review are complete. Status terms: **recorded** means the task evidence is
documented; **pending** names a remaining owner decision. Exact-head hosted
verification and readiness are tracked in [PR #29](https://github.com/pahle/lexon-ai-v6/pull/29),
with the four Important fixes detailed in [the fix-wave receipt](F4-final-fixes.md).

## Numbered brief criteria

|                                     Brief item | Evidence anchor in F4 acceptance / supporting record                                                                                      | Status                                                                                                                          |
| ---------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
|          1 — owner/org RLS and private content | Tasks 5, 6, 8, 9, 11, 16: storage, authorization, negative tests, and deletion fences                                                     | Recorded; exact-head suite tracked in PR #29                                                                                    |
|               2 — message tree and viewed leaf | Tasks 5, 6, 9, 10, 14: branch persistence and public runtime proof                                                                        | Recorded; exact-head suite tracked in PR #29                                                                                    |
|     3 — message/run source of truth and limits | Tasks 4, 6, 7, 10, 16: limits, output, reasoning, and persistence evidence                                                                | Recorded; full-history calibration remains pending                                                                              |
|                         4 — atomic send/outbox | Tasks 4, 6, 11: transactional start and rollback evidence                                                                                 | Recorded                                                                                                                        |
|                            5 — idempotent send | Tasks 6, 11: duplicate request identity and atomic send regressions                                                                       | Recorded                                                                                                                        |
|                 6 — one active answer per chat | Tasks 4, 6, 9, 10: admission, cancellation, and public runtime behavior                                                                   | Recorded                                                                                                                        |
|                   7 — edit/regenerate branches | Tasks 5, 6, 9, 10, 14, 15: tree mutations and UI branch behavior                                                                          | Recorded                                                                                                                        |
|         8 — branch-only context and truncation | Tasks 4, 6, 16, 17: context assembly, hostile-history and evaluation evidence                                                             | Recorded; full-history calibration remains pending                                                                              |
|                   9 — chat profile and budgets | Tasks 4, 6, 17: profile limits, admission, and authorized short smoke                                                                     | Recorded; ceiling calibration remains pending                                                                                   |
|       10 — effort contract and gateway request | Tasks 2, 4, 7, 14, 17: shared schema, profiles, and mock/provider assertions                                                              | Recorded                                                                                                                        |
|              11 — reasoning stream and privacy | Tasks 2, 7, 8, 10, 16, 17: event schema, redaction, nullable timing, and mock evaluation                                                  | Recorded; real smoke was limited to four authorized requests                                                                    |
|             12 — authorized SSE hub and replay | Tasks 1, 8, 9, 10, 16, 18: connection ownership, replay, proxy and load evidence                                                          | Recorded; final-head Linux/load gates pending                                                                                   |
|       13 — replay gaps and PostgreSQL recovery | Tasks 8, 10, 16, 19: checkpoint/recovery and browser transport evidence                                                                   | Recorded; exact-head suite tracked in PR #29                                                                                    |
|               14 — graceful shutdown/reconnect | Tasks 8, 10, 16, 18, 19: hub lifecycle, restart proof and load path                                                                       | Recorded; final-head Linux/load gates pending                                                                                   |
|                        15 — owner cancellation | Tasks 8, 9, 10, 16: cancellation authorization, partial output and capacity fences                                                        | Recorded                                                                                                                        |
|          16 — proxy buffering and Next routing | Tasks 1, 8, 10, 18: Caddy route/flush proof and no frontend API proxy                                                                     | Recorded                                                                                                                        |
|                 17 — ChatTransport and runtime | Tasks 10, 16, 19: public runtime choice, persisted branch behavior and transport recovery                                                 | Recorded; exact-head suite tracked in PR #29                                                                                    |
|              18 — prototype screens and states | Tasks 14, 15, 19; [Task 19 visual evidence](F4-acceptance.md#task-19--visual-corrections-and-capture-evidence-done-with-concerns)         | Recorded with deviations; owner visual review pending with ready PR                                                             |
|                  19 — sidebar and recent chats | Tasks 12, 14, 15, 19: title invalidation, navigation, menu and capture evidence                                                           | Recorded with approved navigation presentation changes                                                                          |
|                  20 — Chats page and search UI | Tasks 11, 13, 14, 15: list, pagination, search, empty/no-results behavior                                                                 | Recorded; exact-head suite tracked in PR #29                                                                                    |
|            21 — routes and not-found isolation | Tasks 10, 13, 14, 15, 19: route ownership and public browser behavior                                                                     | Recorded; exact-head suite tracked in PR #29                                                                                    |
|                                  22 — feedback | Tasks 2, 13, 14, 15: contract, persistence, one-rating behavior and UI                                                                    | Recorded                                                                                                                        |
|                             23 — Markdown copy | Tasks 14, 15: prototype action and browser behavior                                                                                       | Recorded                                                                                                                        |
|            24 — AI title and rename precedence | Tasks 12, 16: excerpt, generated title and user-rename fencing                                                                            | Recorded                                                                                                                        |
|      25 — private FTS/trigram search and plans | Task 13, Task 15, [search diagnostic](F4-search-query-plan-gap.md)                                                                        | Intermediate Linux runs pass blocking gate; exact-head isolated gate tracked in PR #29; 500 ms target warnings are non-blocking |
|                                    26 — rename | Tasks 12, 15: validation, user-title precedence and Recent update                                                                         | Recorded                                                                                                                        |
|              27 — permanent delete and cleanup | Tasks 11, 12, 15: authorization, outbox, retries, resource cleanup and not-found                                                          | Recorded; F18 retention/deletion ledger remains out of scope                                                                    |
|      28 — content-free audit and durable usage | Tasks 2–16 plus [final mutation-audit fixes](F4-final-fixes.md): strict contracts, transactional append/replay/rollback and durable usage | Recorded                                                                                                                        |
| 29 — mock evals and manual real-model workflow | Tasks 16, 17: mock cases and [safe smoke evidence](F4-smoke.json)                                                                         | Recorded; smoke authorization exhausted, no additional paid calls                                                               |

## User flows

|                               Flow | Evidence anchors                                                   | Status                                                                             |
| ---------------------------------: | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
|         1 — Ask, stream, and title | Tasks 4, 6, 7, 10, 12, 19                                          | Recorded; exact-head suite tracked in PR #29                                       |
|                  2 — Deep thinking | Tasks 4, 7, 14, 17                                                 | Recorded; real samples limited to the authorized smoke                             |
|       3 — Refresh during streaming | Tasks 8, 10, 19                                                    | Recorded; exact-head Linux verification tracked in PR #29                          |
|     4 — Reopen after stream expiry | Tasks 8, 10, 19                                                    | Recorded; exact-head Linux verification tracked in PR #29                          |
| 5 — Stop and retain partial answer | Tasks 8, 9, 10, 16                                                 | Recorded                                                                           |
|  6 — Safe failure and retry branch | Tasks 4, 7, 10, 16                                                 | Recorded                                                                           |
|       7 — Edit and switch branches | Tasks 5, 6, 9, 10, 14, 15, 19                                      | Recorded                                                                           |
|      8 — Regenerate sibling answer | Tasks 6, 9, 10, 14, 15                                             | Recorded                                                                           |
|   9 — Search, snippet, open result | Task 13, Task 15, [search diagnostic](F4-search-query-plan-gap.md) | Recorded; exact-head search gate tracked in PR #29                                 |
|    10 — Rename/delete from sidebar | Tasks 11, 12, 15                                                   | Recorded                                                                           |
|  11 — Worker crash and resumed run | Tasks 8, 10, 16, 18                                                | Recorded; exact-head Linux verification tracked in PR #29                          |
| 12 — Backend restart and reconnect | Tasks 8, 10, 19                                                    | Recorded in Task 19 runtime proof; exact-head Linux verification tracked in PR #29 |

## Owner amendments and explicit deferrals

| Owner decision                                                                          | Evidence and disposition                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 16A compensating mutation evidence required before handoff                         | Task 16A acceptance: backend mutation score 87.04% against break-80, plus 35 frontend/manual checks and real mobile RED/GREEN evidence; reviewed and complete |
| Task 17 smoke is locally authorized, bounded, and not repeatable                        | Task 17 acceptance and `F4-smoke.json`: four successful requests, USD 0.00120428; authorization exhausted, no more paid calls or account/admin API            |
| S2 uses an isolated per-user limit of 256 to measure two owners × 250                   | Task 18 acceptance/report and safe load aggregates; local 500-connection run passed, exact-head Linux load tracked in PR #29                                  |
| Search blocking limit is p95 <1,000 ms per class; 500 ms is a warning target            | Current policy in [search diagnostic](F4-search-query-plan-gap.md); latest intermediate run passes blocking gate with stem and partial warning                |
| Retire exactly 20 approved F2.1 assertions; retain 62 passing assertions                | [F2.1 baseline audit](F4-f21-baseline-audit.md): owner-approved retirement; preserve original artifacts, create all 20 replacements in F4.1                   |
| Task 20 golden locking moves to F4.1                                                    | Task 19 acceptance: all 66 current captures reviewed with deviations; replacement baselines deferred                                                          |
| Owner reviews Task 19 visuals at final ready PR                                         | Task 19 independent spec/quality review passed; owner visual approval remains pending                                                                         |
| Task 17 real-eval cap is not additional authorization for paid calls                    | Task 17 acceptance: no paid workflow dispatch; no further model call authorized                                                                               |
| F8 calibration, P8 physical region, and F17 unknown-cost reconciliation remain deferred | Task 17 acceptance and Task 21 self-audit; no claim of resolution                                                                                             |

The owner's bounded I2 follow-up authorizes one client run-identity repair with structural controller RED/GREEN and one repair-only review. Any further Important finding in that review requires a stop; final-head gates remain mandatory. See [scope and evidence](F4-final-fixes.md#owner-authorized-bounded-i2-identity-repair).

## Final handoff gates

Task 21 readiness fixes have controller-observed structural RED/GREEN and are
recorded in [F4 acceptance](F4-acceptance.md#task-21--whole-branch-verification-and-pr-handoff-in-progress).
On source `f2c7d9d`, frozen install, build, typecheck, lint, Node tooling
(262/262), root tests (1,382 tests across 198 files), and mock evals (48/4)
passed. Compose E2E on `f2c7d9d` completed in 359.444 seconds with exit 1:
68/74 passed, six failed; controller record
`recovery/task-21-final-compose.json`, log SHA-256
`88f1cb1c618cad7d2a4ea60e3b0279820cb4ceccc7d622dec5a82426ac845c28`. One
failure was the Task 6A keyboard focus race at
`backend/test/e2e/app-shell.spec.ts:391`; five were retained Darwin screenshot
comparisons with typography width/weight differences. The cause of those visual
differences is unconfirmed. The approved test-only active-element poll before
the existing `End` keypress is now in the test; focused controller GREEN passed
in 105.946 seconds total (2.3 seconds for the test), record
`recovery/task-21-keyboard-fixture-GREEN.json`, log SHA-256
`5b432425907819bf6426ad4ffe0072568b4545868386ff6ce85288cdedcb512b`. All
keyboard assertions/key presses/timeouts remain. At that readiness checkpoint, UI code was unchanged from
the Linux run at `8f6cea3`, which passed both jobs, but that does not establish
the visual comparison cause. The owner-retired scope remains exactly 20; the 62
prior passing assertions and all 82 original images remain unchanged. Main
preserved the failure contexts and isolated captures, then restored the reviewed
66-image set/index/manifest with matching hashes. Final Linux baseline comparison
is authoritative; no failure is waived and no baseline/tolerance changed.

The intermediate normal Linux run at `8f6cea3` is not final-head verification.
The whole-branch review ran at `5f07d1c`; its four Important fixes and honest
aggregate results are documented in [the fix-wave receipt](F4-final-fixes.md).
Scoped re-review, the complete exact-head Linux suite and retained baseline
comparisons, isolated search and isolated S2 remain mandatory before ready
handoff. Their actual results and PR readiness are tracked by head SHA in
[PR #29](https://github.com/pahle/lexon-ai-v6/pull/29). Owner review of the
Task 19 gallery remains with that PR; no merge is authorized.
