# F3 final-review scope and deferred behavior

The initial whole-branch review covered `63c26f9..d4cbea0` and reported 11 Important and 2 Minor findings. These dispositions retain the limits of that review; they do not certify deferred behavior or close any finding. The aggregate correction wave and its scoped review are still pending.

1. Account/key/ZDR settings, real smoke/calibration/paid behavior: retain the owner's explicit deferral. Outgoing mocked transport and budget guards remain implemented; no account/admin action is authorized.
2. Hosted real-workflow activation: retain post-default-branch operator verification; do not merge early.
3. Physical provider/production K1 region: retain P8 dependency; configured azure/us is not physical-location evidence.
4. F4 HTTP/SSE/browser reconnect: defer transport/UI; require F3 producers and explicit reset signals now (I1/I6 and producer ruling below).
5. F5 approval UI/expiry/external adapters: defer those surfaces; keep implemented transactional effects and typed recovery contracts.
6. External outcome_unknown behavior: no unsupported external adapter may execute in F3. Retain typed unit recovery decisions; future slices must test actual model/event/result behavior.
7. Product profiles/retrieval/memory/customer quotas: retain stated future scope, empty production registration, admission fairness distinct from quota.
8. Design-system changes: none authorized; preserve F2.1 source/goldens and require final Linux E2E against them.
9. Historical SIGKILL and prior 57P01 issuer: preserve exact provenance and uncertainty. Claim-race/fixture diagnoses are not proof of historical SIGKILL cause. Current CI must pass, without claiming universal stability.
10. Terminal orphan/pending operation rehabilitation: no new generic repair subsystem in F3. Terminal runs cannot resume. Fix I2 active-attempt/step finalization and M2 invalid proposal staging; later operation views must account for terminal run state.
11. Status/error/operation event cadence: implement a bounded minimum for committed lifecycle/operation outcomes, in addition to required approval publication. No reliable event log or F4 hub is introduced. The approved minimum is active running status, committed operation/approval outcomes, and terminal status plus a safe error when applicable before finish, authorized from actual committed lineage.
12. Mutable trusted registry objects: no separate speculative hardening. Preserve immutable persisted snapshot/current policy floor; fix M2 effective proposal capability validation.
13. Future remote I/O in read tools: no production read tool ships. Preserve no model/Valkey I/O in SQL; each future external tool requires its own execution-boundary review.
14. Hypothesized metadata cleanup deadlock: no unproven production change. Retain actual abort/iterator/metadata persistence tests; concrete evidence may reopen a defect.
15. Universal scheduling/crash/COMMIT/race guarantees: no universal proof claimed; retain bounded actual tests, safe unknown outcomes, and explicit cross-store/COMMIT uncertainty.
16. Exhaustive historical test-body/deployment/TDD certification: not claimed. Preserve disclosed process deviations, actual current checks, and immutable applied migrations.

The aggregate final fix wave must address I1–I11. M1/M2 are also included because they share the touched lifecycle/proposal paths and add no product scope. Final review has one aggregate fix wave and one scoped re-review; remaining findings require explicit disposition rather than a silent second wave.

## Capacity decision for the correction wave

Reject unsupported stream-pool dimensions rather than generalizing the fixed Lua pool during final correction. The coupled limits remain MAXLEN 1024, 4096-byte events, 6,291,456 bytes per slot, 24 active streams and six retained terminal streams, with per-organization active-run ceiling six. Boot must validate declared and actual Valkey memory, at most 30% allocation to Streams and at least 20% headroom inside that allocation. Future tuning may require a reviewed migration/configuration revision; this decision authorizes no cap increase.

## Development memory alignment decision

The existing Compose Valkey `maxmemory` of 96 MiB (128 MiB container ceiling) and unlimited Testcontainers default cannot support F3’s approved 180 MiB pool. With 30% allocated to Streams and 20% of that allocation reserved, the minimum is `180 / (0.30 × 0.80) = 750 MiB`. The correction wave will align both servers to the architecture’s 768 MiB `maxmemory` and the Compose container ceiling to 1 GiB, with no test-only validation bypass. Runtime validation must compare a declared finite Streams-target memory value with the actual server before incompatible AI work.

This raises the dev Valkey container ceiling by 896 MiB. Smaller environments require a reviewed sizing revision; the approved stream cap is not silently lowered. This is a controller decision within the approved fixed-pool design, pending implementation and verification, rather than a claim of a passing topology test.

## Clock-independent stream expiry decision

A controlled test with the client clock 100 ms ahead reproduced reset and terminal writes after the public 250 ms timeout: the client-derived absolute expiry was still in Valkey’s future. The correction wave will retain one monotonic local 250 ms budget and derive conservative server-clock expiry using Valkey TIME plus the remaining original budget measured after the response. Queue wait, metadata/clock sampling and retries consume that same budget; retries do not receive a new interval. This adds bounded clock-sampling I/O and propagation code, with no new keys or capacity increase. The earlier intermittent matrix failure remains recorded; this controlled reproduction does not prove its historical cause.

## Owner override (2026-11-09)

The owner authorized exactly one focused R1–R4 follow-up and one scoped re-review of its diff. For R2 the owner chose a proposal limit in the server profile, default 8 and hard maximum 15, with safe refusal before staging or pause. This supersedes the earlier controller preference to process every previously accepted batch. The 32-event and 250 ms bounds remain unchanged. If an Important issue remains after the authorized review, stop and report. No other implementation scope or real-model/account execution is authorized.
