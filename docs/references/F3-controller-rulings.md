# F3 controller decisions

These decisions are listed in the order they were made. Each records the cost of being wrong; historical decisions remain visible after later corrections. They do not replace source review, verification, or the owner-deferred real-model acceptance.

1. Keep the established feature checkout rather than create another worktree. Cost if wrong: A later worktree move may be needed; main remains untouched.

2. Use a test-only coordinator for Task 9 scheduling continuity; prove model/tool/model continuity in Task 10. Cost if wrong: Reshape the test if that separation was wrong.

3. Treat two attempts per step as the configurable default, not an absolute maximum. Cost if wrong: A reviewed server maximum may be needed.

4. Use UUIDs for Lexon message IDs and bounded opaque strings for SDK part IDs. Cost if wrong: Adjust bounds or introduce an ID mapping.

5. Claim and lease renewal do not consume the durable run version or sequence. Cost if wrong: Rework coordinator version semantics if recovery proves incompatible.

6. Inspect actual slot rows with test-only migrator access and preserve valid tenant context in negative schema fixtures. Cost if wrong: Small fixture/helper rework; no new runtime grant.

7. Use advisory locking and plain SELECT for capacity comparison because runtime UPDATE is forbidden. Cost if wrong: Revisit the operator migration/quiescence protocol.

8. Use the aggregate persisted input-plus-output budget; partial usage retains unreported components and unknown retains all. Cost if wrong: Rework profile and row mapping.

9. Usage settlement persists truthful numbers and returns a budget flag; Chat atomically fails the run later. Cost if wrong: Adjust the finalizer integration.

10. Keep the original decimal scale temporarily in Task 3 and resolve actual provider precision in Task 5. Cost if wrong: A reviewed precision migration before adapter acceptance, subsequently delivered.

11. Unknown outcomes retain full reservations, while any known reported overrun independently stops admission. Cost if wrong: Conservative early failure; no extra spending admission.

12. Persist initiating session/MFA evidence through an additive migration, without an auth-session foreign key. Cost if wrong: Rework start mapping and evidence handling.

13. Use trusted server-profile capabilities; roles grant no invented resource capabilities or approval authority. Cost if wrong: Extend the central policy in its owning future slice.

14. Lock the organization FOR SHARE while preserving organization/user/member lock order. Cost if wrong: Rework lock modes after deterministic concurrency tests.

15. Change user/member reads to FOR SHARE in a new immutable-history migration. Cost if wrong: Revisit locking if concurrency protection is insufficient.

16. Preserve provider cost using unscaled PostgreSQL numeric and exact decimal normalization, documenting upstream number precision. Cost if wrong: Rework storage or formatting; never silently round or discard cost.

17. Refine neutral assistant/tool history to structured parts with IDs and JSON results. Cost if wrong: Refine the adapter contract before product callers.

18. Represent length/filter outcomes and trusted transient retry classification while preserving authoritative usage. Cost if wrong: Refine outcome handling before production callers.

19. Use SDK brand checks and recognized transport causes, rather than copied names or error-message heuristics. Cost if wrong: Conservative failures instead of potentially repeated charges.

20. Implement two per-organization Valkey permits alongside database claim fencing using separate ownership tokens. Cost if wrong: Adapt neutral handler composition without weakening database authority.

21. Distinguish permit loss from transport unavailability; only confirmed loss aborts admitted work. Cost if wrong: Refine the permit contract if outage behavior proves wrong.

22. Commit generation/non-generation distinctions, usage, partial output, terminal failure and continuation atomically. Cost if wrong: Refine coordinator semantics and mappings.

23. Treat expired cached leases only as reconciliation candidates; require durable terminal/absence proof before cleanup. Cost if wrong: Add stronger proof before eviction.

24. Restore actual maximum-size stream measurement, including metadata, without increasing approved capacity. Cost if wrong: One additional local probe; no unsupported CI claim.

25. Treat authoritative length as a tool-free continuation signal; stop completes normally. Cost if wrong: Refine continuation semantics before product profiles.

26. Add approval metadata/rejected state in migration 0020 and preserve applied 0019. Cost if wrong: An additional migration may need rework.

27. Test actual membership removal before decision and before resume; a ban-only test is insufficient. Cost if wrong: Additional integration fixture work.

28. Use the actual paused step and a neutral terminal reference, never a fabricated failed step/live claim. Cost if wrong: Terminal-reference type and proof rework.

29. Do not mechanically edit RunService/contracts when ApprovalService already consumes the existing interfaces. Cost if wrong: A missed integration may require targeted edits later.

30. Disclose historical tests written after implementation rather than invent retrospective TDD compliance. Cost if wrong: The owner must assess the recorded process deviation.

31. Retain and boundedly reconcile failed durable BullMQ jobs until PostgreSQL confirms finalization, preserving short-job retention. Cost if wrong: Extra queue reads and retained jobs during database outages.

32. Audit tool proposal and completion as distinct status phases; completion shares the effect/receipt transaction. Cost if wrong: Adjust future audit consumers if the phase model is unsuitable.

33. Fix strict audit validation in new migration 0022, leaving applied 0021 immutable. Cost if wrong: An additional migration may need rework.

34. Compose the real durable engine in explicit evaluation fixtures; reject an in-memory placeholder engine. Cost if wrong: Maintain a small dedicated fixture composition factory.

35. Require an actual SDK-consumer framing correction in Task 17; headless eval composition need not wait for it. Cost if wrong: Producer/finalization/recovery work and memory/latency revalidation.

36. Correct SDK 7 system-message conversion to instructions when real composition exposed the incompatibility. Cost if wrong: Adapter rework if message ordering or compatibility changes.

37. Wait for BullMQ acknowledgement explicitly after PostgreSQL cancellation; retain every durable assertion. Cost if wrong: A small test synchronization change.

38. Use real expired-claim/new-fence recovery for mock eval proof, accurately distinguished from separate SIGKILL tests. Cost if wrong: Additional process coverage or seam rework if insufficient.

39. Fail the current manual-eval run on USD over-reservation while preserving attempt truth and stopping subsequent calls. Cost if wrong: Stricter failures may reject useful observations or require policy rework.

40. Enforce the approved 250 ms total stream-publication deadline, including queue wait and retries. Cost if wrong: conservative stream drops or deadline/queue rework.

41. Mark ended nonterminal run spans continued, with accurate terminal/error/cancel and OTel status. Cost if wrong: telemetry vocabulary and consumer/status rework.

42. Store bounded framing fields in the existing per-run guard so a fresh instance can close open parts atomically. Cost if wrong: extra guard bytes and Lua/guard maintenance; fixed capacity is unchanged.

43. Test publication stalls through an owned connection proxy instead of shared-server CLIENT PAUSE. Cost if wrong: extra fixture work; no production or container-count change.

44. Keep full dollar reservations for unknown attempts with reported cost, reporting cost separately without double-counting admission. Cost if wrong: conservative early stops and accounting rework.

45. Copy the existing image manifest loader/declaration into the backend build stage only. Cost if wrong: build-context or compilation-boundary rework; runtime copies and shared pins stay unchanged.

46. Emit an explicit atomic terminal reset before finish after unconfirmed retry framing, rebuilding from the durable snapshot. Cost if wrong: a bounded extra event and terminal/replay contract rework; no new transport or capacity.

47. Emit bounded committed lifecycle/operation status and safe terminal-error notifications along with approval events. Cost if wrong: extra bounded events and committed-proof producer maintenance; no transport or capacity expansion.

48. Reject unsupported pool dimensions and validate effective declared/actual Valkey memory and headroom at boot. Cost if wrong: stricter configuration requires a reviewed revision for future tuning.

49. Align Compose and Testcontainers Valkey maxmemory to 768 MiB, with a 1 GiB Compose ceiling; validate declared versus actual finite memory and the fixed pool’s 30% allocation plus 20% headroom. Cost if wrong: the dev container ceiling rises by 896 MiB, and smaller setups need a reviewed sizing revision.

50. Use a monotonic local 250 ms publication budget and conservative Valkey-clock expiry, carrying the same budget through queued writes and retries. Cost if wrong: bounded clock-sampling I/O and budget-propagation maintenance; no new keys or capacity increase.

51. Expired public cancellation is a real, load-bearing residual. Advance the sequence atomically only when the expired current step was committed, preserving neutral pending cancellation and strict terminal proof; require actual stream closure and repeated-cancel coverage. Cost if wrong: A lifecycle transition/sequence correction and stream regression work are required; waiving it could strand active stream capacity.

52. The 33-event approval batch is a real, load-bearing producer mismatch. Handle every supported awaiting operation with bounded notification processing under the original deadline, schemas, ordering and stale-lineage checks; do not silently truncate or raise stream/queue caps. Correct the stale-version evidence to exercise an unexpired guard. Cost if wrong: Additional bounded serialization and guard tests are required; waiving it could suppress all approval notifications for valid work.

53. Stale transactional-tool commit telemetry is a real Minor residual. Keep it open for the focused follow-up and derive tool-path span status from the actual commit result. Cost if wrong: Telemetry consumer expectations and a deterministic stale-commit span test need adjustment; durable effect fencing already remains intact.

54. The timeout test settlement and terminal-member checks are real Minor residuals. Keep the connection usable, await released work deterministically and inspect the actual run-associated terminal member rather than a plain run ID. Cost if wrong: Test synchronization needs correction; accepting the current assertion would overstate no-late-write verification.

55. Name the profile field `maxToolProposalsPerGeneration` and use positive integers 1–15 with omitted values resolved to 8. Cost if wrong: a small contract/fixture revision if zero must later disable tools; capability filtering already controls availability.

Owner amendment (2026-11-09): the owner authorized one focused R1–R4 follow-up and one scoped re-review, with an explicit stop if an Important finding remains. The owner selected the profile cap (default 8, hard maximum 15) and safe pre-staging refusal for R2; this supersedes ruling 52’s earlier implementation preference. The historical decision remains above.
