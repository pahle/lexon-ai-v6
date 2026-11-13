# F4 acceptance evidence

Status: implementation in progress. Tasks 1–13 are accepted after review and
owner acceptance of the amended reference-runner search gate. Tasks 14–15 have
owner-accepted informal previews; Task 16 has passed controlled recovery and final task review. Tasks
16A–19 and 21 remain pending; Task 20 is deferred to F4.1. This is not F4 completion or visual approval.

Design and plan: [approved design](../superpowers/specs/2026-11-09-f4-chat-design.md),
[approved plan](../superpowers/plans/2026-11-09-f4-chat.md).
Branch: `f4-chat`. Draft [PR #29](https://github.com/pahle/lexon-ai-v6/pull/29).
No merge to main is authorized.

## Execution and owner gates

Implementation uses explicitly configured `gpt-6-luna`, reasoning `high`,
verified against the actual child turn context before implementation. Main
session accepts each task's spec compliance and code quality, with fresh scoped
review under Superpowers and a final whole-branch review still required.

Task 14 and Task 15 informal preview feedback was received. The 2026-11-13
standing instruction supersedes the Task 17 and Task 19 intermediate stops:
Task 17 local smoke is authorized within the limits below; Task 19 is self-reviewed
and delivered with the final ready PR. Stop for unresolved blocking issues and
final handoff. No Task 19 visual approval is inferred.
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

## Task 4 — CI registry guard correction

At `c134a7c`, [run 42746957654](https://github.com/pahle/lexon-ai-v6/actions/runs/42746957654)
passed Compose E2E but failed one of 943 unit/integration tests. The remaining
942 passed. The failing F3 test still expected an empty production profile
registry; F4 intentionally registers `chat` and `chat-title`.

Test-only correction `79f7c28` now requires exactly those literal profile IDs,
with contexts and tools still empty. It keeps the fixture-exclusion guard and
changes no production code. Focused tests passed 18/18, the full backend unit
suite passed 260/260 across 57 files, and typecheck, lint with 96 boundary
checks, formatting and diff checks passed. Main review and fresh scoped review
accepted the correction with no new breakage. New-head Linux CI is pending.

Task 5 initially paused before implementation when the required Luna/high model
hit its usage limit; execution resumed on that same model after quota refresh.
No implementation model or execution-mode fallback was made.

## Task 5 — private storage and database content fences

Source `0666a7d`, review fixes `b83d13a` and `398c7c3`. Append-only migrations
0026–0028 add owner-private chat/message/run associations, immutable links,
active-answer tracking, canonical run/checkpoint projection and database content
fences. New tenant tables FORCE RLS. Runtime DELETE/TRUNCATE on chat tables is
explicitly revoked; inherited default privileges are tested, not inferred from
the explicit GRANT statements. Existing headless engine behavior is preserved.

Main and scoped review found six Important defects in the first implementation:
owner privacy at the run-table boundary, deletable associations, duplicated
committed checkpoints, blocked deleted-chat cancellation, missing actual model
entry in the purported in-flight test, and removed legacy predicate tests.
Fixes restore the old tests, enforce association-aware run/content policies,
prevent binding tampering, project only the current active checkpoint, and
provide content-free cancellation with accounting and existing capacity release.
A second review caught a queued-run exception that treated hidden associations
as absent; migration 0028 closes that exception with a fixed-context,
content-free association predicate while preserving generic run references.

The deletion marker uses a narrow expected-state function because an ordinary
runtime UPDATE to a newly hidden row failed PostgreSQL RLS. Outbox insertion
uses the existing runtime repository in the same transaction. Two narrow
lifecycle primitives return sanitized facts and finalize an exact deleted-chat
cancellation state; they expose no prompt/output/config, require matching
transaction context and ownership, and deny PUBLIC/auth execution. Usage policy
stays in the caller transaction. Actual deletion API/audit/purge remain Task 11.

Evidence includes owner/peer/cross-tenant/no-context reads and direct writes,
real effective privileges, immutable references, real step commit/advance
projection, live/expired/repeated deleted cancellation, stale/context/grant
negatives, and claim/deletion/membership overlap with observed advisory-lock
waiters. A distinct test awaits model entry, calls real CancelService and
CancelSignals, marks deletion, releases the original response, and verifies one
known usage row, no content and no remaining run slot.

- Fix-round regressions failed before their corrections. Initial task TDD was
  incomplete: much fence code preceded its behavior tests. That historical
  process violation cannot be repaired by later GREEN and is recorded here.
- The initial claimed in-flight proof was incorrect: its synthetic 128-token
  budget failed admission before model entry. The corrected fixture uses 8,192
  tokens and an explicit model-start barrier; production budgets are unchanged.
  Earlier fixture timeouts and unknown terminal output are not counted as proof.
- Final round-1 checks: **121 tests / 11 integration files**, plus **105 tests /
  3 execution/accounting files**, restored predicate **5/5**, and workspace
  typecheck/build/lint (96 boundary checks)/format checks passed.
- Final queued-policy correction: **157 tests / 8 integration files**, plus
  workspace typecheck/build/lint/format and diff checks passed. Retained logs
  qualify revisions and fixture-only adjustments; no real model call occurred.
- Fresh task review and two scoped re-reviews closed all six Important findings;
  main accepted spec and quality after inspecting the critical SQL/repositories.
  The original TDD gap remains a process limitation. A PostgreSQL fixture
  concurrent-query deprecation warning remains a nonblocking tooling note.

`selectLeaf` currently checks chat membership of the message, not absence of
children. Task 9 must add that leaf invariant before exposing branch selection;
no current API claim is made for it. Task 7 must extend the content fences to
its new reasoning/checkpoint fields. New-head Linux CI is pending publication.

## Task 6 — atomic send and branch-bound history

Source `59cda14`, review correction `152d99a`. Create and send use the same
tenant transaction for chat/messages, engine admission, run, outbox, request
identity and ID-only audit events. Migration 0029 adds create-request identity
and extends the strict audit event validator. Concurrent identical requests
return the same result; changed payloads conflict, and deleted chats return the
same safe not-found response before retry payload comparison.

The production history provider follows the run's immutable parent path,
independent of the viewed branch. It includes only earlier terminal visible
answer text with status labels, excludes reasoning and in-flight snapshots,
and trims oldest whole messages using the shared serialized-input estimator.
An actual executor with the API's registered provider and recording gateway
covers exactly 131,072 history bytes and escape-heavy Unicode at the 163,840
input-estimate cap, with the current prompt included once. Full worker-process
and browser transport compatibility remain Task 10 evidence.

The first task review found blank prompts reaching a 500 response and missing
concurrent distinct-send evidence. Shared validation now rejects blank text
without normalizing valid whitespace or Unicode. Both HTTP routes return a
fixed 400 validation error. The distinct-send race returns one 201 and one 409,
with exactly one new run, answer association, start outbox, each expected audit
and capacity slot, plus two messages.

- Original focused checks: send 3/3, privacy 3/3, context 3/3, execution 83/83,
  fence 11/11, start/audit regressions 19/19, registry/composition 18/18, and
  backend build/typecheck/lint with 96 boundary checks passed.
- Review correction: contracts 54/54, send 4/4, privacy 3/3, contract/backend
  typecheck and lint, formatting and diff checks passed. Blank-schema and real
  HTTP 500 regressions failed before the correction. The distinct-send race
  passed existing production code; its early fixture failures are not product
  RED evidence.
- Initial route absence was observed before implementation, but atomicity,
  duplicate-send and context-stress tests were not all recorded before their
  production code. This is an incomplete historical TDD record, not a claim
  that later passing tests repair it.
- Before publication, the controller caught private test logs mistakenly
  staged in the first local source commit. The unpublished commit was amended
  to remove them from Git while preserving local evidence; no private SDD
  artifact is tracked or pushed.

Task 9 must bind send retries to the original answer before regeneration adds
siblings and validate leaf selection and the production tree response. The
fixture concurrent-query warning remains tracked for final verification.

The preceding Task 5 head `8404334` passed both Linux CI layers in
[run 42770261033](https://github.com/pahle/lexon-ai-v6/actions/runs/42770261033).
Fresh scoped re-review closed both Important findings; main accepted spec
compliance and quality. Published head `713a197` passed both Linux CI layers in
[run 42784976444](https://github.com/pahle/lexon-ai-v6/actions/runs/42784976444).
The first Compose attempt passed 57/58 tests and failed the legacy collapsed
sidebar keyboard-menu test; its snapshot showed the user menu open instead of
the organization menu. The unchanged-head rerun passed. This is recorded as a
non-reproduced focus/transition failure, not a proven root cause or a hidden
first-attempt pass; final UI verification must check it again.

## Task 7 — reasoning privacy and measured timing

Source `7472e75`, review correction `e72497b`. The bounded raw-fetch observer
projects the first provider choice and allowed usage/metadata fields before
provider parsing or SDK accumulation. Only explicitly typed summaries survive;
raw, encrypted, redacted, unknown and malformed reasoning content is discarded.
Frames are limited to 1 MiB and summaries to 16,384 UTF-8 bytes. Provider errors
are sanitized before SDK handling, while safe transport classification remains
available to the engine's retry policy.

Typed signals start a monotonic clock; first answer text ends it. Both boundaries
are captured before awaited delivery callbacks. An answer with no prior signal
closes timing, so a late signal cannot invent a duration. No-signal and
stopped-before-answer cases retain null. Retry and recovered-attempt resets use
the durable attempt ordinal. Summary/timing accompany text in checkpoints and
reload projections; migration 0030 extends deletion fences to the new fields.

Fresh review found three Important defects: passthrough usage fields reaching
SDK internals, answer-first timing becoming zero, and lease expiry allowing a
checkpoint to commit without its paired run fields. New failing tests preceded
the fixes. The observer now projects validated fields and follows only the
consumed first choice; checkpoint/run writes use a savepoint that rolls back
the pair on a failed second write. A controlled lease-expiry trigger proves the
rollback. Fresh scoped re-review and main review accepted spec and quality.

- Final checks: **35 gateway/privacy tests**, **3 reasoning integration tests**,
  **40 accounting/cancellation/stream-memory tests**, and the complete
  **84-test executor suite** passed. Workspace typecheck, lint with 96 boundary
  checks, formatting and diff checks passed. Earlier contracts passed 54/54
  and stream encoding 9/9; shared code was unchanged in the review fix.
- Real pinned provider with mocked HTTP → actual executor → Valkey events →
  PostgreSQL checkpoint/tree tests verify summary/timing equivalence, forbidden
  canaries, retry reset and deletion fences. No real-model request occurred.
- Initial fixture/schema failures are excluded from behavior RED evidence.
  One broad run was stopped prematurely and is indeterminate; an initial empty
  first-attempt checkpoint caused a timed-write failure cascade and was fixed.
  These runs are not counted as final passing gates.
- An earlier proposal-publication test observed 14/15 approvals. Idle paired
  baseline/current measurements both published all 31 events in 69.82/71.92 ms;
  this does not prove the failure pre-existing. The later full 84/84 gate passed.
  Task 8 must still force mid-batch publication unavailability and prove durable
  snapshot recovery. The 32-event bound and 250 ms deadline remain unchanged.

Published head `e823483` passed both Linux CI layers in
[run 42800100237](https://github.com/pahle/lexon-ai-v6/actions/runs/42800100237).
Real effort distributions and estimator calibration remain the owner-run Task 17
gate.

## Task 8 — authorized replay and bounded SSE fanout

Source `e4b8f33`; review fixes `7b5a0db`, `69b4f54`, `cd7f172`, and
`c038beb`. Main and fresh scoped reviews accepted spec compliance and quality
after closing six initial Important findings and subsequent recovery/accounting
regressions. Full initial diff coverage and each fix range were reviewed.

The Backend API authorizes an owner-private, tenant-scoped, live chat before
SSE headers, reader access or lease allocation. Request identity scope lasts
until socket closure; current session, selection, membership, organization MFA
and chat ownership are rechecked in short transactions. Disconnect does not
cancel a run. Admission is atomic across processes: the seventh socket revokes
the oldest of that user's six; owner tokens fence renewal/release. Shared
readers use one blocking and one replay connection, with serialized per-client
writes, actual UTF-8 frame accounting, a 64 KiB bound and a five-second drain.

Migration 0031 adds PostgreSQL-backed stream incarnations and exact successful
XADD checkpoint metadata. Allocation and snapshot generation are separate;
replacement cannot reuse a process-local counter. Cursor/checkpoint prefixes
carry attempt and revision, with nullable metadata before a real attempt.
Generation-stamped entries and bounded capture protect replay/live and stream
replacement races. Terminal expiry recovers from PostgreSQL without recreating
closed Valkey streams or weakening terminal proof/idempotency.

When a checkpoint cannot be paired with a retained stream cursor, recovery
sends authoritative replacement snapshots at the existing one-second checkpoint
cadence. It resumes incremental suffixes only after proving a compatible exact
cursor. Same-generation resets force this recovery; a terminal snapshot carries
text, measured reasoning, IDs-only operation states and finish before closure.
This degraded-path latency trades immediacy for coherent output. It does not
change the normal incremental path or F3's 32-event/250 ms publication bounds.
Shared strict snapshot frames split escaped JSON safely; pending states never
invent attempt IDs or generation values. Recovery traffic is bounded by
outstanding bytes, not cumulative drained traffic.

- The initial affected gate passed **138/138** before final import/callback
  cleanup, followed by focused replay/API/executor checks. Fix round 1 passed
  **143/143 across seven files** under Node 24.22.1. Later narrow fixes passed
  the full **17-test replay suite** and **3 API/cache/shutdown/executor cases**,
  plus backend typecheck, lint/boundary checks, formatting and diff checks.
  Contracts tests/typecheck/lint passed when their schema changed.
- Real Valkey barriers cover high-water response delay, replacement during
  reads, reset during drain, arrivals during suffix drain and cumulative
  traffic above 64 KiB with bounded outstanding backlog. Actual executor
  publication failure recovers all 15 committed operation states to an
  already-connected hub client without a tool effect. Checkpoint rollback and
  unavailable-publication tests keep durable cursors truthful.
- Actual HTTP tests cover no-allocation authentication/owner negatives,
  revocation, selection/membership/MFA changes, Bearer independence, peer and
  sequential reconnects, oldest-socket eviction and shutdown. A controlled
  Compose fixture through Caddy proves valid-cursor suffix-only replay and a
  later live frame before closure; fixture seeding is routing evidence,
  separate from executor publication evidence.
- Maximum snapshot measurement: 262,144 answer plus 16,384 summary characters,
  **33.96 ms**, **1 ms** observed event-loop lag, maximum encoded frame
  **24,159 bytes**. Earlier quadratic chunking measured 5,776 ms and was fixed.
- Some cursor/schema/hub drafts preceded dedicated behavior tests; full
  historical TDD is not claimed. Review fixes have retained failing/passing
  regressions. Interrupted/expired command sessions and fixture failures are
  excluded from passing gates. Shared test IP quotas caused signup 429s;
  scoped test overrides retain account caps and production rules.
- An earlier second-request Caddy closure remains unexplained. The stronger
  valid-cursor/live Caddy proof and separate two-request API reconnect pass;
  this does not establish the cause of the earlier observation. Initial host
  Node 26 warnings are qualified; final affected gates used pinned Node 24.

Published head `979cf2c` passed both Linux CI layers on the first attempt in
[run 42868874899](https://github.com/pahle/lexon-ai-v6/actions/runs/42868874899).
Client runtime/tree/replay compatibility remains the Task 10 proof; no product
chat screen or real model call was added.

## Task 9 — durable branches, selection and owner stop

Source `60ce0e9`, review correction `333030a`. Edit creates a sibling user and
its answer; regenerate creates an assistant sibling under the source user with
that user's effort. Existing history remains immutable. The chat lock and
transaction-aware engine start serialize mutations and preserve atomic
run/outbox/capacity changes. Viewed selection requires an actual leaf and chat
reads parse the shared tree schema. IDs-only immutable receipts in migration
0032 bind retries to their original result, including send retries after later
regeneration. Receipt keys survive content deletion; live-chat RLS hides deleted
lookups, and cross-chat identity reuse conflicts without restoring content.
Task 11 must retain these tombstones through physical cleanup.

The dedicated cancel route checks an owned live answer before calling F3's
cancellation policy. A real HTTP/worker test waits for model entry and streamed
partial output, observes AbortSignal, and proves busy state/capacity remain until
the worker commits cancellation. Partial output and one finish are retained;
repeated stop adds no finish. Try again regenerates the stopped MAX answer into
a new assistant under the same user, preserving effort and adding no user turn.

Initial review found four Important gaps. The fix narrows error translation to
expected message/receipt constraints; an injected unexpected late outbox
uniqueness error returns safe 500 with full rollback. A populated disposable
clone simulates the pre-0032 schema, reapplies checked-in SQL under the actual
migrator role, and verifies exact live/deleted receipt mappings. HTTP stop
negatives and rejected/colliding mutation snapshots now cover authorization and
no-effect guarantees. Fresh scoped review and main review accepted spec and
quality with no remaining blocking finding.

- Final focused checks: **7/7** branch, stop and migration tests, followed by a
  **1/1** upgrade rerun after a test-helper boundary correction. Existing
  cancellation, concurrency, send and privacy regressions passed **41/41**.
  Backend typecheck, lint with 96 boundary checks, formatting and diff checks
  passed. The helper adjustment did not change branch/stop production code.
- Receipt tests execute UPDATE/DELETE/TRUNCATE as the runtime role and receive
  permission denials; FORCE RLS and foreign-owner reads are checked. Stop
  negatives cover same-organization peer, foreign organization, deleted chat
  and revoked membership, with unchanged messages/run/outbox/capacity state.
- Initial REDs demonstrate missing edit/regenerate routes; detailed sibling
  and retry cases were later regressions, not all historical pre-code REDs.
  Unexpected uniqueness translation has an explicit failing/passing test;
  fixture setup failures are excluded. Large combined tests and expected
  runtime log noise remain final-review readability notes.

At published head `59c4967`, [CI run 42947627726](https://github.com/pahle/lexon-ai-v6/actions/runs/42947627726)
passed Compose E2E but failed two of 1,043 unit/integration tests. The new shared
mock had made legacy late-result tests cooperative, losing their known usage;
real streams also exposed a stale-start race before policy evaluation.

Correction `65418a9` restores noncooperative defaults with explicit stop-test
opt-in. The worker now authorizes before stream startup and rechecks typed
stale ownership: disappeared/revoked claims do no model work, while a valid
claim still throws for retry. Revoked terminal recovery retains its complete
snapshot framing. Gated real-stream regressions and the final six-file suite
passed **142/142**, plus quality checks; fresh scoped review accepted the fix.
No ownership/Lua proof was relaxed. A baseline pg concurrent-query warning
remains tracked. Published head `ebc6487` passed both Linux CI layers in
[run 42951005070](https://github.com/pahle/lexon-ai-v6/actions/runs/42951005070).

## Task 10 — persisted runtime and recovery proof

Accepted after spec and quality review of `f266b89`, followed by fixes
`531a78f` and `a8b684c`. The public `useChat` / `useAISDKRuntime` adapter
passed the early gate; no external-store fallback or internal runtime patch
is used. [Runtime proof](F4-runtime-proof.md) records the exact commands and
research.

The mock-model Caddy proof passed **3/3** scenarios, including live persisted
branch switching, root/nonroot edits, full selected-path equality after reload,
actual received cursor replay, XTRIM recovery, measured/no-signal reasoning,
and the visible Stop control's server cancellation. An independent tenant-scoped
PostgreSQL projection checks the tree and viewed leaf. Browser expiry was not
separately exercised; XTRIM is the browser fallback evidence.

Affected verification passed **32 frontend tests**, **31 backend SSE/replay
tests**, **99 lint/boundary checks**, both package typechecks, scoped formatting,
and worker syntax checks. The final storage-only fix received a scoped review;
the controller reran its exact two regressions successfully and verified the
source-diff hash against the commit. Linux CI on published head `876739f` passed unit/integration tests but
failed the three Compose runtime-proof cases in
[run 43013406306](https://github.com/pahle/lexon-ai-v6/actions/runs/43013406306).
The default all-project command had omitted the test-only overlay, although
focused proof commands loaded it. Reviewed runner fixes `563dae6` and `54e29f1`
resolve effective projects before Compose setup, including case-insensitive
selectors verified against the pinned Playwright CLI. The 17 focused runner
checks and scoped quality checks pass; published repair head `863b4c6` passed Compose on the first attempt and
unit/integration on a single failed-job rerun in
[run 43016292502](https://github.com/pahle/lexon-ai-v6/actions/runs/43016292502).
The first unit attempt passed 1,080 tests and failed the pre-existing F3
90 ms lease/backoff test with claim loss; that original result is retained,
with no test or engine change made for the rerun. Full-worktree lint during this follow-up was blocked by an
uncommitted Task 11 test import; that file is not in the repair commits.

Review corrections cover public Stop versus disconnect, serialized branch PUT
invocations and safe failure display, snapshot ordering/identity before cursor
acceptance, and denied storage getters/methods. Historical test chronology is
qualified in the proof; setup failures are not claimed as behavior REDs. Large
test files/duplicated diagnostics and exploratory test naming remain minor
items for the final branch review.

## Task 11 — permanent deletion

Task 11 is implemented through `b8b3636` and passed the task review and three
scoped fix reviews. [Deletion proof](F4-deletion-proof.md) records the tests,
research, timing, and qualifications. The deletion marker, ID-only audit, and
cleanup outbox commit together. Durable cleanup terminalizes runs through the
existing fenced release paths, retains content-free late usage, and prevents
content or stream resurrection. The default 30-second grace completed through
the dispatcher/queue/worker path in approximately 30.45 seconds, below the
60-second target while dependencies were available.

Review fixes cover production permit wiring, DELETE's cookie-origin guard,
remote SSE revocation, terminalization before purge, and default-grace timing.
One PostgreSQL LISTEN connection per API process receives UUID-only deletion
notifications committed with the marker; Valkey remains a duplicate signal.
Listener loss fails streams closed, registration races reject admission, and a
fresh database check protects a resumed backpressure drain. Notifications are
asynchronous: this is not a zero-delay distributed guarantee, and bytes already
handed to the socket before deletion cannot be recalled. No bound for an
undetected notification-network stall is claimed.

The main session's final selected integration run passed 5/5 across four files;
backend typecheck also passed. The implementation's final lint passed all 99
boundary checks, with format and diff checks passing. Earlier broader results
and subsequent targeted corrections are preserved in the proof rather than
reported as a new full-suite pass. Cleanup restart tests use fresh worker
objects and injected faults; title coverage currently uses an associated
synthetic title run. Task 12 adds the real title producer and its deletion race.
Search and feedback deletion predicates remain requirements for Task 13.

Linux CI on `228aa02` failed before Compose E2E because Chromium dependency
installation could not resolve the Ubuntu mirror. Unit/integration passed
1,101 tests and failed one SSE fixture signup. Reviewed test-only repair
`c99658c` consistently configures the file's bounded auth fixture allowance;
production auth and SSE limits are unchanged. The baseline full file reproduced
14/15; the main session independently verified the repaired file at 15/15.
The exact failed signup HTTP status was not captured; shared limiter exhaustion
is the diagnosis from configuration and reproduction, not a recorded response.
Privacy lease assertions now check all participating users. Unrelated users'
registry keys observed in the intermediate run have not had their origin or
release lifetime established; final branch review must triage that observation.
This repair is not global registry-cleanup clearance or a new CI pass.

## Task 12 — durable titles and owner invalidation

Task 12 is implemented through `dfb6c7e` with a fresh task review and two
scoped fix reviews. [Title proof](F4-title-proof.md) records the exact evidence.
Answer completion schedules one stable title task transactionally; title-run
creation shares the job receipt transaction and retries capacity refusal.
Version/source checks preserve renames, deletion fences late writes, and invalid
Unicode quotation or trailing punctuation retains the excerpt without a repair
call. Failed and cancelled answers remain eligible for a later successful
answer; an injected outbox failure verifies completion rollback.

An authenticated owner-scoped invalidation stream shares the existing API
PostgreSQL listener and per-user connection budget. Its pending IDs are bounded
and coalesced. A tested frontend helper invalidates tenant/organization/user
query keys and recovers missed events after reconnect. Tasks 14–15 must adopt
and dispose this helper with the active verified identity; screen wiring is
not claimed here. The main session independently verified the final integration
pair at **16/16** and frontend helper at **6/6**. Reported affected unit tests,
contracts, both typechecks and lint, formatting and diff checks passed.
No full queue-consumer E2E or real-model title quality is claimed.

Published predecessor `22c8ce0` passed Linux unit/integration on the first
attempt and Compose on a failed-job rerun after the Ubuntu dependency mirror
DNS failure in [run 43060376679](https://github.com/pahle/lexon-ai-v6/actions/runs/43060376679).
The initial Task 12 head `532c943` subsequently failed
[run 43081756738](https://github.com/pahle/lexon-ai-v6/actions/runs/43081756738):
1,127 integration/unit tests passed and two runtime-composition checks failed
because the worker could not resolve `RunService` for `ChatTitleService`.
Compose also stopped at AI-worker startup. Reviewed repair `0d6682d` registers
the shared existing provider in the worker; the main session independently
verified runtime composition at 5/5. On repaired predecessor `80ceab6`, Compose passed and unit/integration tests
passed in [run 43085059735](https://github.com/pahle/lexon-ai-v6/actions/runs/43085059735),
but the later tooling step failed the obsolete F2 no-chat source guard.
Reviewed follow-up through `ed67cc6` allows only the approved notification
helper's exact quoted `/api/chats/events` path. Counterexamples retain legacy
chat, unapproved plural/suffix paths, mixed same-line requests, and theme-call
rejection. The main session verified the focused Node suite at 4/4; the new
published head still needs CI.

During Task 13 isolation, an agent cleanup command removed the ignored F4
workflow directory. Published code, public proofs, plans, and source stashes
were unaffected. The controller reconstructed the progress ledger from commits
and retained session records; lost private logs are not claimed as recovered
originals. Completed tasks were not repeated.

## Task 13 — private history, search and feedback

**Accepted by the owner (2026-11-12).** The gate is now p95 under 500 ms per
class on GitHub-hosted ubuntu-24.04 4-vCPU reference hardware. Existing isolated
Linux run [43175713326](https://github.com/pahle/lexon-ai-v6/actions/runs/43175713326)
at `86ddad8` satisfies it: stem 405.30 ms, partial 401.93 ms, article
407.02 ms, no-match 227.88 ms, 30 HTTP 200 samples per class. No rerun is made
now. Historical artifacts preserve the original 300 ms failure; the final-head
isolated run remains mandatory with the amended 500 ms threshold.

The 300 ms value was an initial owner target, not a measured product
requirement. The owner attributes the identical-code/plan gap to the reference
runner's slower single-thread CPU; this is owner-accepted rationale rather than
a controlled CPU experiment. The fixture represents an extreme long-term heavy
user. Local Apple-silicon results below are informative only. Query, RLS,
timeout, fixture, samples and plan assertions stay unchanged; no further F4
search optimization is authorized. F20 owns production PostgreSQL tuning
(shared_buffers remains default 128 MB); F8 / spike S3 owns indexed document-
scale FTS/trigram under RLS.

The [diagnostic](F4-search-query-plan-gap.md) compares both runs and records
actual Linux hardware/settings, four owner-first RLS plans and all timings in
[durable Linux evidence](F4-search-linux-gate-2026-11-12.jsonl). The earlier
startup-only attempt is retained separately and has no latency samples.
Chats search UI is Task 15 and is not implemented yet: submit-triggered
requests, visible loading and tested stale-response suppression are explicit
acceptance requirements before that task can close. Task 14 resumes first.

The owner-approved RLS and stored-vector amendments are implemented. Search
uses generated English vectors derived from user text and canonical run output,
safe final-token FTS prefixes for bodies, ordinary numeric tokens, and title-only
trigram matching. Matching messages take precedence over title-only hits; the
page is selected before bounded plain-text snippets are computed. A statement
timeout returns HTTP 503 with “Search took too long. Try more specific words.”
History, search, target resolution and feedback enforce owner and deletion
predicates. Feedback changes remain tenant-scoped and audited.

The [search diagnostic](F4-search-query-plan-gap.md) retains the initial failed
gate and subsequent corrections. The final measurement producer is
`2bf4281fa7e6d783c90e59d5242445fa238f42b1`. The committed
[153-record evidence](F4-search-final-gate-2026-11-12.jsonl) has SHA-256
`0bfb1da386b700c0137c8113e6821fd447913090bd8e220026026aba4dc86e6c`.
It preserves complete nested plans, settings, eight source hashes, migration
cost, vector sizes, 20 warmups and all 120 measured HTTP 200 requests. Each
class has 30 sequential warm samples:

| Query class             | p50 ms | p95 ms | max ms |
| ----------------------- | -----: | -----: | -----: |
| Stemmed word            | 256.28 | 273.00 | 278.32 |
| Partial term            | 232.36 | 259.52 | 277.54 |
| Article number (`1320`) | 235.36 | 251.33 | 254.98 |
| No match                | 169.62 | 188.87 | 194.31 |

All four local p95 values satisfied the then-current <300 ms target with 2,000 owner chats,
50,000 owner messages including long answers, and 1,000,002 other-owner messages.
The benchmark ran on an Apple M4 / 16 GiB host and Docker Desktop Linux arm64
VM with 10 CPUs / 8,217,059,328 bytes, PostgreSQL 17.11. Plans start from the
owner-scoped B-tree under enabled, forced RLS; none sequentially scans whole
chat/message/run tables. No unused GIN indexes, RLS bypass, LEAKPROOF change,
SECURITY DEFINER search wrapper, planner override or timeout increase was added.

Review corrections cover body-hit navigation despite title matches, final-token
prefixes including trailing punctuation, stem-aware bounded snippets, complete
plan/source evidence, ties, inactive branches, stale/deleted targets and query
privacy. Controller verification independently checks the artifact/source
hashes and focused tests; it is not a second benchmark run. Generic logging
and OpenTelemetry filters have query-canary coverage. No Sentry SDK or sink
exists in either package, so no Sentry integration test is claimed.

The fixture repeats synthetic terms and is compressible; these timings and
storage sizes do not generalize to arbitrary corpora. F8 and spike S3 must
separately solve document-scale indexed FTS/trigram under RLS. Run search vectors
follow the canonical final/partial columns, not in-flight step checkpoints.

## Pending evidence

Chat UI and evals, owner-run high/max smoke and
calibration, S2 load, visual approval and Linux golden evidence remain pending.
No real model request, paid eval dispatch or account/admin change was made.
Production TLS/hardening stays F20; P8 physical-region verification and F17
unknown-attempt cost reconciliation remain explicit follow-ups.

## Task 14 — thread preview ready for owner feedback

Source `e2442d7` implements the thread; review corrections `7707b45` address
identity-scope reset, public inline editing and assistant branch selection,
live/reloaded cancellation and failure, persisted feedback, UTF-8 validation,
focus and safe Markdown. A chat-only bounded viewport fixes runaway height
observed with the top-anchor layout; held-run geometry and a normal pointer
Stop are covered. Stop awaits the backend and then uses the public runtime
cancellation action. Task 15 navigation/history is not included.

The main session independently ran the Compose/Caddy preview flow at
`7707b45`: 1/1 passed (8.2 seconds), and visually compared the new-chat,
completed light/dark desktop/mobile and expanded-reasoning states with
`prototype/01-new-chat.png`, `05-reasoning-open.png`, `06-answer-complete.png`
and `21-answer-dark.png`. The retained [informal preview](F4-visual/task-14/README.md)
contains ten stable PNGs and hashes. Generic Home/Chat breadcrumbs and the old
sidebar remain pending Task 15. Fixture-control markers are synthetic prompt
data. These images are not Task 19 formal approval.

Browser verification is qualified: a combined run passed three of four
scenarios; the remaining edit/branch/UTF-8-boundary scenario passed on a focused
final-source rerun (1/1, 13.6 seconds). No all-four final-source pass is claimed.
The main preview recapture separately passed. Actual copy interaction, visible
reconnect interaction and no-signal live/reload parity are not browser-verified;
lower-layer runtime/transport and static reasoning tests provide the recorded
coverage. Scoped reviews found announcement truncation/reset edge cases;
announcement-only follow-ups `a712334` and `846cd65` passed scoped spec and
quality re-review. Final verification reports 249 frontend tests, both package
typechecks, lint and formatting passing. They do not change the captured layout.
Task 14 is ready for informal owner feedback; Task 15 remains gated.

## Informal Task 14 owner feedback (2026-11-12)

The owner compared prototype 01, 03, 05, 06 and 21 and accepts the overall
layout, action bar, reasoning summary block, disclaimer, dark mode and mobile.
Task 15 may start, subject to the separate current search CI gate stop below.
This is informal checkpoint feedback, not Task 19 formal approval.

Before or alongside Task 15, implement with regression tests:

1. Until first answer text exists, show “Thinking…” even if a reasoning-end
   signal has arrived. Show “Thought for N seconds” only after answer text
   starts, consistently live/reloaded. Test reasoning ended with no answer yet.
2. Disable Send for empty and whitespace-only text in both new-chat and thread
   composers. Test both paths and the transition back to nonempty input.
3. Remove the new-chat textarea native resize grip; grow automatically.
4. Use a round Stop button with a square icon in the Send position, accessible
   name “Stop generating”. Preserve the real pointer cancellation regression.
5. While answering, use composer placeholder “Lexon is answering…”.
6. Answer Markdown headings use body sans semibold. Georgia remains for page
   headlines such as the welcome greeting.

Task 19 screenshots must show realistic synthetic names, plausible legal
questions and answers, and no visible test-control markers. Keep control data
out of user-visible text rather than hiding it only in screenshots.

### New head CI gate stop

Automatic isolated search run `43232959421` at `8fe012d` missed the amended
500 ms gate: stem p95 530.60 ms, partial 536.09 ms; article 385.63 ms and
no-match 220.65 ms passed. All 120 requests succeeded; complete evidence and
plans are in the [diagnostic](F4-search-query-plan-gap.md). This was discovered
while processing the owner feedback above. No optimization or retry followed.
Task 15 is held under the previously agreed stop-on-miss rule pending direction.
The six UI corrections are recorded but not yet implemented.

## Owner amendment — blocking gate and non-blocking target (2026-11-12)

This amendment supersedes the earlier absolute 300/500 ms stop gates. Shared
GitHub-hosted ubuntu-24.04 4-vCPU runner timings vary; the owner treats the
observed variation on unchanged search code/plans as shared-runner variance,
not evidence of a code regression. Stem p95 moved from 405.30 to 530.60 ms on
the same reported CPU model, and the later run's stem/article p50 differed
(520.43/365.85 ms). No controlled experiment isolated a cause. The 22-source
manifests were verified against each run's producer; the search query/service,
fixture and migrations are unchanged, while evidence/UI dependencies may differ.
The fixture represents an extreme long-term heavy user. No further F4 search
optimization is authorized.

**Blocking:** owner-first plans, enabled and FORCE RLS, no whole-table sequential
scans on chats/messages/runs; all **120 measured requests succeed** (30 per
class), no timeout or 5xx; strict **p95 under 1,000 ms in every class**. Missing
or incomplete measurements fail. This bound catches material regressions such
as the earlier approximately eight-second per-row vector query.

**Non-blocking target:** strict **p95 under 500 ms per class** on the 4-vCPU
reference runner. A miss produces a warning in JSONL evidence, the per-class
log summary and GitHub job summary; it never fails the job or triggers a stop.
The stop-on-miss rule now applies only to blocking failures. Preserve every
run's measurements, runner/container metadata, complete plans and always-upload
artifacts, with the numeric policy recorded for trend comparisons.

| Run           | Blocking gate under new policy                                                  | 500 ms target          |
| ------------- | ------------------------------------------------------------------------------- | ---------------------- |
| `43175713326` | PASS (all120 success; plans/RLS pass; p95 405.30 / 401.93 / 407.02 / 227.88 ms) | All classes pass       |
| `43232959421` | PASS (all120 success; plans/RLS pass; p95 530.60 / 536.09 / 385.63 / 220.65 ms) | WARN: stem and partial |

These are owner-accepted assessments under the new policy, not rewrites of the
historical job conclusions or JSONL artifacts. Do not rerun these jobs. The
performance trend remains open for review, but it no longer blocks the six
Task 14 corrections or Task 15. The **final-head isolated run remains mandatory**;
the owner will review its numbers against the 500 ms target before merge.
F20 owns production PostgreSQL tuning (shared_buffers remains default128MB);
F8 and spike S3 own document-scale indexed FTS/trigram under RLS.

## Task 15 — implementation review in progress

The initial implementation is committed locally as `a64b139`; it is not accepted
or pushed yet. The main session independently ran
`pnpm test:e2e --project chat-browser --grep 'Chats history|new chat accepts a prompt'`
at that source: **2/2 passed (9.9 seconds)**. This also rendered the six Task 14
corrections. It does not establish that Linux CI or all Task 15 requirements pass.

The fresh task review found four implementation defects: mobile Recent/View all
navigation leaves the sheet open; an open thread's title is not subscribed to
invalidation; row-owned delete refusal loses its actionable confirmation; and
whole-scope delete rollback can undo another concurrent mutation. They remain
in the fix cycle. Menu screenshot settling, accurate API length-boundary
coverage, and actual inactive-branch search target/highlight evidence also need
verification before the preview gate. The previous F2.1 Home golden remains
unchanged; its reconciliation belongs to the Task 19/20 approval process.

**Tests-first process exception, pending owner disposition:** several Task 15
history, controller/client, and cross-surface cache changes preceded their
behavior tests. Some visual assertions were written before source changes but
first executed afterward. Later passing tests provide regression coverage;
they cannot establish a historical RED-first sequence. This conflicts with
`AGENTS.md`: “TDD: no production code without a failing test first.” The
implementation report retains the actual chronology. Corrective production
changes require an observed failing regression before the fix. No claim of
full TDD compliance is made, and the exception requires owner disposition at
the Task 15 feedback gate before Task 16.

Inherited Docker `InvalidDefaultArgInFrom` and conflicting color-environment
warnings are tracked for final review; the validation log is not warning-free.
No real model, paid evaluation, account-setting change, or `.env` access was
part of this task. The informal Task 15 preview does not replace Task 19's
formal visual approval.

## Owner amendment — Task 20 deferred to F4.1 (2026-11-13)

The owner will introduce a brand refresh slice, F4.1, which replaces the visual
design. Task 20 (locking Linux CI golden baselines) moves out of F4 into F4.1
to avoid locking baselines twice. It is deferred, not completed.

Task 19 stays in F4: produce the full visual review set and obtain explicit
owner approval of layout, content, navigation, and states. Task 15 and its
feedback gate are unchanged. Existing F2.1 baselines, plus functional,
accessibility, and E2E tests, must still pass. This amendment does not authorize
skipping, weakening, replacing, or redirecting existing comparisons. The known
F2.1 Home comparison mismatch remains an unresolved F4 verification issue;
deferring new goldens does not make that failure pass.

## Task 15 — reviewed implementation and informal owner gate

Source range `fb30328..8047ff7` includes initial implementation and three
review corrections (`164ccca`, `4911883`, `8047ff7`). Fresh scoped re-reviews
closed the implementation findings; the historical tests-first exception above
remains open for owner disposition. Task 15 is ready for informal feedback,
not marked fully accepted or complete. Task 16 has not started.

The main session independently rendered through Compose/Caddy and visually
compared the affected states with prototype screens 14–20 and 23. The
[ten-image Task 15 preview](F4-visual/task-15/README.md) records exact producer,
hashes, named comparison references, differences and fixture limitations.
The corrected [Task 14 preview](F4-visual/task-14/README.md) is refreshed
separately at its recorded producer; its six owner corrections are retained.
These informal sets do not replace Task 19 formal approval.

Observed main-session browser results:

- `164ccca`: full `pnpm test:e2e --project chat-browser`, **6/6 passed
  (38.9 seconds)**, covering history, branch targeting, new chat, edit/regenerate,
  measured private reasoning, and failed/stopped answers.
- `4911883`: affected history/new-chat/inactive-branch flows, **3/3 passed
  (17.1 seconds)**.
- `8047ff7`: final history/rename preview flow, **1/1 passed (7.7 seconds)**.

These are separate source-specific results, not a claim of a final-head full
suite pass. Implementer evidence includes the eight-file workspace/tenant/chat
regression set (91 tests), round-two history/thread tests (34), final history
tests (20), frontend types/lint/format checks, and the real Testcontainers
rename integration check. The backend boundary assertion now supplies JSON
content type, accepts 120 characters, rejects 121 and verifies the title is
unchanged after refusal.

Review corrections cover mobile sheet close/focus, mounted-title event refresh,
immediate Recent after creation, row-owned/last-row deletion refusal and retry,
concurrent mutation-safe rollback, late initial-title response fencing, and
inline Recent rename replacing its linked label. Search has explicit submit,
loading, pagination and stale result/error suppression. The rendered
inactive-branch/highlight proof uses browser-route fixtures, so it establishes
client behavior; do not describe it as independent real-database persistence
evidence.

Linux CI on the pushed preview head remains a separate verification step.
The previously observed F3 lease-renewal test failure and unchanged F2.1 Home
golden mismatch remain recorded issues until current-head evidence or a
reviewed correction resolves them. Task 20's deferral does not waive either
existing test coverage or baseline checks. No real-model smoke, paid eval or
final-head isolated load/search evidence is claimed here.

## Task 15 owner acceptance and compensating evidence requirement (2026-11-13)

The owner accepts Task 15's informal structure and states: Chats, highlighted
search, no results, empty history, Recent menu, inline rename, delete
confirmation, and dark theme. Visual polish is out of scope because F4.1 will
rebuild the visual design. This is checkpoint feedback, not Task 19 formal
approval. Task 16 may proceed.

Carry into Task 19: a **solid destructive** Delete chat confirmation button
matching prototype 16; empty-state copy **“Start a new chat to ask Lexon about
a contract, a regulation, or a case.”**; realistic synthetic screenshot content
in place of all diagnostic titles, generated emails and “Scripted answer”.

The owner accepts the historical tests-first exception as a recorded deviation.
Retain the original chronology in this file; do not rewrite it as compliance.
Acceptance is conditional on compensating evidence before Task 21 handoff:

- Targeted backend Stryker run following F1's dedicated config precedent,
  installed core/runner 10.1.1 and **break 80**. Record exact files, per-module
  scores, counts, command, producer and report artifacts. Initial inventory
  locations are `backend/src/modules/chat/chat-search.service.ts` (cursor and
  snippet functions), `backend/src/modules/chat/chat-history-context.ts`
  (context selection), `backend/src/infrastructure/db/ai-chat-resource.repository.ts`
  (resource/deletion-fence policy) and
  `backend/src/infrastructure/queue/stream-hub.ts` (SSE replay/cursor decisions).
  This is a planned scope inventory, **not mutation evidence or a completed
  run**. Record exact final mutated files if pure logic needs extraction,
  preserving real production call paths. SQL/RLS fences require integration
  proof as well; a pure-logic score does not establish database enforcement.
  Any scoped module below 80 requires missing behavior tests, observed RED
  against broken behavior, and a rerun. No lowered threshold or mutant exclusion
  without a written reason the owner can review.
- Task 15 frontend history/cache and controller changes require a rule-by-rule
  behavior-test inventory. Fill missing cases and deliberately break each rule
  reversibly; record the mutation, covering command, assertion failure output
  and exit status, then restore source and verify GREEN. Frontend Stryker is
  not configured. Compilation/setup errors are not qualifying failures.
- From Task 16 onward, every report includes actual failing-test output before
  the implementation commit. Tests-after is a blocker that stops the task,
  not another accepted note. Main checks the RED evidence before authorizing
  production edits.

Task 16A in the plan owns the compensating evidence. It is pending and blocks
Task 21 handoff; no score or historical compliance is claimed here.

CI on `dd31b54`: [isolated search](https://github.com/pahle/lexon-ai-v6/actions/runs/43354598506)
passed; [normal CI](https://github.com/pahle/lexon-ai-v6/actions/runs/43354604099)
failed. Unit/integration reported 1208 passing and three sidebar failures
(stale Home/navigation/empty-text expectations). Compose reported five failures:
app-shell request ordering/count, organization membership fallback evidence,
platform user-menu screenshot, stale Home breadcrumb, and stale Home capture
helper. The existing visual baselines remain required and unchanged. These
failures require diagnosis; owner acceptance of the preview does not assert
that CI passes.

The Task 15 isolated search artifact is retained as
[F4-search-task15-head-2026-11-13.jsonl](F4-search-task15-head-2026-11-13.jsonl):
p95 stem/partial/article/no-match **374.70 / 363.34 / 289.49 / 165.13 ms**,
120/120 measured HTTP successes, owner-first plans and FORCE RLS verified.
All classes pass both the blocking 1,000 ms gate and non-blocking 500 ms target.
The controller verified the producer's 22 hashes and recomputed p95. Runner and
full trend context are in the [search diagnostic](F4-search-query-plan-gap.md#task-15-pushed-head-trend--2026-11-13).
No retry or further search optimization was run. Final-head isolated evidence
remains pending.

## Task 16 — stopped by strict tests-first gate (2026-11-13)

The first tests-only checkpoint observed a missing `report.cases` failure, with
34 existing eval tests passing. After review, the backend's existing context
integration test was extended to inspect the actual gateway's versioned chat
instructions and untrusted-context wrapper; that regression passed (3 tests).
The controller authorized only the typed deterministic scenario/report slice.

During that slice, production changes introduced linked-tree traversal,
cycle/missing-parent validation, scenario validation, and actual prompt/output
scoring. The eval test was also rewritten to the new typed scenario/tree
interface. The implementer confirmed those additional rules had **no observed
pre-implementation failing output**. The original missing-report-field RED does
not establish RED-first evidence for them. A post-edit eval run was interrupted
when the controller froze the work; it is not a passing or qualifying RED result.

Per the owner's Task 16 onward rule, this is a **blocker that stops Task 16**,
not another accepted provenance note. The uncommitted production/test slice is
preserved for review and has not been committed or pushed. No retrospective
RED claim is made. No Task 16A implementation, Task 17 smoke, or later task has
started. Resumption requires an owner decision; the earlier Task 15 exception
is not treated as authorization for this violation.

Frozen source paths: `backend/src/evaluation/evaluation-contracts.ts`,
`backend/src/evaluation/evaluation-harness.ts`, `backend/src/evaluation/index.ts`,
`backend/src/evaluation/chat-scenarios.ts`; test paths:
`backend/test/integration/chat-context.spec.ts` and `evals/test/f4-chat.spec.ts`.
The ignored Task 16 report/log and frozen diff retain the exact chronology.

## Owner-authorized Task 16 recovery — structural controls (2026-11-13)

This is the **second consecutive tests-after violation**, following Task 15.
The instruction-only RED checkpoint did not prevent implementation of untested
additional rules. The owner authorized a clean recovery, not another exception.

The frozen work is archived outside product sources in ignored workflow records:
`.superpowers/sdd/2026-11-09-f4-chat/audit/task-16-frozen-2026-11-13/`.
`manifest.json` records the base commit, six file paths and SHA-256 hashes;
`tracked.patch` SHA-256 is
`ee17bd7ae670d3579f2342361ed526427af51744c15dff788ea1d6679e8b4cd2`.
The archive also preserves exact file snapshots and the original report/RED log.
It is an audit record, not input to the fresh agent. The fresh agent receives no
archived code/report and may not copy code from it.

Only the six uncommitted Task 16 source/test paths listed in the preceding
section were discarded. Tracked files were restored from HEAD, untracked Task 16
files removed after hash-verified archival. The committed HEAD remained
`9561feb`; the worktree was clean immediately after recovery. Earlier committed
work was not changed. This preserves the violation's history rather than
rewriting it.

Recovered Task 16 and every remaining production change in Tasks 17–21 use
per-rule **Phase A / controller RED / Phase B / controller GREEN** gates, also
applied to Task 16A's compensating evidence work:

- Phase A permits only that rule's tests. The controller checks all changed
  and untracked paths and verifies production hashes did not change. The agent
  stops; it does not implement or advance to another rule.
- The controller runs the test itself, records command/output/exit and hashes,
  and requires an expected behavioral assertion failure. Setup/import/typing
  errors do not count. Already-passing behavior is regression coverage and
  authorizes no production change.
- Phase B permits only the minimal implementation for the verified rule within
  explicit paths. Each additional rule needs a separate Phase A/RED gate.
- The controller inspects the implementation diff, reruns the test itself and
  records GREEN before the next rule. Any production change without its recorded
  controller-observed RED is reverted, retaining an audit record.

This replaces the failed instruction-only control. Task reports reference the
controller's immutable per-rule evidence logs and phase manifest. Agent-reported
RED/GREEN does not satisfy the gate. Required task reviews and owner smoke/visual
checkpoints remain. No Task 16 recovery implementation or passing mutation score
is claimed by this control description.

### Recovery rule 01 — controller-observed cycle

Rule: public deterministic evaluation reports expose an empty `cases` array
when there are no chat-specific case scores. Phase A was limited to
`evals/test/f4-chat-recovery.spec.ts` and the existing safe-report assertions in
`evals/test/f3-engine.spec.ts`. The controller compared the full 1,602-file
tracked/nonignored hash inventory and verified that only these tests changed.

The controller ran:

```text
pnpm exec vitest run --project evals evals/test/f3-engine.spec.ts evals/test/f4-chat-recovery.spec.ts -t 'defaults deterministic evaluation cases|exposes deterministic durable engine controls'
```

RED: exit 1, two behavioral assertion failures—missing `cases` report key and
`expected undefined to deeply equal []`. No setup/import/typing failure counted.
Only then was Phase B authorized for the three existing evaluation
contract/harness/public-entry files. The controller verified test hashes
remained unchanged and independently ran the same command: exit 0, **2/2 pass**.
A subsequent test-only compatibility adjustment updated the other existing
hostile-report exact-key assertion, preserving its privacy assertions; production
hashes were unchanged during that adjustment. The full controller-run eval
project then passed **35/35**. Backend/eval typechecks and targeted lint/style
checks passed.

Private immutable evidence: `recovery/phase-01-controller-red-final.log`
(SHA-256 `dd776a66cc287fcc3e7898e43133e8759320bb74a7fb5aa2f50fa18f44cb9997`),
`recovery/phase-01-controller-green.log`
(SHA-256 `becafd000752370325c96354d12c16efefca59517fb1914d9d929d1cc39be687`),
and `recovery/phase-01-controller-evals-green.log`
(SHA-256 `a0713daf85d9b94bb9cdca2ac32aea5a17ad799e4785067e4a27559bcccdf1a2`)
under `.superpowers/sdd/2026-11-09-f4-chat/`. Corresponding JSON files record
commands, exits, output hashes and test hashes; `recovery/phase-manifest.json`
records the gates. This proves only the empty-list default, not chat scoring,
context policy, recovery, or completion of Task 16.

### Recovery rule 02 — controller-run mock research-claim scoring

Phase A changed only `evals/test/f4-chat-recovery.spec.ts`; the full production
hash inventory was unchanged. Two independently executed contexts exercise
the supported durable `complete` scenario, each with one scripted answer. The
controller observed both missing-score assertion failures after one measured
model request per context: a research claim requires score 0; a nonclaim
requires score 1. Expected scores are test assertions, not product inputs.

Only then was Phase B authorized in the three evaluation contract/harness/entry
files. The controller checked the exact changed paths and frozen test hash,
inspected that the answer goes through the mock gateway and scoring reads
persisted `finalOutput`, and ran the same tests itself: **2/2 passed**. Full
controller-run eval regression: **37/37 passed**. Backend/eval typechecks and
targeted lint/format checks passed. No scenario tree, cycle validation, language
or citation policy was added under this gate.

Controller evidence under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`:

- `phase-02-controller-red-observed.log`, SHA-256
  `ab6fe6bceb98a50928183df9bcb8f91901e3fe4f0a5c731d73a52d0ba45749e4`
- `phase-02-controller-green.log`, SHA-256
  `aa56b60a7cc5a66e9966381b355245bddef267eec68ff1cd025a89c5eb25e1e5`
- `phase-02-controller-evals-green.log`, SHA-256
  `624046afb69907680618fafdb1b91065d91b1c4bfcfffbadb9b3121cb983adb7`

The matching JSON records retain commands, exits and hashes. An obsolete
test-title filter skipped all cases in an earlier controller run; that output
is retained as **nonqualifying**, never counted as RED/GREEN. The corrected
command uses `-t 'scores the no-claimed-research policy'`.

This is bounded fixture-scoring evidence for these two answers, not a universal
semantic research-claim judge or real-model evaluation. Other Task 16 policies,
versioned chat instructions in evaluation runs, context/recovery/privacy
scenarios and task-level review remain pending. Contexts in this narrow slice
use one configured fixture; multi-fixture selection has not been established.

### Recovery rule 03 — actual evaluation instructions and stored version

Phase A added only
`backend/test/integration/f4-evaluation-instructions.spec.ts`; the controller
verified production hashes were unchanged. Call-through spies observe the real
scripted gateway input and actual `AiRunRepository.find` row, without a new
product inspection API. The controller-run RED independently failed exact
system instructions and stored `instructionVersion` assertions, while the
model-request count passed. Only then was the evaluation harness authorized
to attach existing `CHAT_INSTRUCTIONS` to the deterministic chat-fixture
profile. The existing RunService snapshot persists the version. No direct
database write, new policy or validation rule was introduced.

Controller evidence in the ignored recovery records:

- `phase-03-controller-red.log`: two expected behavioral assertion failures,
  SHA-256 `179adc4fc53b178cb4d8d08a8a55289a035a007bf58699dc969f4b8c34579ff4`.
- `phase-03-controller-green.log`: same test hash, **1/1 passed**, SHA-256
  `cf469dc8d74ed6c07090ace6ab11b7525a061d049cb22b90a86a28453741a9a7`.
- Typecheck then exposed a test-spy `this` annotation omission. Production was
  frozen while only that annotation was repaired. The controller temporarily
  restored the pre-rule harness and reconfirmed both behavioral REDs with the
  typed test, then restored implementation bytes exactly. That failure log is
  `phase-03-controller-typed-red.log`, SHA-256
  `9b8b6f5420db7bc58907022dfd0dbe521ae4d656ae1d070448b158647dccf5fd`.
- Final controller-run instructions integration plus eval regression:
  **38/38 passed across five files**, with backend/eval types, targeted lint
  and formatting passing. `phase-03-controller-regression-green.log` SHA-256
  `4309f87f70fae441533d575c758dc5639ac282a8f2f50bd131fe512f51b311f7`.

This establishes actual instruction delivery and version persistence for the
configured synthetic chat evaluation, not real-model policy compliance or
completion of Task 16. Runtime case validation, other policy/context/privacy
and recovery proofs remain pending.

### Recovery rule 04 — public case-ID allowlist

The controller verified that Phase A changed only the recovery eval test. Its
negative fixture uses an explicitly invalid runtime case ID containing a
synthetic canary, starts a real deterministic run, and requires completed status
and one model request before inspecting the safe report. Controller RED
observed the canary reflected in `cases` instead of `[]`: **1 failed, 3 passed**.
Only then was a filter for the currently supported case ID authorized in the
public evaluation entry. The controller checked that single-file diff and the
unchanged test hash, then ran GREEN: **4/4 passed**. Backend/eval typechecks and
targeted lint/format checks passed.

Ignored evidence: `recovery/phase-04-controller-red-observed.log` SHA-256
`f206767c27b6cc7ac0f52833d9d0cb6b202187558211aaf22609fee932b0ae06`;
`recovery/phase-04-controller-green.log` SHA-256
`66b42c3d41ad4114a1810ef652b4b929d6e2143a6039375cd31676919e30bc76`.
JSON records contain actual commands/exits and matching test hashes. An earlier
incorrect name filter skipped all cases; its log is retained as nonqualifying
evidence. Whole small-file execution supplied the actual RED/GREEN evidence.
This proves only unknown-ID omission; it does not establish other validation
or remaining Task 16 privacy/recovery requirements.

### Recovery rule 05 — synthetic invented-source fixture

Phase A changed only the recovery eval test; full inventory hashes confirmed
production unchanged. Two independent deterministic engine runs require one
model request and completed status, then score 0 for the explicit synthetic
“fictional Act No. 99 of 2099, Article 17” marker and score 1 for an answer
requesting a missing source. Expected scores remain test assertions only.
Controller RED: **2 failed, 4 passed**, both failures at missing case results.
Only then was the existing case union, persisted-output scorer and public
case-ID allowlist extended for this one policy. Tests remained frozen.

Controller semantic inspection removed an unnecessary exact-positive-sentence
requirement before GREEN; grading uses absence of the synthetic invented marker
in persisted output. This is a bounded fixture check, **not general citation
verification or evidence of real-model factual correctness**. Controller GREEN:
**6/6 passed**, with identical test hash to RED. Backend/eval types, targeted
lint and formatting passed.

Ignored controller evidence: `recovery/phase-05-controller-red.log` SHA-256
`5fac1f8b6814f4a4f9fc11d788eafe676ed08b4fea073ce8c07cfed736caef1c`;
`recovery/phase-05-controller-green.log` SHA-256
`4eba00032cf43c33ec8b8620a13df02883b75b5b82410edbb7c94a7c700548cc`.
Corresponding JSON records capture commands/exits and matching test hashes.
Language, quotation, broader hostile-context, runtime-recovery/privacy proof and
whole-task review remain pending; these incremental commits do not close Task 16.

### Recovery rule 06 — bounded synthetic language fixtures

Phase A added four independent deterministic contexts for English/Indonesian
user prompts and matched/mismatched scripted answers. Each requires a real
completed engine run and one model request before the case score. Expected
scores live only in test assertions. Full controller hash checks confirmed
test-only Phase A. Controller RED observed **4 failed, 6 passed**, all new
failures at the missing language scores.

Only then was Phase B authorized for the language case contract/allowlist and
a bounded grader reading actual persisted `inputText` and `finalOutput`. The
controller inspected the scoped diff, verified the frozen test hash, and ran
GREEN: **10/10 passed**. Backend/eval typechecks and targeted lint/format passed.
Ignored evidence: `recovery/phase-06-controller-red.log` SHA-256
`91e60038c030783ea0f61ec8eb58df004b0bd829c8a9746a7fb52853df1cf50a`;
`recovery/phase-06-controller-green.log` SHA-256
`555d016043844af1b118a7402e6f41eb82490bc43c99950b15df47ba223b23d7`.
JSON records contain exact commands, exits and matching test hashes.

These are unambiguous synthetic language-marker fixtures, not robust general
multilingual detection or proof of real-model behavior. Language override and
other languages are not established by this evidence. Task 16 still requires
its remaining context/recovery/privacy/accessibility coverage and fresh task
review; the compensating mutation gate remains pending before handoff.

### Recovery rule 07 — persisted reasoning excluded from prior context

The tests-only phase seeds an earlier assistant run using the existing fixture
helper, verifies the reasoning summary and duration through the real public
repository read, then inspects `ChatHistoryContextProvider.collect`. Visible
prior answer text is retained, while the distinct stored reasoning canary and
reasoning metadata fields are absent. Existing branch, cancelled-partial and
budget assertions remain intact.

Controller observation: **3/3 passed on existing production code**. This is
regression evidence, **not RED**, and authorized no production change. The
controller corrected a test-only private helper import through the existing
fixture API rather than weakening the database boundary rule; types, lint and
format checks passed. No production file changed.

Ignored `recovery/phase-07-controller-regression.log` SHA-256:
`3b2dd38e565cf6487c4ad74ac289e412c73c8033834fa6d70b1c6b8da419900c`.
The JSON record retains the exact command, exit and test hash before a final
format-only adjustment. This proof concerns the real context-provider output;
it is not independently a full crash/restart or model-network privacy proof.

A scoped review of recovered evaluation rules 01–06 found one Important issue:
non-complete scenarios can acquire chat case results even though the configured
chat fixture only executes for `complete`. It remains open for its own
controller-observed test-first correction. The reviewer also suggested clearer
grader dispatch as a Minor maintainability follow-up. No full Task 16 approval
is claimed.

#### Task 16 recovery Rule 08 — evaluation fixture attribution review fix

The scoped partial review found that a non-chat replay scenario could acquire a chat policy score without executing its configured answer. Phase A changed only the evaluation test. The controller observed replay complete with two model requests, one effect and one replay, followed by the expected failing assertion: `cases` contained a passing chat case instead of `[]` (10 other tests passed). Only then was Phase B authorized: one complete-scenario condition at fixture registration, matching the existing gateway path.

Controller evidence: `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-08-controller-red.log` (SHA-256 `8118a9425eefca23c4f4d8b369f10cccb9ff65978e087cdcc0e773be063d4670`), followed by `phase-08-controller-green.log` (SHA-256 `2b1e8e03e8cd5c4df5756c1c48b15c20902a02a493e5cfc1ac0f1c874b0f7d88`), 11/11 passing with identical test SHA-256 `213f2dbe52b8b271b95d4d54473c841a91a5d16996bcd7d667c48f577e5b453c`. Full inventory checks confirmed Phase A touched only the test and Phase B only the named harness file; backend/eval typechecks and targeted lint/format checks passed. This fixes partial-review I1; Task 16 overall remains in progress. The nested-grader readability suggestion M1 remains recorded for final review.

#### Task 16 recovery Rule 09 — hostile prior-history assembly regression

Tests-only coverage seeds a hostile earlier-user instruction in the real exact-131,072-byte history fixture, then observes the actual worker gateway input. The versioned chat instruction remains unchanged, and the hostile text appears only between the existing untrusted-context boundaries, with no additional promoted message. The initial run already passed, so this rule authorized no production change. Test-only type narrowing/formatting was followed by controller runtime 3/3, backend typecheck, lint and format checks passing. This proves prompt assembly isolation, not a real model's resistance to hostile content.

Final controller log: `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-09-controller-final-regression.log`, SHA-256 `54c97a37ed5a71905a5308f73cc5b2bac8b217b0e7501eef68f34def72c6eb61`; test SHA-256 `b3b51c6e168ed7f79db2c3e7b7a91b140dc13fa9b2557004d370b6ff823c8b32`. The scoped Rule 08 re-review approved I1 with no new findings; the complete evaluation package also passed 45/45 (`phase-08-controller-evals-regression.log`, SHA-256 `989a7acfba13328a6a93de4512430d8b16572824325eae539f361082a1058584`). Task 16 remains in progress.

#### Task 16 recovery Rule 10 — real HTTP chat/search log privacy regression

A tests-only integration case sends distinct synthetic content/search canaries through real authenticated create/read/search endpoints, confirms content was accepted and returned to its authorized user, and exercises strict-search validation. It captures serialized backend stdout logs before API/Pino initialization, requires the actual successful-search and failed-validation request IDs to appear, and verifies both canaries are absent from those logs and the safe validation error. The first capture was installed after initialization and failed its non-vacuity check; that setup failure authorized no production change. After the test-only capture-order correction, the controller observed 1/1 passing. No production change was needed or authorized.

Evidence: `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-10-controller-capture-observation.log`, SHA-256 `670025d9be485c32834ca6de145ace1fbbed1d3311be3ea04fee70dee61eae4b`; unchanged test SHA-256 `d7f82b0288ae51e82e8af62a21fe2682af60d2ebfdc28495c242671b89cc84c5`. Backend typecheck and targeted lint/format checks passed. This covers HTTP logs/error serialization; provider-error traces and recovery remain separate Task 16 work. No Sentry SDK integration is claimed.

#### Task 16 recovery Rule 11 — real Compose worker SIGKILL and replay

The new recovery test is mapped into the existing `chat-runtime-proof` project. Phase A changed only two test files; the controller observed the installed Playwright CLI successfully list existing tests but omit the new file (8 passing discovery tests, 1 expected assertion failure). Phase B then changed only that project's `testMatch`, retaining all options and its prior file. Discovery passed 9/9 with the test unchanged: RED log SHA-256 `7a9b015e5456e06fafba80c84be4073681c4bb3e24cc05ab716e328b83aafe77`, GREEN `3ee339d54665afd3bc6363e1767e03ff967d796cd735a03a59ea8d7b26c7fc6c`, under `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-11-controller-discovery-*.log`. This RED authorized mapping only, never engine or worker changes.

The controller separately ran the real isolated Compose case: `pnpm test:e2e --project chat-runtime-proof --grep 'recovers a held answer after SIGKILL and restart of ai-worker'`. It passed 1/1 (browser case about 1.2 minutes; complete command including build/start/cleanup 158.88 seconds). The case observes the held prefix through authenticated PostgreSQL-backed chat reads, kills the isolated worker with SIGKILL and asserts exit code 137, restarts it, waits for real recovery, reconnects through Caddy with the actual stored Last-Event-ID, validates reset snapshot framing, and requires exactly one canonical completed answer with matching live and reloaded text. This is actual process termination, not an in-process claim-expiry simulation. No engine/worker/fixture change was required.

Final log: `phase-11-controller-compose-snapshot-observation.log`, SHA-256 `699f936718117b184fd0a77c64e7f1c917a9fb7fc2d77f5124c963cf5de39779`; unchanged test SHA-256 `17295c23ae88acdf1565dfae951cbb342d15f2fc5456e366aca6470538eb1c2e`. Earlier runs are retained: `phase-11-controller-compose-observation.log` failed because the test queried the control socket before restart readiness; `phase-11-controller-compose-ready-observation.log` reached real recovery/reset but assumed a mandatory snapshot part before waiting for snapshot-end. Those test setup/contract assumptions authorized no runtime changes. The corrected test polls health, waits for snapshot completion, allows the declared zero-part snapshot and compares reload to the current authoritative checkpoint. Backend typecheck and targeted lint/format checks passed. Existing dependency-build and NO_COLOR warnings remain in the raw logs; no full-suite or whole-Task-16 completion is inferred. Isolated stacks were cleaned; the unrelated local database remained untouched.

#### Task 16 recovery Rule 12 — real Backend API restart through Caddy

Tests-only coverage restarts the isolated Backend API while its worker remains alive with a held, checkpointed answer. It verifies the API container's start time changed and public Caddy health became ready, reloads through Caddy with the stored Last-Event-ID, validates completed reset snapshot framing and checkpoint equivalence, then requires one canonical completed answer with matching live/reloaded text. This proves explicit reload/reconnect after a real API restart; it does not claim automatic retry behavior. The safe event observer is shared locally by both recovery cases. No production/configuration change was needed or authorized.

Controller command: `pnpm test:e2e --project chat-runtime-proof --grep 'recovers a held answer'`, **2/2 passed**: real worker SIGKILL about 1.2 minutes; API restart about 13.3 seconds. Full build/start/test/cleanup command took 173.776 seconds. Final log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-12-controller-ready-compose-observation.log`, SHA-256 `1b1888956b833e427ab5fcf38f939b7bb755cff3573d0dc73ab7b02ee63d0ee0`; unchanged test SHA-256 `9d7a1b5e3603c8ba0c1c3653edc512f58ad3d8e5ab0d0f531bd1a0c1477c3d39`. Backend typecheck and targeted lint/format checks passed.

Earlier observations remain recorded, not qualifying runtime REDs: the first selected the completed seed run before the asynchronous send committed; both cases now exclude its validated run ID. The second reached API restart but a credentialed health probe hit transient connection reset before HTTP readiness. The bounded readiness probe now uses unauthenticated Node fetch through Caddy, so an expected connection failure cannot print generated test-cookie headers in a Playwright call log. Both test corrections preserved restart, cursor, snapshot and exact-output assertions. These are regression tests of existing behavior; Task 16 remains in progress.

#### Task 16 recovery Rule 13 — cookie expiry closes established SSE

A tests-only real integration case establishes a stream, confirms its actual current cookie session through the session-list API, then ages that session past expiry with the existing database inspector. It drains queued frames and observes EOF within the bounded check, without signing out, revoking or publishing an invalidation as a substitute. Reconnecting with the same expired cookie returns a safe non-stream 401. Existing behavior already passed, so no production change was authorized.

The controller ran the whole `chat-sse.spec.ts` file: **16/16 passed**, including expiry, revocation, cross-owner/tenant/deletion denials, default-seven oldest eviction, membership removal, organization switching and MFA policy changes. Log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-13-controller-observation.log`, SHA-256 `c9844bc9491aa55d19bc218b92c1e6939b0ace5c09d36cb498e5781bca708d26`; unchanged test SHA-256 `581c98207fcb22430c3bbcdb5bfa303baaab480f9af0c9b02fe910af93937be3`. Backend typecheck and targeted lint/format checks passed. This remains a Task 16 checkpoint, not a full-branch completion claim.

#### Task 16 recovery Rule 14 — approved shell regression contract

The sidebar unit regressions still expected F2's Home/Conversations shell. Tests now require the approved F4 New chat `/workspace`, Chats `/chats`, role-eligible Platform destinations and active-route state, plus Recent empty-state/collapse visibility and a real View all chats link. The fetch fixture supplies the existing shared-contract empty chat page rather than an identity object to the Recent request. Existing role, hidden Personal-name privacy, menu, sign-out, Escape/focus and mobile-boundary assertions remain. No source or golden changed.

Controller: `pnpm exec vitest run --project frontend frontend/test/sidebar.spec.tsx`, **13/13 passed**, with frontend typecheck and targeted lint/format checks passing. Log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-14-controller-observation.log`, SHA-256 `1210f3e711de2ee1bc4eecf3364a80990aa75e4378160be767bb2fc21f1b0e39`; unchanged test SHA-256 `34a0b6086983762a59252fdf17f0e9c982e38efad1f647db96190c5e74d9d17f`. This is regression coverage of already-implemented Task 15 behavior, not a retrospective RED-first claim. Task 16A's compensating mutation evidence remains mandatory.

#### Task 16 recovery Rule 15 — empty shell stays read-only

The shell E2E test now requires the exact set of approved chat reads (`GET /api/chats/events`, `GET /api/chats?limit=6`) at both checkpoints, allowing legitimate repeated reads and arrival order differences. It still rejects every mutation or unknown chat request and preserves empty-composer, no-user-turn, asset, collapse, responsive and scoped-not-found checks. No endpoint mock, source or golden changed.

Controller Compose run passed **2/2**: the corrected shell case and the unchanged security enrollment/challenge/recovery regression. Log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-15-controller-compose-observation.log`, SHA-256 `95a9fe11d88a9244ae6c9b8b7e6b9c6d71b47a738d655de750452b64acd86c8e`; test SHA-256 `f9ec8f5f299ebe997ed0a3160a9e652d3b2cefd6e4d32c1e2cc52fbd09e11eb0`. Backend typecheck and targeted lint/format passed. The prior Linux security failure was not reproduced locally; no security production change or claim of a diagnosed fix is made, and the final Linux check remains required.

The controller also ran full `pnpm test` at the preceding shell-regression checkpoint: **1,225/1,225 tests across 192 files passed** (190.041 seconds). Raw log `phase-14-controller-full-regression.log`, SHA-256 `3b0b74d3b2e991646b6eb5444a635393051f9e81acca0d48c9e766f6dc3e7fff`. Existing diagnostic/dependency/JSDOM output is retained in the log; this is not a claim that all Compose/visual/mutation/final-head gates have passed.

#### Task 16 recovery Rule 16 — provider-error privacy and missing safe code

The new integration test uses the real gateway with an injected synthetic HTTP provider failure, the actual durable engine/Valkey stream/API SSE, captured stdout/stderr, and the production SafeSpanExporter/OTLP HTTP pipeline to a loopback collector. It requires actual provider invocation, correlated HTTP logs, failed-run metadata in received OTLP bytes, and error/finish events before checking that private-prompt, fake-key and raw-provider canaries are absent from all three output boundaries. No real provider request, key/environment access or Sentry integration is involved.

Controller-observed typed RED identified a real engine defect: the run was `failed` with `errorCode: null`, rather than `AI_PROVIDER_UNAVAILABLE`, so the expected error event never arrived. Preflight test typing and content-free diagnostics were corrected before authorizing implementation; setup/type failures were not used as RED. Only then did Phase B change one priority condition in `step-executor.ts`, retaining the safe code/default for known failed attempts as well as unknown attempts. Success, earlier budget/tool/output/iteration priorities, accounting and terminal proofs remain unchanged.

Typed RED: `phase-16-controller-typed-red.log`, SHA-256 `49f6196fac57bb9f6fd620b6ef36eea1e908e3e5366d81819cc59706114c2cfb`. GREEN: `phase-16-controller-green.log`, SHA-256 `6673650b9c52deb6d07d1c2d816d31efdc46cf4c2821bb83c7da2ac03143e4b0`, **2/2 passed**, identical frozen test SHA-256 `2cff6ecc77d5a5e91256fe4ff4d4789b1bf99bc09645a2de4951440bb73aebf1`. Both logs are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`. Full file-inventory checks confirmed tests-only Phase A and the single authorized source path in Phase B. Backend typecheck and targeted lint/format passed. Executor/streams/all mock evaluation regression: **158/158 across 6 files passed**, `phase-16-controller-engine-regression.log`, SHA-256 `074f0a53ffc9d330649a4e07dc2316201b3d153e8ccf6a2ba09d5bbfd85241c9`. Earlier 1,225-test/full-browser evidence predates this source fix; final checks remain required.

#### Task 16 execution ordering clarification

`chat-browser`, `chat-runtime-proof` and `chat-routing` are exercised now. The concrete `chat-sse-load` and `chat-visual` files and mappings belong to Tasks 18 and 19 respectively, which already own them in the approved plan. Empty aliases are not added early: the load mapping must arrive with its tested default-selection exclusion and changed-path/manual trigger rules. This changes ordering only, not those tasks' required evidence or final names. No existing golden is changed by this clarification.

#### Task 16 recovery Rule 17 — JSON fallback preserves F1 tenant repair

Phase A added tests only. With valid response bodies, the controller observed both recognized fallback reasons return chat data without emitting F1's existing identity hint (2 failed, 19 passed); an unknown header preserved normal behavior. Frontend typecheck passed before production authorization. Phase B was limited to the JSON client and the existing identity client: reuse the finite reason parser/event, preserve F1's path/server-cookie guards, notify before decoding, and reject repaired-scope data with `AI_ACCESS_REVOKED`. No stream, cache or authorization policy changed.

Controller RED `phase-17-controller-red.log`, SHA-256 `1b420b3b1868b6002c003b5d3e7f579d1c592c806be3af12365132884b1464bb`; GREEN `phase-17-controller-green.log`, SHA-256 `d7075c742281bcfa3e53b66628fb82331eecfce727ef6388210f0fad83673f6f`, **21/21 passed**, unchanged test SHA-256 `3285a64dd2df0bc5fe5d5c1c83981ac47601bacdcd57402e79d8752a40e8a31f`. Full frontend regression **292/292 across 38 files passed**, `phase-17-controller-frontend-regression.log`, SHA-256 `e645ce5933644ca2f5e28653bc337ea34fe5884b4fa7019e8d17d849a1c12249`. Full inventory gates, frontend typecheck and targeted lint/format passed. Logs are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`; existing JSDOM diagnostic output remains. Stream and background-event fallback paths require separate rules; Task 16 is not complete.

#### Owner amendment — conditional F2.1 Home baseline retirement

On 2026-11-13 the owner authorized retirement only after comparing **every** F2.1 baseline against the current head. Each differing image must be listed; a baseline may be retired only when its entire difference is caused by the approved Home/Conversations → New chat, Chats and Recent navigation change. Every retirement requires its reason and diff image. All other differences remain regressions to fix. All unaffected screenshots and functional/accessibility tests remain. Until F4.1 creates replacement baselines, deterministic tests must cover navigation labels/order, current-page state for New chat, Chats and a Recent chat, collapsed behavior and keyboard access.

Initial inventory verified all 82 baseline files against their recorded hashes and approval IDs. This is inventory only: the complete current-head render/comparison and replacement navigation test are pending; **no baseline has been retired**. Task 20 remains deferred to F4.1; this amendment does not authorize new goldens, broad screenshot exemptions, masking or tolerance increases.

#### Task 16 recovery Rule 18 — fallback on active run streams

Phase A changed only the transport test. The controller observed 4 failing cases and 23 passing cases: both finite fallback reasons were ignored on 200/404 responses, successful streams were consumed, and fallback bodies were not discarded. Unknown headers and a response arriving after disposal already passed. Frontend typecheck passed before Phase B. The only authorized source change reuses the existing notifier for current/open requests before status parsing, cancels the body, releases the request and throws `AI_ACCESS_REVOKED`; late responses cannot emit a hint.

Controller RED `phase-18-controller-red.log`, SHA-256 `a02a28c4fda68d2d8d01a2e2839612b6eaf644daca4258e6028c2574b064d857`; GREEN `phase-18-controller-green.log`, SHA-256 `a92405237d92f5f4b1d5fea320e46ab74e9166eed22fff086a0d52190c53f0c3`, **27/27 passed**, identical frozen test SHA-256 `a1a07cde5f74912246841736a2ab91149ceff0943fe5e1294eb0723294e75cdb`. Logs are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`. File-inventory gates, frontend typecheck and targeted lint/format passed. This covers fetch-based run streams, not native EventSource invalidation hints; that remains separate work. Task 16 is not complete.

Full frontend regression after Rule 18: **298/298 across 38 files passed**, `phase-18-controller-frontend-regression.log`, SHA-256 `39554b58d0222778ce67a1738e6a131df202c39452d09262fbfd78bfa93be306`; frozen test unchanged. Existing JSDOM navigation diagnostics remain in the retained output.

#### Task 16 recovery Rule 19 — initial-fetch title invalidation race

Phase A used real QueryClient/QueryObserver and a held initial no-data response. The controller reproduced a stale title after list invalidation, thread invalidation and initial stream opening: **3 failed, 6 passed**. The expected value was `Updated server title`, but the observer retained `Old server title`. Existing incomplete QueryClient doubles were replaced by real clients with call-through spies; two optional-filter typing errors were repaired in the tests before the final typed RED. Production authorization followed only after typecheck passed and the behavioral RED was reconfirmed.

Phase B changed only `chat-title-invalidation.ts`: cancel the targeted in-flight query before the existing invalidation/refetch, retaining owner/org keys, callbacks, recovery scope, 15-second throttle and disposal. No polling, retry or timeout was added. The cancellation changes query fetch ownership, not model generation. Research and the pinned TanStack `5.105.0` source finding are recorded in the design addendum.

Typed RED `phase-19-controller-typed-red.log`, SHA-256 `5ad13362e34b5dfe4ac657351791ea701445f06cdd2f155affbd97ced5917c78`; GREEN `phase-19-controller-green.log`, SHA-256 `e91765cb34b349210513db676d8a252632b07982ba751943780f7784d102c3c7`, **9/9 passed**, identical frozen test SHA-256 `4b1bca76519893cee287a46054141deb9ed42de95688a45696f7db4bca10577b`. Full frontend regression **301/301 across 38 files passed**, `phase-19-controller-frontend-regression.log`, SHA-256 `5e0e6a3dc1876e143227156b4d2e12fe02635ba465a41d6fb9c063f342086c53`. Full inventory gates, frontend typecheck and targeted lint/format passed.

The unchanged real Compose history case also passed **1/1**, including the mounted title assertion, submit search, branch targeting, rename/delete, keyboard/mobile focus and axe checks: `pnpm test:e2e --project chat-browser --grep 'Chats history'`, 170.205 seconds including stack build/start/cleanup, browser case 7.5 seconds. Log `phase-19-controller-compose-regression.log`, SHA-256 `5b5d7a6eb58b185cefe7b5672817c6530803dfd3dccf2acc504ef83b545e2018`; unchanged browser test SHA-256 `63c3a44225bdf97a7f7f44f3f7f7fdae257c99f6eada4edee3b839cac8616b09`. All logs are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`. This is a deterministic fix plus local browser regression evidence; final Linux CI remains required. Task 16 is not complete.

#### Task 16 recovery Rule 20 — native EventSource preserves F1 repair hints

Phase A changed only the two named tests. Backend/frontend typechecks and targeted lint/format passed before the controller ran RED. The real backend test makes `/api/chats/events` the first request after membership removal, verifies its actual fallback header and requires the actual Personal org UUID in a strict first data frame: **1 failed, 16 passed**, because no typed hint arrived. Frontend cases observed missing hints/old-scope disposal for both recognized reasons and missing same-org notification: **3 failed, 12 passed**. Invalid reason/UUID/extra-content cases already passed.

Phase B was limited to five named source files: one strict shared event schema, controller/service emission from the existing guard response plus branded actor after SSE admission, an extracted existing identity-hint publisher, and consumer validation/disposal. Cross-org subscriptions close idempotently, detach callbacks and clear recovery timers; same-org hints preserve the stream. The client does not select an organization from the hint: F1 verifies identity as before. No guard, role, RLS or connection-limit policy changed. The design records the official EventSource research and this content-free protocol addition.

Controller backend RED `phase-20-controller-backend-red.log`, SHA-256 `a8e310523417e6d927e87532c9f5b2b9ce863c87e63f6beeec80c74dacfc720c`; GREEN `phase-20-controller-backend-green.log`, SHA-256 `419472abaa3dad18a1cb86a9d98e20846f451984682a2f6044096bfc5140a69f`, **17/17 passed**, identical test SHA-256 `8ad1434bbc44eff82ac7a1d4e80418131370f424aeda7ae8c74892be7689ecf8`. Frontend RED `phase-20-controller-frontend-red.log`, SHA-256 `bc5f3139bd3cc78dafc79353c2ea6b0f7d5383e174bd04f0b606914fcacec9b0`; GREEN including unchanged transport regressions `phase-20-controller-frontend-green.log`, SHA-256 `44aabc55d987b7d3365286eb3c1949fb28eaa3fd9bc7a69144c31a1cb4575cd9`, **42/42 across two files passed**, frozen title-consumer test SHA-256 `a38a6844b61948ac8956b3f5133121cfcf897ee234fec737901772aebfb23e9c`.

All logs and full inventory gate receipts are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`. Backend/frontend typechecks, root lint including 99 boundary checks, and root format check passed. Full repository regression is recorded separately when complete; these focused results do not complete Task 16 or the owner baseline comparison.

Rule 20 broader verification: full `pnpm test` **1,245/1,245 across 192 files passed**, 208.371 seconds. Log `phase-20-controller-full-regression.log`, SHA-256 `513840802f7e938281722248c849148fd3ac4b525d05c9fec14cfb0aafbf7349`; frozen SSE test unchanged. Root lint log `phase-20-controller-root-lint.log`, SHA-256 `53ec266a06adbdad80cedca8d4c244ef18dd728a78ace54b7faa8a683e9a7401`; root format log `phase-20-controller-root-format.log`, SHA-256 `bcbbedc28a1be9a32136a7398668c0d79161a6706dfa2fe78d78ae115050b006`. Evidence-note changes received a subsequent targeted format check. Existing dependency/JSDOM/runtime diagnostic output remains in the immutable logs. This does not claim Linux Compose, all-image comparison, mutation or final-head gates passed.

#### Task 16 recovery Rule 21 — owner-required navigation coverage

A separate real Compose/Caddy test covers New chat → Chats → Recent DOM order, actual hrefs, current-page state on workspace/list/selected Recent thread, Tab/Enter navigation, collapsed accessible primary links with Recent absent, and expanded restoration. It uses a real API-created and renamed chat. The controller confirmed the entire original history/search/functional/axe test file remains an exact byte prefix; only the new case was appended. Existing screenshots were not edited. Behavior already passed, so this is regression coverage and authorized **no production change**. It does not retrospectively make Task 15 RED-first or replace Task 16A.

Controller command `pnpm test:e2e --project chat-browser --grep 'Chats history|search opens an inactive|workspace navigation order'`, **3/3 passed**, 119.792 seconds including isolated stack build/start/cleanup; browser cases 6.5, 4.2 and 1.4 seconds. Log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-21-controller-compose-observation.log`, SHA-256 `f2730591a7826db302ca632afe3771e6d6ddf6166c54982f592784428a98c8ac`; unchanged test SHA-256 `e0a0772f850001569affe8f3c39666b88b990b34600befcc2f723dce97d7fd12`. File-inventory gate, backend typecheck and targeted lint/format passed. This supplies the owner's temporary navigation behavior coverage; complete 82-image comparison and any conditional retirement remain pending.

#### Task 16 recovery Rule 22 — prove all review captures are fresh

Tests-only Phase A exercised the real existing manifest CLI with a temporary output path. The controller observed two expected REDs: future and invalid `--not-before` arguments were silently accepted and produced valid 82-view manifests. This was not a missing-browser/setup failure. Only then was the existing CLI authorized to validate an optional positive epoch-millisecond marker and stat all 82 indexed PNGs **before** launching Chromium; stale or missing images fail closed. Default no-marker behavior and existing approval/baseline guards remain. Approved review files are not purged: the existing Security test still proves an incomplete capture preserves their bytes.

RED `phase-22-controller-red.log`, SHA-256 `82f41b1c635d2e2f6b85f43852678ed7f79d99c33012d0e154c16bad69d491c3`; GREEN `phase-22-controller-green.log`, SHA-256 `fbb035f0d881d9d4d3f4b79547063a5b4e7da9ae0e22d8014634bf9c31da7bcc`, **2/2 passed**, identical frozen test SHA-256 `837a434ddd5484b757f8c00f9a29def7393efe9732943d4ee6e3178d2f22b398`. The controller set `PLAYWRIGHT_BROWSERS_PATH` to a nonexistent path for GREEN, demonstrating refusal before any browser dependency. Full tooling **161/161 passed**, `phase-22-controller-tooling-regression.log`, SHA-256 `1a4b1c004119c1cc8249d33c90992e56c27a57df8b2b38018a11b77721123eaf`; file-inventory gates and targeted lint/format passed. Logs are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`.

A separate default-CLI compatibility run successfully read the existing 82 indexed PNGs into ignored `phase-22-default-manifest.json`. That run rendered no new images and is **not** current-head visual comparison evidence. Positive freshness and all-image comparison still require the Linux capture; no baseline has been retired.

#### Task 16 recovery Rule 23 — manual Linux all-image audit path

The existing CI workflow now offers an explicit manual `capture` mode. Normal PR/push E2E and compare/update behavior remain. After checkout and before E2E, capture mode records a timestamp; its always-run manifest step requires all 82 PNGs to be newer, and its always-run artifact step retains the images, marker, manifest and original index/approval/baseline metadata for 14 days. It uses the existing pinned upload action and does not update, purge or retire baselines.

Phase A changed only a Node workflow-contract test. Controller preflight caught and repaired a test assertion that accidentally rejected the preserved update branch, an incorrect manifest path, and an undefined test variable/regex lint issue. No workflow change was authorized until those test-only repairs passed lint/format and clean RED was reconfirmed: three missing capture configuration features. Phase B changed only `.github/workflows/ci.yml`; tests remained frozen.

Clean RED `phase-23-controller-clean-red.log`, SHA-256 `e3e62d65a9c7663a6948bfe77d3504a9079207bc3602ea84d9a67b9a42840b05`; GREEN `phase-23-controller-green.log`, SHA-256 `9c0b619cb4b3b17e4149222d92bbcfb7fc401844506ab19080fa78da686d85d6`, **3/3 passed**, identical test SHA-256 `37df467238adeed1d4d6f9862f585965b4b5b753d4398d73b22c89a035603793`. Full tooling **164/164 passed**, `phase-23-controller-tooling-regression.log`, SHA-256 `2fc2f05c833caa68dc65a218b3086520fe623dfa7e0f45545a2175f3250d7d65`. Inventory gates, targeted lint/format and host YAML syntax parsing passed. Logs are under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`. These configuration checks do not substitute for actual Linux capture or the complete image comparison, both still pending; no baseline has been retired.

#### Task 16 recovery Rule 24 — capture-selector alignment (Linux execution pending)

Only four expected visible-label strings in the legacy capture producer changed from `Home` to the approved `New chat`: mobile breadcrumb and the Home/expanded/collapsed indexed capture readiness labels. Historical `home` image IDs, Welcome heading, every adjacent functional/axe/loaded-content assertion, screenshot tolerance/mode, original images, index and approval remain. This is test-selector alignment with already-approved F4 navigation, not a production behavior change or retrospective RED-first claim.

Main-controller inventory/diff inspection confirmed exactly those four literal replacements; backend typecheck and targeted lint/format passed. Full tooling **164/164 passed**, log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-24-controller-tooling-regression.log`, SHA-256 `97a3e711063ef7f7fb5b4121d84c759bf29ac96dcef6006905de1247c6aaee76`; unchanged test SHA-256 `c78cedb489299498ddc4fc0f99081497f55e11447af7a5dea437e2d2c083ce26`. Actual Linux producer execution and all 82 comparisons remain pending. No baseline has been retired.

#### Task 16 recovery Rule 25 — full-route accessibility regression

Tests-only Phase A added a dedicated real-backend/Caddy suite and a project-discovery assertion. The controller observed the installed Playwright CLI omit the new file (**9 passed, 1 expected discovery failure**) after backend typecheck and lint/format passed. Only then did Phase B add that one file to `chat-browser.testMatch`; tests stayed frozen. Discovery passed **10/10**. This RED authorized mapping only, never UI changes.

The controller separately ran the actual dedicated Compose case: **1/1 passed**, performing **12 full-page WCAG through 2.2 AA Axe scans** (workspace, Chats and a persisted completed thread × desktop/mobile × light/dark), overflow/theme checks, skip-link keyboard activation and mobile dialog focus containment/Escape/opener return. No Axe exclusions, endpoint mocks, screenshots or UI changes were introduced. The initial test readiness was tightened before execution to select visible history links and real message containers, and to wait for a persisted nonempty completed answer. Existing functional/axe tests remain. This is regression coverage of existing accessibility behavior.

Discovery RED `phase-25-controller-ready-discovery-red.log`, SHA-256 `f3d760fe67f8df0b540a44f27ec1f67f73a70b55d00ad9224851b8198fb3175d`; GREEN `phase-25-controller-discovery-green.log`, SHA-256 `93f71ecdf0e8d1b3ce02c02fa444d48086e46b3d3a340198ddb15ed0bc925532`; identical Node test SHA-256 `7e6c2b5af3d9fc14a319c7d3c92c70e6e3f15da2c671573a335c0ca73cc2a402`. Actual Compose log `phase-25-controller-compose-observation.log`, SHA-256 `e13dde60baf8214794647d75483b9b79f17c4becb08aff3fbffde5c74a23af34`, 132.28 seconds including build/start/cleanup (browser 13.3 seconds); unchanged E2E test SHA-256 `d692fc247f29fd91e6524c699e627c33f1307f2eaa5a8dfa6c447d336cc37fbc`. Full tooling **165/165 passed**, log SHA-256 `0f7d7585a0449608af936dbaf710d0dd56e77f8a6cbb26d4a7997009b5ebaea0`. Evidence is under `.superpowers/sdd/2026-11-09-f4-chat/recovery/`; inventory/type/lint/format checks passed.

#### Owner-requested complete F2.1 baseline audit — retirement scope pending

[The complete report](F4-f21-baseline-audit.md) records all 82 current Linux renders at producer `49ad2f95ed55ad95e74f16cafc3cf08d0634f6b0`, [run 43434198137](https://github.com/pahle/lexon-ai-v6/actions/runs/43434198137), all hashes, every differing image and a full-size diff. All 82 image hashes match the retained fresh manifest; the original 82 baseline, approval and index hashes remain unchanged. The artifact retained all 87 expected files, including its two explicitly named hidden metadata files; the suspected omission did not occur and no upload change was made.

All 82 were compared with the unchanged existing threshold and separately with exact-pixel comparison for diagnosis. Main visually inspected all 48 changed-image triptychs and representative native-size pairs. **34 are pixel-identical; 62 pass the existing comparator; 20 fail.** Two failing desktop Provisioning images differ only in approved navigation. The other 18 failing Home/menu/sidebar views also show design-required F4 composer/Deep thinking/disclaimer/welcome-placement changes, directly or through the overlay; those exceed the owner's navigation-only retirement permission. They remain unretired pending clarification. All 28 Settings views pass the existing comparator and retain pixel-identical foregrounds; their existing assertions remain. No screenshot was skipped, regenerated or retired. F4.1 replacement baselines remain required.

The run's unit/integration job passed. Compose failed only on the separate account-security case waiting for the disable-2FA confirmation after password Enter; this previously passed locally and intermittently failed on Linux. No security assertion is weakened or failure treated as a visual exception. Root-cause investigation and final Linux verification remain open. These audit/checkpoint results do not complete Task 16, satisfy Task 16A, or constitute Task 19 formal approval.

#### Task 16 recovery Rule 26 — security Enter diagnostic, no fix claimed

The intermittent Linux account-security failure remains open: password Enter sometimes does not yield the expected disable-2FA confirmation within the existing 10-second assertion. Source inspection did not establish whether native submission, form validation or dialog handling is responsible. A tests-only observer now records Enter/submit counts, default-prevention state, input connection/validity booleans, bounded focus categories and the existing request count. It does not record values, lengths, labels, HTML, URLs, headers, cookies, recovery codes or credentials, and changes no focus/submission behavior. All functional/axe assertions, native Enter and timeout remain. Observer listeners are removed in `finally`; failure collection cannot replace the original assertion outcome. This temporary instrumentation must be removed before a behavioral fix.

Main inventory/type/lint/format checks passed. Bounded actual Compose observation `pnpm test:e2e --project identity-browser --grep 'security TOTP enrollment challenge and recovery' --repeat-each 3` passed **3/3**, 117.954 seconds including stack build/start/cleanup, browser cases 5.4/4.0/3.7 seconds. All observed one Enter and one native submit, with zero pre-confirmation account operations. Two sampled default prevention/visible confirmation after a frame; one successful case completed before the scheduled metadata sample, yielding null rather than evidence of a defect.

Log `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-26-controller-compose-observation.log`, SHA-256 `43fd96f24291bf1de30060b1bb66475231f58720959fabf9e1919f49d35cc8b2`; unchanged test SHA-256 `2179de4338a74b1dab6c69874442f0cc2101504e5f458ec4c2df9cd23d27d227`. These passing observations do **not** reproduce, diagnose or fix the Linux failure and authorize no production change. Linux observation with this instrumentation remains needed; Task 16 is still incomplete.

### Owner standing instruction for Tasks 16–21 (2026-11-13)

Choose the recommended routine option within the approved documents, record its reason here, and continue without questions. The controller-observed, test-only Phase A then narrowly authorized Phase B remains mandatory. No RLS/LEAKPROOF/SECURITY DEFINER bypass, weaker tests, changed thresholds, main push or merge is authorized. Stop for an unresolved blocking failure or an approved decision/spec/dependency change, and at final ready-PR handoff. Non-blocking notes are batched there.

Task 17 only: Codex may run the real high/max smoke locally by passing `.env` directly to the process (`node --env-file=.env` or the script equivalent). Never open/read/print/copy/log the file or key or echo environment values. Maximum four requests and USD 0.10 total under the existing allocation guard; no retries for better results, account/admin APIs, paid GitHub evals or other paid calls. Commit only safe case counts, tokens, cost, timing presence, provider and outcome. Any secret in output requires stopping, deleting that output and notifying the owner. This records authorization, not execution or measured calibration.

Task 19: produce the complete realistic-content formal review set with Task 15 corrections, self-review against the F4 prototype and record deviations, then continue to Task 21. Owner reviews layout/content/navigation/states with the final PR. Golden locking remains deferred to F4.1.

### Owner-approved retirement of exactly 20 F2.1 assertions

Owner amendment, 2026-11-13: include the required F4 new-chat presentation changes and retire **exactly 20** failing assertions: two navigation-only Provisioning desktop images and eighteen class C images. **Keep all 62 passing assertions unchanged.** Original baseline/review PNGs, approval, index and baseline manifest are preserved. The individual assertion selector is compare-only; capture/update behavior, containing tests, functional assertions, axe, readiness and menu cleanup stay unchanged. No golden was regenerated and no threshold changed.

Main checked the named semantic regions in each of the eighteen C images and the two N images, and computed exact RGB differences against the Linux producer. Every image has **zero** changed pixels outside the approved region union. The per-image rectangles and changed-pixel counts are in the [audit index](F4-f21-baseline-audit/index.json); they are evidence only, never comparison masks. The report below lists every retired assertion with its own reason, checked regions and diff.

| Retired assertion                          | Reason / checked regions                                                                                                                                                                            | Diff                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `home-desktop-light`                       | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/home-desktop-light.png)                       |
| `home-desktop-dark`                        | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/home-desktop-dark.png)                        |
| `home-mobile-light`                        | Required F4 presentation only: breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                                                | [diff](F4-f21-baseline-audit/diff/home-mobile-light.png)                        |
| `home-mobile-dark`                         | Required F4 presentation only: breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                                                | [diff](F4-f21-baseline-audit/diff/home-mobile-dark.png)                         |
| `provisioning-desktop-light`               | Approved sidebar navigation only: sidebar navigation. Outside-region pixels: **0**.                                                                                                                 | [diff](F4-f21-baseline-audit/diff/provisioning-desktop-light.png)               |
| `provisioning-desktop-dark`                | Approved sidebar navigation only: sidebar navigation. Outside-region pixels: **0**.                                                                                                                 | [diff](F4-f21-baseline-audit/diff/provisioning-desktop-dark.png)                |
| `organization-switcher-open-desktop-light` | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-desktop-light.png) |
| `organization-switcher-open-desktop-dark`  | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-desktop-dark.png)  |
| `organization-switcher-open-mobile-light`  | Required F4 presentation only: sidebar navigation; welcome hierarchy behind sheet; composer behind sheet: attachment removed, Deep thinking; disclaimer behind sheet. Outside-region pixels: **0**. | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-mobile-light.png)  |
| `organization-switcher-open-mobile-dark`   | Required F4 presentation only: sidebar navigation; welcome hierarchy behind sheet; composer behind sheet: attachment removed, Deep thinking; disclaimer behind sheet. Outside-region pixels: **0**. | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-mobile-dark.png)   |
| `user-menu-open-desktop-light`             | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/user-menu-open-desktop-light.png)             |
| `user-menu-open-desktop-dark`              | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/user-menu-open-desktop-dark.png)              |
| `user-menu-open-mobile-light`              | Required F4 presentation only: sidebar navigation; welcome hierarchy behind sheet; composer behind sheet: attachment removed, Deep thinking; disclaimer behind sheet. Outside-region pixels: **0**. | [diff](F4-f21-baseline-audit/diff/user-menu-open-mobile-light.png)              |
| `user-menu-open-mobile-dark`               | Required F4 presentation only: sidebar navigation; welcome hierarchy behind sheet; composer behind sheet: attachment removed, Deep thinking; disclaimer behind sheet. Outside-region pixels: **0**. | [diff](F4-f21-baseline-audit/diff/user-menu-open-mobile-dark.png)               |
| `sidebar-header-expanded-desktop-light`    | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-desktop-light.png)    |
| `sidebar-header-expanded-desktop-dark`     | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-desktop-dark.png)     |
| `sidebar-header-expanded-mobile-light`     | Required F4 presentation only: sidebar navigation; welcome hierarchy behind sheet; composer behind sheet: attachment removed, Deep thinking; disclaimer behind sheet. Outside-region pixels: **0**. | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-mobile-light.png)     |
| `sidebar-header-expanded-mobile-dark`      | Required F4 presentation only: sidebar navigation; welcome hierarchy behind sheet; composer behind sheet: attachment removed, Deep thinking; disclaimer behind sheet. Outside-region pixels: **0**. | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-mobile-dark.png)      |
| `sidebar-header-collapsed-desktop-light`   | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/sidebar-header-collapsed-desktop-light.png)   |
| `sidebar-header-collapsed-desktop-dark`    | Required F4 presentation only: sidebar navigation; breadcrumb; welcome hierarchy; composer: attachment removed, Deep thinking; disclaimer. Outside-region pixels: **0**.                            | [diff](F4-f21-baseline-audit/diff/sidebar-header-collapsed-desktop-dark.png)    |

Temporary coverage remains the real-Compose navigation behavior case (New chat/Chats/Recent labels, order, current page, collapsed behavior and keyboard), unchanged functional and axe checks, and Task 19's full formal set. The latter must include New chat, organization switcher open, user menu open, expanded and collapsed sidebar, in both themes and both desktop/mobile viewports. Mobile expansion/collapse uses the existing open/closed sheet, without a new control. F4.1 must create replacement baselines for **all twenty IDs in this table**.

Routine implementation choice: keep the immutable original 82-image approval/hash validation and add a separate hash-bound, owner-approved retirement record. This preserves the historical evidence and the active 62 assertions while making the temporary exception explicit and reviewable. It avoids generating interim goldens before F4.1. This is checkpoint/retirement authorization, not Task 19 formal approval or F4 completion.

#### Task 16 recovery Rule 28 — controller evidence for the retirement selector

Phase A changed only `scripts/test/visual-index.spec.mjs`. Main observed **14 expected assertion failures / 7 passes**: retired selection still returned a baseline path, twelve invalid-record cases were accepted, and the explicit required policy-data assertion failed. No setup/import failures. RED log SHA-256 `3d2e84fcd863960f9241ad16526982cd6a3d7a071c16adb18ba9efbc921e7071`. Phase B changed only the existing resolver/declaration, compare-only screenshot wiring and the new retirement record; full file-inventory gates passed and the pending Rule 27 test was unchanged. Controller GREEN **21/21** kept the identical frozen test SHA-256 `e2d83c0b0eaabd84946a171252d0ff40ed0cb7efe98645fb30c6d39c068f0a1d`; GREEN log SHA-256 `98563be7856ff87eec0a141a6a11497c7141709902e13f34c43bbcfbc2c86feb`. Main review preserved update mode's ability to create a missing baseline by keeping the new resolver call compare-only.

After GREEN, Prettier made whitespace-only test formatting changes; a separate controller rerun passed **21/21**, test SHA-256 `9f7f2878cb78aec6c591a310c616ea6dbaedd0ac3ede7b606531ffa2c8a0863b`, log SHA-256 `c0242c7b884a5cb54d0d47b6259a1687fa8e96e24be3af432ea987ce0a0739b6`. This formatting rerun is not relabeled as the original frozen RED/GREEN pair. Full Node tooling **180/180 passed**, log SHA-256 `705c877edb4bca5e1cb345f21caa665e6845c08777f9059ad32e5435a823676c`. Backend typecheck, focused lint and formatting passed.

Using the retained Linux producer artifact, the pinned Playwright public buffer comparator passed all **62 retained screenshot comparisons** at the unchanged options; a further twenty checks verified retirement metadata only, not screenshots. Comparison log SHA-256 `52f0a1c22657afa246acbbbbdd153a686dd677da22f4e1e96bbffd85b472f32d`. This reused the already verified Linux PNGs; it is not a new render or final-head Compose evidence. Logs/JSON records are under ignored `.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-28-*`. All 82 original baseline/index/approval hashes were checked again and remain unchanged. Main spec review confirms exact selection and preservation of the 62 options; quality review checks immutable hash binding, fail-closed metadata and compare-only wiring. Task 16 still requires its remaining recovery proof and final task review.

CI at pre-retirement producer `2264736`, [run 43443137080](https://github.com/pahle/lexon-ai-v6/actions/runs/43443137080), is **not green**: the separate security diagnostic passed, while the old screenshot assertions failed as expected, the paused-old-worker crash test failed its replacement-output assertion (1244/1245 unit/integration passed), and the history E2E missed mounted title invalidation. These are retained as unresolved observations for scoped diagnosis, not hidden or treated as fixed by this screenshot amendment.

Scoped review found one invalid-record validation gap. Fix round 1 used an independent test-only Phase A: eight malformed calendar-date/rectangle cases each failed with the expected missing-exception assertion, followed by a source-only validator correction and **29/29 GREEN** with identical frozen test SHA-256 `57a868e0dc2ccf0e4461e0d0feabbceb6e1394d667e665ca450c92aa0f84581f`. RED log SHA-256 `b86218d2d1f7ac16bac000c88598a3497058c1133f65f6d58782c6fe5cd8fe7d`; GREEN `72d8c26bc0ec708985ce00bbddfbdeb8c90bbc7dcd058f9ba6184e416ce88d90`. The scoped re-review marked the finding **addressed** and spec/quality **pass**, without expanding scope. Full Node tooling after the fix: **188/188 passed**, log SHA-256 `465c44489a2dfac32f00b47f7f7dc3db06406af193f4126dac7cef87f0189f99`.

The broader local `pnpm test` observation during this checkpoint was **1244 passed / 1 failed**, not a clean suite: `evals/test/f4-chat-recovery.spec.ts` → `defaults deterministic evaluation cases to an empty list` exceeded the unchanged 5-second timeout during its context/start/drain/read/close scenario; the exact slow phase was not recorded in that run. Log SHA-256 `436165484f365cd9dce8f9e56676ab2fd7f41ac5d92b6d8f35125769be25a1c4`. The prior CI paused-worker case passed in this local run; that does not resolve the CI failure. This root run predates the final tool-only validation correction and overlaps test-only Rule 28 additions outside the Vitest suite, so it is not claimed as frozen-test or final-head evidence. No timeout or assertion was weakened. The evaluation timeout, CI worker recovery and title invalidation observations remain scoped Task 16 diagnosis work.

#### Task 16 recovery Rule 27 — real terminal expiry and PostgreSQL recovery

The new actual-workspace case retains the real live cursor while the prefix is held, completes the scripted answer with measured duration and no summary, then expires all three terminal Valkey keys. Earlier test-only observations used a fixture-only attribute on the real UI and re-read a cursor after terminal completion correctly cleared it. Those two failures are recorded as **test-observation errors, not application REDs**; only the new case was repaired to inspect real Markdown and retain the live cursor before completion. Older fixture-route cases and every production behavior remained unchanged. A preflight also moved the recovery request from APIRequestContext to browser fetch so the real page observer sees Last-Event-ID through Caddy.

Main then observed the intended **missing private-control capability** assertion: `expire` returned null, after live completion/PG output/timing passed. Log SHA-256 `ee7a0d39821be63e841acab80a26d912db5757afe691e10569e4306618806174`, frozen test SHA-256 `bc990f5789d40bb018c4cea780abb98f88363a4e4dfb54a6ca90b8dd2cb96ab3`. This authorized **only** `backend/test/e2e/chat-worker-main.mjs`: existing UUID-validated private control, real `PEXPIRE` 500 ms on events/guard/generation, observed positive PTTLs and a bounded 1.5-second existence check. It does not delete/trim/recreate keys or change production terminal TTL (3600 seconds), application recovery, or stream bounds. No application change was justified by this fixture capability RED.

Controller GREEN ran both complete chat browser/runtime projects: **14/14 passed**, 254.339 seconds including owned Compose build/start/cleanup, identical frozen test hash. The new expiry case took 5.7 seconds and proved completed canonical answer plus measured/no-summary label live and after reload; actual Caddy Last-Event-ID selected a reset snapshot from PostgreSQL, no reasoning text or duplicate assistant appeared, and a repeated expiry check found no recreated keys. Existing SIGKILL/restart recovery (1.2 minutes), Backend API restart (13.3 seconds), runtime branching/stop/retry, history/search, keyboard and twelve full-page axe scans also passed. Log SHA-256 `baba15143759835ae88d8dfabe15cbec3467fa0e7b2a7e76b8be3650f205c65b`.

#### Task 16 recovery Rule 29 — title catch-up reaches the mounted consumer

Main traced a deterministic gap consistent with the earlier history CI failure: open/error recovery invalidated TanStack queries, while the mounted thread title uses the existing local refresh-version callback and direct GET. That callback was only notified by live invalidation frames, so it could miss a change before subscription. The exact failing CI network order was not captured; this is not a claim that its sole cause was proven.

Test-only Phase A produced **2 expected RED / 15 pass** (`[]` versus `[null]`), log SHA-256 `1c1fb7c6f265bee783d1cc988d3d228b7b18323f24b6a5926cdf330852b7cdd9`. After the source-only gate, one line invokes the existing owner-scoped callback with null inside the admitted recovery path, after disposal/throttle guards. Query keys, query cancellation, 15-second coalescing, frame chat-ID callbacks and identity/tenant guards stay unchanged. Same-test-hash GREEN **17/17**, log SHA-256 `23fdf0d80c31f775384bc27fc40b8328cec1189cc0a4168a62453b22540c488f`, test SHA-256 `f51c60fcf52149de51defc7a78b9a60194c0598a0ab668d1085cd5e9a04a326e`. Full frontend **309/309** passed across 38 files. Main spec/quality review and independent scoped review passed. The unchanged real Compose history case passed in the Rule 27 combined run, including mounted title update.

The complete local `pnpm test --silent=false` then passed **1247/1247**, 192 files, 197.453 seconds; log SHA-256 `268c51faa7855391475ca0716e80b75c0fb639d3549b2c34d07b51a7cfd6c153`, frozen reference test hash unchanged. This is local working-tree evidence; final-head CI remains separately required. The already pushed retirement producer `ac3f9c9` also passed both Linux unit/integration and normal full Compose jobs in [run 43449517822](https://github.com/pahle/lexon-ai-v6/actions/runs/43449517822). That CI predates this title fix/new expiry case and is not claimed as their Linux evidence.

#### Task 16 recovery Rules 30–31 — diagnostic observations, no timeout/lease fix

Content-free phase markers were added only to the existing evaluation scenario, with its assertions, cleanup and 5-second timeout unchanged. A focused observation passed one selected case (the other ten were CLI-filtered, not removed or skipped in source); the default reporter hid successful console logs. The subsequent full root run with visible logs recorded context creation 1619 ms, start 70 ms, drain 513 ms, read 30 ms and close 247 ms. The earlier timeout's phase remains unknown. No timeout increase or product fix is claimed.

The paused-worker case now reports only fixed-name child events, status/version/sequence/safe error code and allowlisted fixture generation outcomes at the existing boundaries. Type preflight caught a nullable diagnostic field and was repaired in test code before runtime observation. Main focused run passed: replacement completed at run version 2/next sequence 2, error code null; attempts were unknown then succeeded, and the resumed old worker failed its stale claim without an extra effect. Log SHA-256 `1258affccc48192abf1052a85446b119bdfdaeb6b6e307114b1e9efc06f414d7`, frozen test SHA-256 `8c3013965c504ac4b08165f5a6a33c3d67d38e425be1c73031a7ff15a7b7cc43`. It also passed in the full root run. Existing output/attempt/stream assertions, pause order, 1-second test lease and waits remain unchanged. These diagnostics do not establish the older CI failure's cause or authorize a production lease change.

All controller JSON/logs and phase reports are under ignored `.superpowers/sdd/2026-11-09-f4-chat/recovery/`. Task 16 final scoped spec/quality review is still required before acceptance; Task 16A mutation evidence and all later handoff gates remain pending.

#### Task 16 final review and cardinality correction (Rule 32)

Fresh whole-Task-16 review of 9986616..28f6274 found one P2: multiple deterministic chat fixtures were accepted but silently disabled chat instructions/scoring. Routine contract choice: reject more than one fixture at public context creation and document one context per case; undefined/empty/default and singleton behavior stay compatible. This preserves the existing fixture flow and prevents a misleading generic pass without adding a selection API.

Phase A changed only the public-entry eval test with valid real test services and cleanup for an unexpectedly created context. The controller's first CLI filter matched zero tests; that run is explicitly not RED, GREEN or coverage and authorized no source change. The corrected exact test then failed as expected because the public promise resolved instead of rejecting: log SHA-256 f4a9de1c4ae95a62e6d0973dea560f09e309e4fa5cb9601fd82091653c0f5199. Only then did Phase B add the pre-setup guard and public contract comment. Full file-inventory gates passed. All 12 tests in the covering file passed with the identical frozen test SHA-256 ebf83892f56d108efddb4f5432685c3449f12958e32564effbf58544ddda77e5; GREEN log SHA-256 f14c3f5a0f3d1fececdec283a3afd98c2fedcc9d11be5e95b2080ef8adefbbac. The scoped re-review marked the P2 addressed and spec/quality pass, with no new finding.

The full local suite after this correction passed 1248/1248 across 192 files in 195.933 seconds, log SHA-256 1990e79ffc0280e842c3c035fee5f6c05e546430ce0f609a1674ed02e51ea500. Root lint and workspace typecheck passed; the changed backend/eval packages build and formatting are checked before the completion commit. Earlier chat runtime/browser evidence remains 14/14, including actual expiry and Caddy recovery; this isolated public-evaluation guard does not change chat runtime code. Main accepts Task 16 after reviewing the fresh verdicts and controller evidence. Task 16A's compensating mutation work and later smoke/load/visual/final-head gates remain required; no final F4 or owner visual approval is claimed.

Completion checks for the Rule 32 correction: root lint, workspace types, backend/eval package builds and full formatting all passed. The prior checkpoint 28f6274 also passed Linux unit/integration and full normal Compose E2E in [run 43453524248](https://github.com/pahle/lexon-ai-v6/actions/runs/43453524248), covering the title correction, new real expiry case and preserved legacy comparisons. That CI predates the small cardinality guard; its next push and the final-head jobs remain distinct evidence.
