# F4 acceptance evidence

Status: implementation in progress. Tasks 1–4 accepted after review;
Tasks 5–21 are pending. This is not F4 completion or visual approval.

Design and plan: [approved design](../superpowers/specs/2026-11-09-f4-chat-design.md),
[approved plan](../superpowers/plans/2026-11-09-f4-chat.md).
Branch: `f4-chat`. Draft [PR #29](https://github.com/pahle/lexon-ai-v6/pull/29).
No merge to main is authorized.

## Execution and owner gates

Implementation uses explicitly configured `gpt-6-luna`, reasoning `high`,
verified against the actual child turn context before implementation. Main
session accepts each task's spec compliance and code quality, with fresh scoped
review under Superpowers and a final whole-branch review still required.

STOP for owner feedback at Task 14 (thread preview), Task 15 (history/sidebar
preview), Task 17 (owner-run real smoke), and Task 19 (formal visual approval).
Normal Compose E2E remains on every PR push. Task 18 adds load dispatch and
relevant-change selection; final-head S2 evidence remains mandatory.

## Task 1 — approved pins and Caddy development/E2E routing

Source range: `e755c09..997a449`; initial implementation `5e97378`, port
compatibility correction `997a449`. Evidence below distinguishes the tested
revisions; the full Vitest run predates the focused port correction, whose
covering checks are recorded separately.

- Official Caddy and k6 exact images are in the shared manifest and loader,
  matching LEX-TS-001 v1.12. No UI dependency was installed or updated; k6 was
  not run.
- Caddy runs HTTP on host loopback, edge only, with no credentials or exposed
  admin endpoint. `infra/Caddyfile` forwards `/api/*` intact to the Backend API,
  other paths to Next.js, with immediate API flushing and 60-second upstream
  read timeout. Next.js no longer proxies API paths. SSR retains the internal
  Backend API URL.
- Browser/auth traffic and E2E descriptors use the Caddy public URL; direct API
  diagnostics stay on loopback. The actual pinned Caddyfile and running proxy
  were exercised, not only statically inspected.
- A held backend response emits frame A through Caddy while its release/end
  barrier remains closed. A new SSE request carrying `Last-Event-ID` and a
  synthetic cookie reaches the backend unchanged. Durable run replay and the
  client reconnect proof remain Tasks 8/10; this task proves proxy forwarding.
- Test-only probes are installed before Nest init by an explicitly passed
  bootstrap hook. The production API entrypoint does not pass it. F1 origin
  rejection and forged-forwarding-header protection remain covered.

Verification:

| Gate                                                  | Result / revision                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Clean baseline `pnpm test`                            | 895 tests / 148 files, exit 0, 129.38s at `e755c09`                                 |
| Implementer final `pnpm test` after bootstrap seam    | 896 tests / 148 files, exit 0, before port correction                               |
| Routing E2E through pinned Caddy                      | 3/3, repeated after port correction                                                 |
| Existing identity API/topology E2E                    | 6/6 at initial task source                                                          |
| Focused port-fix tooling                              | 11/11, including six routing tests                                                  |
| Controller full `node --test scripts/test/*.spec.mjs` | 133/133, exit 0, 743.71ms at `997a449`                                              |
| Omitted optional ports / actual Compose configuration | API 3001, frontend diagnostic 3002, public Caddy 3000                               |
| Typecheck, lint, format                               | Initial task gates passed; changed port scripts/Compose passed covering lint/format |

Existing local environments retaining `FRONTEND_HOST_PORT=3000` now receive an
explicit collision error recommending diagnostic port 3002. Caddy's public
port remains 3000; no local `.env` was read or rewritten by the fix.

TDD provenance: routing contract tests failed before implementation because
pins/loader/service/origin wiring were absent. The port regression had a focused
three-failure RED before its fix. The first behavioral E2E attempt failed from
registering test routes after Nest's not-found handler; that was a fixture
failure and is **not** historical behavioral RED evidence. No such evidence is
retroactively claimed. Actual barrier/header behavior subsequently passed.

Review: initial review found one Important default-port collision; fix round 1
addressed it, and scoped re-review found no new Critical/Important/Minor issues.
Main accepted the task after checking the source and covering evidence.
Retained nonblocking observations for final review: the small probe test assumes
its first read contains frame A (carry to actual stream parser work in Task 8),
and successful logs contain pre-existing Docker/color warnings. Output is not
described as pristine. Raw logs remain private because test infrastructure can
contain ephemeral credentials.

### Task 1 — Linux CI follow-up

Linux run [42621679384](https://github.com/pahle/lexon-ai-v6/actions/runs/42621679384)
at `81897c5` passed unit/integration but failed Compose E2E: the new port
validator rejected diagnostic port `0`, which the existing isolated Valkey
policy harness uses for Docker allocation. This was a regression, not a flaky
policy check.

Correction `e0f4f33` (based on `a67f603`) restores zero-valued API/frontend
diagnostic ports, excludes them from fixed-port collision checks, and
canonicalizes fixed numeric ports so `03000` cannot evade a collision with
`3000`. The public Caddy port remains nonzero. No local environment file was
read or changed.

- Genuine RED: two focused loader regressions failed before the fix.
- GREEN: focused loader 9/9; full Node tooling 136/136; real Compose topology
  and Caddy routing 7/7, including Valkey normal policy and wrong-policy
  rejection/recovery with both diagnostic ports set to zero.
- Covering ESLint, Prettier and diff checks passed. The existing color warning
  remains documented. No redundant full Vitest run was made for this JS-only
  correction.
- Main spec/quality checks and fresh scoped re-review accepted the fix with no
  new breakage. Linux CI evidence for the published correction is recorded below.

## Task 2 — shared chat and reasoning contracts

Source `a67f603`, review correction `2c8d68c`. Shared strict schemas cover
UTF-8 prompt limits, parent-linked full trees and viewed leaves (including root
edit siblings), effort, safe errors, mutation results, snapshots with replay
identity and nullable measured duration, search and feedback. V1 engine events
still decode; new V2 reasoning events exclude generic provider metadata.
Title/cleanup jobs carry IDs with required UUID tenant context; run-only
consumers explicitly narrow the expanded envelope union.

Review corrected two missing mutation contracts: creation now accepts the
first message plus client chat/message/request UUIDs; regeneration has its own
request UUID, reused on retries and refreshed on deliberate regeneration.
Root-edit regression was also caught and corrected before the initial review.

- Genuine RED covered byte limits (ASCII and emoji), strict-field refusal,
  tree/reference validation, V2 events and job envelopes. Initial missing-module
  fixture failures are excluded from RED evidence. Root siblings and both
  mutation corrections each had failing regressions before their fixes.
- Initial implementation: 52 contract tests, 255 backend unit tests and 13
  queue-routing integration tests passed; contract/backend typechecks and lint,
  formatting and diff checks passed.
- After the mutation fix: 53 contract tests and both package typechecks passed,
  with contract lint and changed-file formatting clean.
- Main spec/quality review and fresh task/scoped reviews accepted the source
  after both Important findings were addressed. A nonblocking cursor
  consistency observation remains for final review.

Contracts do not prove endpoint authorization, raw reasoning classification or
real snapshot/replay pairing; their later implementation tasks retain those
tests. `AI_OUTPUT_LIMIT` persistence needs a new migration in Task 4; applied
migrations were preserved. Shared chat audit types need backend/SQL integration
before Task 6 writes events. No UI packages or real model calls were added.

## Task 3 — durable per-attempt Usage ledger

Source range `192cfbb..b00ac9a`: initial `1677ecd`, reviewed corrections
`1822945`, `d0538ea`, `210fc3a` and `b00ac9a`. Migration
`0023_usage_events.sql` adds a content-free, tenant-FORCE-RLS ledger keyed by
attempt ID, with plain execution references and no foreign keys into deletable
records. Usage owns reservation, metadata, settlement and unknown recovery;
existing attempt accounting dual-writes in the same transactions. Admission
still uses live attempts; no customer quota or usage-view API was added.

Evidence covers equal duplicate settlement, conflicting terminal-result refusal,
unreserved-result refusal, deletion-surviving accounting and original-call late
enrichment, truthful nullable legacy effort, cross-tenant/no-context isolation,
finite nonnegative usage/cost, and rollback of both accounting writes. All three
repository recovery primitives return changed attempt IDs; coordinator and
public cancellation paths apply Usage updates inside the same transaction.

Review found late known usage could be dropped after a heartbeat abort. Executor
regressions now cover claim loss and cancellation when the result arrives after
abort, before an aborting iterator wait, and before a final abort guard. The
retained accounting reaches the confirmed-abort exit without granting content
or step authority. A further regression fixes cancellation between retries so
an already-settled attempt is not settled twice.

- Genuine RED was recorded for missing reservation storage, takeover recovery,
  public expired cancellation, six executor timing cases and retry cancellation.
  Retained logs corroborate the review corrections. One early RED shell exit
  status was not captured because of a reserved zsh variable; its actual Vitest
  failure output remains recorded, and no missing exit code is invented.
- Final relevant integration set: **169/169 tests, seven files** (Usage,
  attempts, concurrency, streams, cancellation, execution and worker crash).
- Backend typecheck, lint including **96 boundary checks**, changed-file
  formatting and diff checks passed. No full-root or Compose result is claimed
  for this source before the new-head CI run.
- Main spec/quality review and fresh scoped reviews closed all Important
  findings after four fix rounds. The final fix had no new breakage. Luna/high
  remained the implementation model, including the fresh fourth-round worker;
  a review-model quota failure was handled by another standard review model.

Privilege follow-up for the first Task 4 migration: the foundation's default
privileges grant runtime DELETE on new app tables. Migration 0023's narrower
explicit GRANT does not revoke that inherited permission. There is no Usage
DELETE API and no content-deletion implementation yet; no database DELETE-denial
claim is made for Task 3 alone. Task 4 now adds the privilege regression and
migration 0024; actual runtime DELETE/TRUNCATE denial is verified below. Applied
migrations remain unchanged.

## Task 4 — transactional start and resolved profiles

Source `ca381a5`, reviewed correction `12c9b76`. `startWithin` uses the caller's
live tenant transaction after verifying pool, tenant and actor identity; `start`
delegates through it. Rollback tests cover run, step, attempt, usage, outbox,
capacity-slot and audit counts. Bootstrap capacity configuration remains outside
the caller transaction.

The resolved effort, output/run limits and English `chat.instructions.v1` are
snapshotted per chat run and reach both the worker and usage descriptors. The
same assembler/estimator fits context oldest first and refuses an oversized
mandatory prompt. Legacy profiles retain omitted reasoning and their prior
ordering/iteration behavior.

| Effort | Input estimate ceiling | Output limit | Per-call reservation at ceiling | Two-attempt run budget |
| ------ | ---------------------: | -----------: | ------------------------------: | ---------------------: |
| High   |                163,840 |       16,384 |                         180,224 |                360,448 |
| Max    |                163,840 |       32,768 |                         196,608 |                393,216 |

These remain conservative admission values, **unverified by real smoke**.
The real two-reservation test retains the first unknown reservation, fits the
second exactly, and rejects a third. A separate actual start → snapshot → worker
→ mock gateway case verifies max/32,768. Adapter tests verify high/max effort,
fixed reviewed provider, ZDR, data-collection deny, no fallback and zero hidden
retries; legacy requests omit reasoning. No real model request was made.

The chat profile uses interactive priority 1, one iteration and no tools, with
131,072 history bytes under provider ID `chat-history`. Its real collector is
Task 6. Title uses none/512/16,384 on batch priority 5; the 4,096-byte source
bound remains Task 12. A length-limited reasoning profile now fails with
`AI_OUTPUT_LIMIT`, keeps partial text and schedules no continuation.

Migrations are append-only: 0024 revokes inherited ledger DELETE/TRUNCATE and
0025 admits `AI_OUTPUT_LIMIT` in run/audit checks. Real-role RED first showed a
ledger row being deleted; after 0024 both destructive operations are denied.
SQL and executor REDs separately showed the old code constraint and incorrect
iteration-limit classification before their corrections. The replacement audit
validator is the applied 0022 body plus the new safe-code enum entry; its strict
checks are retained.

Review corrected the resource-reference contract: up to 32 UUIDs, lowercase
normalization, caller order and a copied snapshot, with invalid/duplicate/
over-limit lists rejected without effects. These references grant no authority;
Task 5 implements immutable association, ownership and content fencing.

- Final corrected focused suites: **58/58**, retained private output. Backend
  typecheck, build, lint including **96 boundary checks**, formatting and diff
  checks passed.
- Executor/concurrency verification: **106/106** at the initial task source,
  including the accepted late-result/retry regressions. The later reference-only
  fix is covered by the focused run-start suites; no redundant executor rerun.
- Initial focused 56-test output was returned by the tool, without a separate
  file; no historical raw log is claimed. Import-only and missing-provider
  fixture failures are excluded from behavior RED evidence.
- Main spec/quality review and fresh task/scoped review accepted the source after
  the Important reference-input finding was corrected. Duplicate capacity
  configuration in the legacy wrapper remains a nonblocking final-review note.

## Published Linux CI

At `192cfbb`, [run 42627034811](https://github.com/pahle/lexon-ai-v6/actions/runs/42627034811)
completed successfully on attempt 2. Unit/integration passed on attempt 1;
Compose E2E passed on its rerun. The Valkey policy recovery test passed in Linux,
confirming the diagnostic-port correction.

The first Compose attempt passed 57/58 and failed an existing F2.1 capture:
`captureCheckpointCView` expected light but retained dark. It writes localStorage
and dispatches a single storage event while the provider's listener attaches in
an effect; an early event is a timing risk. The failure is retained as a capture
readiness follow-up for Task 16/final review. No approved image or product theme
behavior was changed, and a passing rerun alone does not prove the fixture is
reliable.

At `c975df9` (reviewed Task 3 publication),
[run 42739494062](https://github.com/pahle/lexon-ai-v6/actions/runs/42739494062)
passed unit/integration and Compose E2E on the first attempt. New Task 4
publication CI is pending; the earlier run is not evidence for later source.

## Pending evidence

The runtime/tree/replay proof, Usage ledger and deletion/capacity races, summary
filter/timing cases, chat UI, search and evals, owner-run high/max smoke and
calibration, S2 load, visual approval and Linux golden evidence remain pending.
No real model request, paid eval dispatch or account/admin change was made.
Production TLS/hardening stays F20; P8 physical-region verification and F17
unknown-attempt cost reconciliation remain explicit follow-ups.
