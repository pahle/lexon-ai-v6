# F4 acceptance evidence

Status: implementation in progress. Tasks 1–9 accepted after review;
Tasks 10–21 are pending. This is not F4 completion or visual approval.

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

## Pending evidence

Chat UI, search and evals, owner-run high/max smoke and
calibration, S2 load, visual approval and Linux golden evidence remain pending.
No real model request, paid eval dispatch or account/admin change was made.
Production TLS/hardening stays F20; P8 physical-region verification and F17
unknown-attempt cost reconciliation remain explicit follow-ups.
