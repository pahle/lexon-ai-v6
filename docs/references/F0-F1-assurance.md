# F0 and F1 assurance pass

Date: 2026-11-01. Review baseline: `9bcd2c5`, branch
`f1-identity-organizations`, [PR 15](https://github.com/pahle/lexon-ai-v6/pull/15).
This pass supplements the original execution evidence; it does not rewrite the
historical test order or certify that every task followed the workflow exactly.

## Scope and method

Two independent read-only reviews assessed requirements and current source/test
assertions. One covered all 18 F0 tasks against the approved brief, plan and
architecture, distinguishing historical `4cd9545` from merged `bdaf404` and the
current branch. The other covered F1 Tasks 12–15, including later HTTP, privacy,
concurrency and security tests that exercise those requirements. Neither reviewer
modified the checkout or claimed to have executed tests. The executor reproduced
findings, implemented fixes and ran the checks recorded below.

## F0 independent review

No open Critical, Important or Minor F0 defect was established. The review found
requirements represented by the following implementation and behavioral tests:

| Tasks | Reviewed requirements and evidence                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–3   | Exact ESM toolchain/contracts; resolved import matrix, negative lint fixtures and sole public evaluation entry                                   |
| 4–5   | Runtime configuration and private logs; one Testcontainers setup, migrated template and file database/key/bucket isolation                       |
| 6     | Explicit tenant transactions, opaque sessions, populated fail-closed RLS tests, reused connections and runtime role restrictions                 |
| 7–8   | Atomic processed-job receipt/effect; concurrent transaction outcomes; actual worker SIGKILL before commit and after commit before acknowledgment |
| 9     | Dedicated advisory-lock session, claim leases, fencing and recovery                                                                              |
| 10    | SeaweedFS binary/range/delete/presigned upload, tampering and bounded safe probes                                                                |
| 11–12 | Atomic health files, readiness/liveness, stale/write/shutdown failures; separate runtime roots, validation, import tracing and evaluation boot   |
| 13–14 | Mock AI streaming/MCP exchange, empty reviewed region/ZDR allowlist; historical foundation UI and retained chat-package readiness                |
| 15–16 | Four runtime images, secret scope and topology; controlled document-worker egress denial, Valkey startup rejection and recovery                  |
| 17–18 | Explicitly bounded mutation baseline, CI package gates, both test layers and operational evidence                                                |

Two historical issues were already fixed before F0 merged and require no new
change: failed `ROLLBACK` destroys the client instead of returning it to the pool
(`tenant-database.ts`, `tenant-transaction-release.spec.ts`), and infrastructure
uses neutral job contracts instead of importing the platform domain. The
`infrastructure-domain` lint rule remains enforced.

Limits: this was a requirements/source/assertion review, not an exhaustive
line-by-line security certification or a fresh vendor-documentation audit. F1
identity behavior belongs to the separate review below. Frontend no-egress stays
the approved F20 gap; mutation scope remains the approved limitation. External
effects, receipt retention, production inference and later document/content flows
remain outside F0.

## F1 Tasks 12–15 findings and resolutions

### Invitation management permissions — Important, fixed

The approved design permits organization admins to list/resend/cancel pending
invitations, while only owners can create admin invitations. Resend and cancel
incorrectly reused the role-dependent creation permission. Three regression
cases reproduced 403 for admin resend, cancel and expired replacement of an
owner-created admin invitation.

Management now checks the existing invitation-management permission. Expired
resend uses a server-only expected-state replacement primitive that preserves
recipient, role, purpose and inviter, retires the old link, and creates one new
pending invitation in the same transaction. Domain policy stays in the
organization module. Audit and post-commit delivery retain their existing
transaction semantics. Creation of admin invitations still requires an owner.
Tests verify retained recipient/role, one pending record, obsolete-link denial,
recipient acceptance and the unchanged creation restriction.

### Own-session truncation — Important, fixed

Better Auth 1.7.14's installed adapter defaults unspecified `findMany` limits to 100. The safe session list supplied no limit or continuation, so live sessions
could disappear from the revocation UI. The regression created 101 real Bearer
sessions plus two cookie sessions and observed 100 results instead of 103.

The server primitive now traverses explicit 100-row pages using the unique ID as
cursor, then preserves newest-first display order and the safe projection.
Tests verify all 103 IDs remain discoverable, the current session is present,
and an early session can be revoked while the remaining 102 are still listed.
No tokens are added to the list contract.

### Additional coverage

Existing tests already cover identity-bound invitation retries, role floors,
accept/cancel/email races, transactional audit rollback, per-request membership,
last-owner constraints, Bearer channel isolation and immutable caps, provisioning
without staff membership, atomic first-owner activation, native endpoint denial,
and disabled-user session revocation. Later suites count as evidence even when
they were not written in the originally named task.

This pass adds direct assertions for remaining material scenario gaps:

- Actor demotion while a role-change command waits denies the command and leaves
  the target role unchanged (the existing remove race remains covered).
- Successful leave and a repeated leave produce one ID-only `leave` audit,
  retain Personal, and leave the actual outbox count unchanged.
- Every platform route rejects the original pre-enrollment cookie even after
  another session completes MFA enrollment.
- A real guarded HTTP request succeeds one millisecond before a Bearer deadline
  and fails at the deadline; the independent cookie session remains valid.

No new defect was exposed by these additional scenarios. The dedicated
unverified-recipient lifecycle matrix is not exhaustive; verified-account guards
and signup/verification suites provide broader evidence. Provisioning race tests
assert coherent organization/invitation/membership outcomes, but do not enumerate
every race's audit count. These are limits of coverage, not established failures.

## Workflow exceptions and historical artifacts

F1 Tasks 12–15 have real commits, pushes and behavioral tests, but their prescribed
upfront RED suite ordering was not fully followed. Task 12's completion helper
failed with a missing-file error; subsequent task briefs/completion bookkeeping
were maintained manually. The evidence does not establish why that helper became
unavailable. This pass provides new test-first regressions for the two defects;
it cannot retroactively turn earlier execution into strict TDD.

F0's local `.superpowers/sdd/2026-10-31-f0-foundation` directory is execution cache,
not the task inventory. Only two generated task briefs remain there, while its
progress ledger records all 18 approved tasks. Helper failure led to manual
tracking, and final cleanup was not recorded. The original missing independent
final-review evidence is supplied by this pass; the historical process omission
remains acknowledged. Durable task evidence is in `F0-S6-findings.md`, the approved
plan, commit history and this report. The diagnosis itself was read-only and did
not certify implementation correctness.

The latest baseline unit/integration CI job on `9bcd2c5` failed on a redundant blank line
in the F1 plan's final handoff section. Local Prettier reproduced that failure;
removing the blank line makes the check pass. Baseline Compose CI passed. Fresh
CI on the assurance commit must be assessed separately.

## Verification

Baseline before source fixes: `pnpm test` passed 328 tests in 89 files;
`pnpm test:e2e` passed 22 scenarios. Root lint, format after the whitespace fix,
typecheck and build passed, as did 89 tooling checks.

Focused fix verification: invitation lifecycle/concurrency/HTTP suites passed
14 tests; own-session/Bearer/HTTP suites passed 8 tests. The new membership,
departure and platform coverage passed 8 tests, and the HTTP deadline check
passed. Early test-harness mistakes (parameterized fixture invocation and using a
signup session without authentication evidence) were corrected before recording
valid RED results; they are not counted as bug reproductions.

The independent follow-up review inspected the fixes and added tests and found
no remaining concrete blocker in Tasks 12–15. It did not execute suites or judge
unrelated behavior.

The complete post-fix `pnpm test` run passed 334 tests in 89 files. Root lint
(78 boundary fixtures), typecheck and build passed. The corrected race-test
callback also passed its fresh four-test file run after typechecking caught a
return-type mismatch in that test. Identity mutation killed all 218 mutants
with no survivors, timeouts or uncovered mutants; its original three-policy-file
scope remains unchanged and does not cover the new adapter primitives.

The post-fix full Compose run passed all 22 scenarios and removed its owned
stack. Final document formatting and all 89 tooling checks passed. PR 15 remains
unmerged; no commit or push targets main. Remote CI on the assurance commit is
reported separately from these local results.
