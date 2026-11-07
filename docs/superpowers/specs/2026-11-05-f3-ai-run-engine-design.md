# F3 — Headless AI Run Engine design

Date: 2026-11-05. Status: approved by the product owner; approved implementation plan in progress.
Branch: `f3-ai-run-engine`, based on `origin/main` at `63c26f9`.
Tasks1–2 foundations are implemented and accepted; later tasks remain pending. This document incorporates the owner's corrections
in the F3 brainstorming conversation; those supersede erroneous brief wording.

## Intent and scope

Build the single feature-agnostic engine for all later interactive and batch AI
work. Durable state lives in PostgreSQL; BullMQ delivers work at least once;
Valkey Streams carry expendable live delivery. Features later register profiles,
context providers, and tools without adding feature branches to the engine.

F3 is headless: no run HTTP routes, SSE hub, frontend changes, conversations,
product profiles, real product tools, approval UI/expiry, retrieval, memory,
workflows, or subagents. Existing F2.1 presentation and goldens are untouched.
Mock tests and evals use the real engine. One fixed synthetic operator prompt
exercises real routing; no client content is sent in F3.

Success includes crash recovery, tenant isolation, bounded attempts and budgets,
capability enforcement, transactional tool effects, safe telemetry, and measured
queue-hop latency. A passing happy path without crash and concurrent-delivery
proof is insufficient. No new workflow framework or tokenizer dependency.

## Authority and existing system

Read the F3 brief and LEX-TS-001 v1.11; LEX-ARC-001 sections 3.1–3.2,
3.4–3.6, 4.1, 4.7, 5.1, 5.3–5.4, 6.1–6.2, 6.4, and 7.1–7.3 govern this
slice. LEX-DS-001 adds no UI requirement because this slice has no UI.

F0 already provides `withTenant`, opaque tenant sessions, ID-only outbox jobs,
NOTIFY/poll dispatcher with claim leases, BullMQ integration, and
`ops.processed_jobs` keyed by outbox UUID. Its `JobExecutor` invokes a handler
inside the receipt transaction. That transaction must NOT span model calls.
F3 retains this executor for final transactional effects and adds durable step
coordination around it, rather than weakening receipt semantics.

F1 provides membership/organization facts and authorization policies. Workers
must not load Better Auth, HTTP controllers, SMTP, or a privileged database role.
Infrastructure may not import domain modules. Database repositories remain
inside infrastructure/db; policy decisions remain in domain services.

The existing evaluation entry only boots a standalone context and returns the
version. Extend `@lexon/backend/evaluation`; evals never deep-import backend.
The allowlist already requires provider, region, literal ZDR true and review date.

## Approaches considered

1. A job runs the whole loop until terminal or approval pause, with short durable
   transactions. Fewer queue hops, but a larger recovery unit and a new long-lived
   execution path alongside F0's executor.
2. A job advances one durable step, committing its effects and next-step outbox
   entry atomically. More queue traffic, but explicit recovery boundaries and
   bounded jobs that build on the existing outbox and receipts.

The product owner selected approach 2. Measure its actual hop before considering
optimizations; do not replace F0's dispatcher or add a workflow framework.

## Ownership and extension boundaries

- Chat owns engine orchestration, lifecycle, steps, checkpoints, operations,
  registration, and capability-policy invocation; it exports application services.
- Usage owns attempt accounting and budget ledger behavior, exposing services
  usable with the caller's `TenantSession` so cross-domain commits are atomic.
- Identity & Access exposes worker-safe authorization facts through its public
  contract without composing the auth runtime. No SQL/auth SDK use in Chat.
- Platform owns job registry/execution and existing dispatcher integration.
- infrastructure/ai alone imports AI SDK and OpenRouter; exposes a typed neutral
  single-generation adapter, stream events, and test composition. It does not
  decide capabilities or import Chat/Usage.
- infrastructure/queue owns producers, processors, cancellation transport, and
  bounded stream publishing; infrastructure/telemetry owns safe instrumentation.
- shared owns versioned job and stream schemas, status/error enums and portable
  contracts; no provider SDK types, Node APIs, or business logic leak there.

Registration is explicit Nest composition. Production registries contain no
product feature. The smoke tool directly uses the guarded model adapter; its
fixed prompt is not a production Chat profile. Tests/evals register fixtures
through the public evaluation factory, not production environment flags.

## Durable data

All content/usage/operation tables are in `app`, carry `org_id`, enable and FORCE
RLS, and are accessed through `withTenant` plus the authorization predicate.
Use composite tenant/run foreign keys so a child cannot reference another org's
run even with a forged payload. Negative tests include fresh/reused no-context
connections. IDs in `ops` never carry prompt, output, arguments, or credentials.

Conceptual records (builder chooses exact SQL names/indexes):

| Record                | Durable facts and uniqueness                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run                   | org, initiating user, immutable profile/version and resolved config/model, input, status, run version, next sequence, model iteration count, budgets, partial/final output, safe error, timestamps    |
| Step                  | run and monotonically increasing sequence (unique), work kind, expected run version, state, execution lease/fence, committed model response and tool proposals                                        |
| Attempt / usage event | unique attempt UUID, run, step, attempt ordinal, model/provider/region evidence, reserved input/output, reported token counts/cost nullable, generation id nullable, active/outcome facts, timestamps |
| Checkpoint            | run/step/attempt/fence, partial assistant output and progress; provisional until successful step commit                                                                                               |
| Operation             | stable UUID, originating committed step/tool-call identity, tool/version, arguments, canonical snapshot hash, declared idempotency mode, approval/execution states, stored result, safe reason        |

An attempt is persisted BEFORE a network call. Its settled outcome is
`succeeded`, `failed`, or `unknown`; while in flight it is explicitly active
(not falsely labeled succeeded/failed). Recovery fences a lost owner before
settling its active attempt as unknown. A unique attempt ID gives one usage row;
unknown counts and cost are NULL, never zero. The active lifecycle representation
may be a separate state/settled flag; it must distinguish live from recovered.
Cost uses exact decimal storage, not floating-point currency arithmetic.

## Step and delivery protocol

The scheduling sequence identifies a durable advancement job. Model iteration
count is separate: approval continuations and recovery must not accidentally
consume another model iteration. An approval pause commits its sequence;
resumption receives the next sequence and a distinct job/outbox ID. Never reuse
a consumed receipt for a resume job.

Derive an outbox UUID deterministically from a fixed namespace plus run UUID and
sequence (standard name-based UUID with Node crypto, no new dependency).
This reconciles the owner's run+sequence job identity with F0's
`BullMQ jobId = outboxId`. Extend the outbox append API narrowly to accept the
validated deterministic ID; other callers retain random UUID behavior. Unique
constraints reject conflicting payloads for the same derived ID.

Versioned start/resume/advance envelopes carry only IDs, sequence/version, and
tenant context. Queue and priority are resolved from the immutable server profile,
never accepted as caller policy flags. Support ai-interactive and ai-batch with
separate configured concurrency; preserve F0 retention/backoff policies unless
research/testing demonstrates an explicit change is required.

1. Start validates caller/profile/model/capabilities and creates run, initial
   step and outbox row in one tenant transaction. A non-allowlisted model is
   refused before any provider network request.
2. Delivery validates the envelope. A missing/cross-tenant run, terminal run,
   already committed step, or old sequence produces no model call or stream event.
3. A short transaction claims the expected sequence/version with a durable lease
   and monotonic fence. Only one live owner may progress. Concurrent delivery
   while the claim is valid cannot acknowledge the run as completed; it defers
   safely. After ownership loss, stale workers cannot write checkpoints, effects,
   usage settlement, continuation, or active stream content.
4. Load committed history and recompute policy at start/resume. Reserve and
   persist an attempt under the claim before opening the model stream. No row
   lock/tenant transaction is held while waiting on the provider.
5. Consume a single generation through infrastructure/ai; periodically save
   provisional partial output and capture early generation metadata. Tools are
   proposed here, not automatically executed from uncommitted model output.
6. Commit the successful generation/step through F0's receipt executor in one
   short transaction, checking expected version/sequence AND current fence/state.
   Record final attempt usage, step output, operations/results as appropriate,
   status/version advancement, and next outbox entry together. Receipt and
   effects commit together. Previously settled failed attempts remain recorded.
7. The next job uses the same profile queue/priority. A final output, usage
   settlement and completed state commit together; no continuation is created.

A lost optimistic check is a harmless late delivery; no second effects or next
outbox entry. A claimed step that cannot finish leaves recoverable durable work,
not an irrevocable admission receipt. Claim expiry/renewal is configurable and
tested with actual concurrent deliveries, process death and delayed old workers.
A stale local worker must abort once it loses its claim. Queue attempts and
model-attempt limits are separate; BullMQ redelivery cannot reset model budgets.

## Attempts, reservations, and failure recovery

Owner correction: model requests may repeat and incur another charge. Logical
step effects commit effectively once; usage is per attempt, NOT once per step.
Default maximum model attempts per logical step is 2, configurable per profile.
The sole retry controller is the engine: SDK `maxRetries: 0`. Outgoing-request
tests prove a provider error causes one request per persisted attempt.

Proposed estimator (builder call for approval): one function measures the UTF-8
byte length of a canonical serialization of ALL model-visible system/context/
history/tool-result text and tool schemas, plus 64 tokens per message, 256 per
tool definition, and a fixed 1024-token framing allowance. This deliberately
reserves more than characters/3, especially for non-ASCII legal text. No new
tokenizer dependency. Record estimator version, estimate and maxOutputTokens on
each attempt. Restrict F3 model input to text/tool JSON; do not pretend the
formula accounts for future images, audio, or provider-executed tools.

Reservation = estimated input + enforced maxOutputTokens for that call. Both
profile attempt limit and remaining run budget must permit a request. Compute
remaining budget from PostgreSQL, including all unknown and in-flight reserves;
never just from in-memory counters. Successful/failed attempts with reported
usage replace reserves with reported usage; absent usage retains the reserve.
Unknown retains its FULL reserve for the rest of the run. Retry must fit its
own additional reserve. Otherwise fail safely and preserve partial output.
Reported input/output and cached/reasoning breakdowns use provider totals, not
only visible text. Cost is recorded only if provided, never invented from text.

Owner-approved guarantee: CONSERVATIVE ADMISSION, not an absolute billing ceiling.
Every call sets the profile's enforced maxOutputTokens, hard-bounding output;
reservation overrun can therefore come only from input estimation. The estimator
is not a provider-certified exact token count. If reported usage exceeds the
attempt's reservation, persist the actual usage and partial output, fail the run
with the safe budget error code and permit NO further model calls, including on
redelivery or resume. Unknown reservations remain in force. Never misstate actual
usage to make the ledger fit the budget.

Persist estimated versus reported INPUT tokens separately on every attempt,
along with estimator version, to enable calibration. The fixed real smoke also
runs a small calibration assertion using the SAME estimator and its reported
input usage. Record estimated input, reported input, and the explicitly defined
ratio estimated/reported in acceptance notes. If usage is unavailable or zero,
report the ratio as unavailable rather than inventing a number. Test arithmetic
and missing/zero usage handling without network; actual smoke is the real-model
calibration evidence. Smoke still writes no application attempt/usage rows; its
numeric calibration result is operator evidence only.

F17 owns improved estimation and unknown-attempt reconciliation. The operator-
configured OpenRouter KEY CREDIT LIMIT is the last external safeguard for BOTH
ai:smoke and real evals and is part of the attestation prerequisite. F3 does not
set or inspect that limit using admin APIs.

Worker dies after receiving a response but before commit: old attempt becomes
unknown, retains reserve and any generation ID already saved; recovery publishes
reset for provisional output and creates a NEW attempt if allowed. Only one
successful step output commits. Never reconstruct tool effects from an unknown
attempt's transient chunks. A committed step's stored operations/results are
replayed without regenerating that step or duplicating a tool effect.

Retries are only for allowlisted transient transport/provider failures, with
bounded backoff (proposed 250ms then capped; at default 2 attempts only one wait).
Do not retry validation, forbidden model/provider, denied capability, exhausted
budget, stale decision or permanent authentication failures. Map all raw SDK/
provider exceptions to finite safe codes before persistence, logging or events.

Task 5's neutral terminal outcome carries an explicit required `retryable`
boolean for Task 9. It is true only for the bounded transient HTTP status set
408/429/500/502/503/504 or a recognized SDK/network transport failure; permanent
validation/authentication responses, caller abort, completed outcomes, and
unclassified exceptions are false. Task 9 must require `retryable === true`
before applying the approved backoff. Authoritative `length` finishes count as
completed attempts; `content_filter` is a nonretryable failed attempt. Both keep
reported usage/cost. An interrupted stream or synthetic SDK error finish without
authoritative provider completion remains unknown.

## Tool contract and durable execution

Each tool declares ID/version, Zod arguments, read/write classification,
approval requirement, timeout, result byte limit and capabilities. Every write
tool MUST declare one idempotency mode; invalid registration fails at boot:

| Mode            | Contract                                                                   | Unknown-outcome recovery                                                |
| --------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| transactional   | Effect, receipt and stored result use the SAME supplied tenant transaction | Read operation receipt/result; retry only if not committed              |
| idempotency-key | Remote adapter must send operation UUID as idempotency key                 | May retry using exactly that same key                                   |
| reconcile       | Adapter supplies a remote check keyed by operation UUID                    | Reconcile before another execution; undecidable becomes outcome_unknown |

Read tools require no mode. Registration also rejects missing required callbacks
for the declared mode. Only transactional execution is implemented in F3;
external modes remain discriminated typed cases and unit-tested recovery
choices, not production-ready remote adapters. Real implementations belong to
F5/F14/F16. A runtime attempt to register an unsupported execution adapter fails
closed rather than falling back to unprotected execution.

Persist operation arguments, canonical snapshot hash, mode and stable ID BEFORE
execution. Identity includes committed step and tool-call occurrence; don't use
a fresh retry-generated provider call ID or just arguments as the durable key.
Two identical intentional calls are different operations; retries of one stored
operation reuse its ID. No tool executes directly from partial/uncommitted
model output. Transactional handlers are bound to the tenant session: they do
not perform remote writes. Their effect, result and receipt roll back together
on timeout/failure. Do not use a timeout Promise race that lets writes continue
after the session closes; cancellation must stop/rollback the transaction.

Permission is rechecked immediately before execution. Missing capabilities mean
the tool is not advertised, and a forged call is refused anyway. Model-supplied
flags never grant capability. Write tools still require approval as configured.
An outcome_unknown operation is not re-executed and is represented in the stored
result, model input and run event schema using a safe status, no raw error.

## Approval and authority

Approval pause persists the exact operation/snapshot and awaiting_approval in
the step commit, publishes approval-required, and ends the job. No worker slot
or transaction waits for a human. A decision validates the snapshot, initiating
user identity and CURRENT membership/permissions through one capability-policy
function. Only the initiating user may approve OR reject in F3. Organization
owner/platform-admin roles grant no substitute authority. Break-glass is not an
impersonation path. Broader project-chat approval is a future F6 policy extension.

Accept a decision once under lock/CAS; stale hash or second decision is refused.
Accepted decision and next-sequence resume outbox entry commit atomically.
A non-initiating caller's refusal does not sabotage someone else's valid run.
If the actual initiator has lost access at decision time, reject the pending
operation with safe reason and fail the run atomically; do not leave it waiting.
Resume rechecks the same policy before executing. Access loss there likewise
rejects/fails without an effect. Approved operation executes once; a legitimate
rejection is supplied to the model as a tool rejection result so it can finish.
Unanswered approval expiry remains F5.

## State machine and cancellation

Explicit transitions: queued→running; running→running at a step boundary;
running→awaiting_approval/completed/failed/cancelling;
awaiting_approval→running on authorized resume, or failed/cancelling;
queued→cancelling; cancelling→cancelled. Terminal states cannot transition.
Retries recover work ownership without reviving a terminal run. Tests cover
every permitted and forbidden pair; a diagram's arrows are not the whole rule.

Cancel is idempotent for terminal/cancelling runs. It commits cancelling and
signals the worker; AbortSignal aborts the real provider request. PostgreSQL
status polling is the fallback when Valkey control delivery fails. A queued or
approval-paused run with no active owner may become cancelled immediately in
the same short transaction, rejecting pending work. An active worker/recovery
owner preserves the latest partial output once and commits cancelled. Completion
and cancel serialize on version/state: once cancelling wins, completed cannot.
If completion committed first, cancel is a no-op.

Transactions and fenced stream publication prevent old workers from appending
after terminal publication. A job starting after cancelled/failed/completed
performs no model call and no events. Cancellation cannot undo a tool effect
already committed; it stops subsequent work. A transactional tool effect races
cancel under the same run-state lock/version check, so their commit order is
explicit and tested.

## Streaming and context safety

All jobs use the SAME `run:{runId}` stream. Wrap AI SDK UI message stream parts
in a versioned shared contract with Lexon status/reset/approval-required/finish/
error and operation-status events. Preserve message/text part identity across
successful step boundaries; close/reopen parts according to the pinned SDK
protocol. No per-step finish falsely terminates the run. A queue hop may cause
a status event and ordinary scheduling delay, never a new stream or lost history.

Use XADD with configured MAXLEN, bounded writes and TTL after terminal state.
Suggested builder defaults: exact MAXLEN 10000, terminal TTL 3600s,
checkpoint interval 1000ms with a size threshold to avoid per-token DB writes.
Validate limits at boot. Stream keys contain no K1 beyond the intended tenant
run events; payloads aren't diagnostic logs. F4 supplies authorized SSE/replay.

A single serialized publisher per execution fence orders its writes. A guarded
Valkey operation rejects stale fences/sequence events and rejects all appends
after terminal closure, including late async chunks. Coordinate ownership
changes and terminal markers so a recovering worker cannot emit a reset after
a final event. Any guard key is bounded and expires with the stream.
The ordering promise is specifically that no event follows the terminal stream
marker, not that a PostgreSQL commit and a Valkey append are cross-store atomic.
The terminal marker and closed guard commit in one Valkey script. Every producer
checks the durable claim/state before publication; after a disconnect it discards
buffered deltas and reloads PostgreSQL status before publishing again. A terminal
run only publishes its terminal marker through the finalization path, never more
deltas. The closed guard cannot be reopened by an old producer, even after TTL:
only a current PostgreSQL-authorized execution may initialize a stream guard.
During an outage there may be no terminal event; database status remains final.
Tests pause an append against terminal publication and reconnect a stale producer
after cancellation, asserting no writes follow the final stream marker.

Valkey failure never rolls back a committed step or prevents PostgreSQL progress;
no unbounded stream buffer. PostgreSQL checkpoint/status is authoritative. On
recovery after a gap, emit reset from durable state before current deltas when
possible. Complete history/reliable live replay during an outage is not promised.

Context providers have individual token budgets and return data, not tool
permission. Fence each untrusted piece with a fresh unpredictable nonce and
explicit data-only instruction; ensure supplied content cannot reproduce the
chosen delimiter (regenerate/escape). Apply equally to context and tool results.
Truncate tool results by UTF-8 size with an explicit marker without invalid JSON/
Unicode, then fence before model reuse. Never treat fencing alone as an injection
security guarantee: policy and approval enforce writes independently of the model.

## Model routing, privacy and operator tools

Reviewed per-environment allowlist starts with
`{id:"openai/gpt-6-luna",provider:"azure/us",region:"us"}`. Here
`provider` is the exact OpenRouter route slug, not the OpenRouter SDK gateway.
Every request enforces provider.zdr=true, data_collection=deny, exact reviewed
provider restriction and order, and allow_fallbacks=false; never accept request overrides.
No provider tools, web plugins, or alternate gateways. No API/document-worker key.
Key/config validation prints field names/safe codes only. Reject unknown model
before network access. Tests inspect actual outgoing body, not only config objects.

Region remains a preproduction P8 decision. F3 uses synthetic input only.
Choose a reviewed Azure endpoint/region for development explicitly; do not infer
a concrete region from response provider name Azure or a global router label.
Smoke acceptance must identify exactly what endpoint/region evidence is available
and cannot claim an unobserved physical region. Any unsupported regional evidence
must be resolved before accepting that criterion, not filled in with a guess.

Owner configures account/guardrail to ZDR ONLY, excludes Safety Retention for both
Google and other models, disables prompt/response logging, and configures the
key credit limit (LEX-ARC-001 section 7.3). The dated attestation covers all three
prerequisites. Codex never edits
account settings and makes NO OpenRouter admin API calls. Real smoke/evals require
LEXON_OPENROUTER_ZDR_ONLY_VERIFIED as a valid ISO date, supplied as local env /
repository variable respectively. The shared real-model adapter enforces this prerequisite, including the AI
Worker whenever it opens a real request. Missing/invalid attestation refuses
BEFORE network and explains the settings to configure. Attestation isn't a key and
cannot disable request-level privacy. Record actual verification date, observed
provider/region and zero admin calls in acceptance notes; do not invent dates.

ai:smoke refuses missing key/attestation, sends one fixed synthetic prompt through
the real guarded adapter, prints model/provider/tokens/cost and numeric estimator calibration ONLY, stores nothing
in run/usage tables and never prints model content or secret-bearing exceptions.
It has a small enforced output cap and request timeout, no engine profile needed.

Disable AI SDK input/output recording in ALL F3 environments, not merely prod.
No raw chunks/debug echo, raw provider bodies, headers, prompt/output, tool args/
results, exception messages, or K2 in logs/spans/Sentry/queue errors. OTel spans
for run/step/model/tool use approved IDs/sizes/durations/status only. Use the
locked @ai-sdk/otel integration with recordInputs/recordOutputs false and reviewed
safe attribute filtering; generic errors rather than recordException(rawError).
Tests capture logs, spans, errors and failures with sentinel K1/K2 values.

## Evaluation, CI and acceptance evidence

Mock PR evals boot the public backend evaluation entry with test registrations:
completion, cancel, iteration/token/attempt limits, approval approve/reject/access
loss, unknown attempt retry and tool idempotency, hostile context/tool results,
and cross-tenant refusal. No network and no real key. Mock scenarios assert policy
and effects; they do not claim to measure real-model instruction-following quality.

Integration uses existing once-per-run Testcontainers global setup with shared
pinned image manifest and per-file cloned databases/Valkey prefix/S3 bucket.
pnpm test and package filters require no prestarted stack. Process crash tests
use test-only IPC barriers, not production failpoints. Full Compose E2E remains
a separate CI layer and verifies actual runtime composition/key separation.

Measure actual step commit→outbox dispatch→next worker claim, excluding model
latency. Record environment, samples, median/p95/max and component timestamps;
use local monotonic timing where same-process, DB timestamps for cross-process
comparison. Suggested sample size 20 warmed hops plus cold start separately.
If a representative local hop exceeds roughly 500ms, STOP and report before any
workaround; do not silently hide the result in an average, raise limits, replace
the dispatcher, or introduce polling optimizations.

Manual/scheduled real evals use synthetic fixtures, protected secret and required
attestation repository variable; never run on PR/fork events or untrusted refs.
Score-only output. Apply an OpenRouter environment/eval-key spending cap as the
hard external backstop plus conservative local call reservations, model max
output, request/time/call limits and disabled SDK retries. F3 never sets/checks
that cap through admin endpoints; operator setup is explicit. Exact monetary cap
and schedule are builder-proposed config defaults documented in the plan.

Fix ci.yml stale feature-branch push list to main per brief; PR CI continues to
cover the F3 branch. Do not weaken existing boundaries/tests/mutation scopes.

Required additional proofs: two concurrent deliveries yield one active step and
one committed result; late/terminal jobs are silent; crash after model response
creates unknown+new attempt but one output and no duplicate effect; early
generation-ID persistence; no hidden retries; durable budget after restart;
registration rejects write-without-mode; typed external recovery decisions;
atomic continuation rollback; cancel while streaming and with Valkey unavailable;
state/stream protocol validity; TTL/MAXLEN; permission loss at both approval
boundaries; no cross-tenant reads/writes on EVERY new table; no K1/K2 leakage.

## Deferred work and builder decisions

F17: reconcile unknown-attempt cost using saved generation IDs, improve estimator,
customer quotas/blocking and usage views. Unknown-attempt reconciliation is NOT
performed in F3, including via generation/admin endpoints. F5/F14/F16 implement
real external write adapters under the enforced idempotency contract. F5 owns
approval API/UI/expiry. F6 may widen approver policy. F4 owns Chat/SSE/transport.
P8 owns production region/privacy/cross-border review. No production K1 execution
is authorized by successful synthetic smoke.

Builder may choose names/indexes, exact claim renewal/backoff/timeouts within
these invariants, fixture structure, Zod discriminated unions, and documented
numeric defaults. Do not add speculative subagent scheduling or a parallel
membership/authorization model. Clarify any remaining product-impacting ambiguity
before planning instead of quietly broadening the engine.

## Research notes

### Task 12 queue exhaustion and retained delivery verification (2026-11-06)

- BullMQ QueueGetters API, v6.5.3: https://docs.bullmq.io/api/classes/v4.QueueGetters.html — read 2026-11-06. `Queue.getFailed(start, end)` returns a zero-based page of failed jobs. This supports bounded restart scans of retained exhausted deliveries.
- BullMQ retry guide: https://docs.bullmq.io/guide/jobs/retrying-job — read 2026-11-06. Failed jobs remain in the failed set until explicitly retried or removed; the finalizer therefore removes a durable delivery only after PostgreSQL confirms terminal or stale status.
- Installed BullMQ source: `backend/node_modules/bullmq/dist/cjs/classes/queue-getters.js` and `backend/node_modules/bullmq/dist/cjs/commands/moveToFinished-14.lua`, package 6.5.3 — inspected 2026-11-06. `getFailed` pages the failed set; final attempt count is enforced atomically by BullMQ and terminal failure also covers stalled-job failure handling. This supports failed-set membership as the scan predicate instead of parsing error strings.
- Installed Node.js 24.22.1 docs were fetched with `node scripts/fetch-docs.mjs nodejs` — read 2026-11-06. AbortSignal and timer APIs used by cancellation/shutdown are available at the pinned runtime.

Read 2026-11-05. Installed exact versions checked, not inferred from memory.
Planning must revisit relevant official docs per task; these notes identify the
verified starting points rather than authorizing unverified future APIs.

| Source                                                                                                                                                                                                                                 | Version / evidence                                                                                                                                                                   | Decision supported                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [AI SDK generation](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), installed ai/docs and src/generate-text/stream-text.ts                                                                                                       | ai 7.0.159, matching package.json and CHANGELOG (7.0.154 lifecycle errors; 7.0.155 validation changes; 7.0.157 stream type graduation)                                               | Single-generation adapter; explicit runtime schemas; maxRetries defaults to 2, must set 0; async chunk handling                                                                                                                                  |
| [Tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [loop control](https://ai-sdk.dev/docs/agents/loop-control)                                                                                                       | AI SDK 7; current toolApproval and single-step stopping; domain owns durable scheduling                                                                                              | Do not let SDK auto-execute an uncommitted tool proposal or run an unbudgeted next call; approval ends work rather than holding a worker                                                                                                         |
| [Mock testing](https://ai-sdk.dev/docs/ai-sdk-core/testing), existing ai-compatibility.spec.ts                                                                                                                                         | installed ai/test MockLanguageModelV4, existing F0 proof                                                                                                                             | Network-free engine/evals using matching stream contract                                                                                                                                                                                         |
| [UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)                                                                                                                                                                | AI SDK 7; verify exact event shape against installed definitions during planning                                                                                                     | Versioned shared stream parts; one run-wide stream, reset semantics                                                                                                                                                                              |
| [Provider README](https://github.com/OpenRouterTeam/ai-sdk-provider), installed README and dist/index.js                                                                                                                               | @openrouter/ai-sdk-provider 3.1.0, v4; emits response-metadata with ID as soon as a chunk exposes it; usage cost under providerMetadata.openrouter.usage                             | Capture generation ID at adapter stream boundary BEFORE SDK consumes internal metadata; do not wait for final response promise                                                                                                                   |
| [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)                                                                                                                                                       | Live routing docs; provider only/order/allow_fallbacks/data_collection/zdr; base slugs can span regions                                                                              | Explicit privacy/no-fallback preferences; don't mistake provider base slug for regional evidence                                                                                                                                                 |
| [ZDR](https://openrouter.ai/docs/guides/features/zdr)                                                                                                                                                                                  | Live docs, October 2026 Safety Retention distinction                                                                                                                                 | zdr true alone follows account/guardrail Safety Retention choice; owner-approved strict account prerequisite/attestation; no provider plugins                                                                                                    |
| [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and installed provider README                                                                                                                  | 3.1.0 usage include + cost metadata                                                                                                                                                  | Persist known usage/cost per attempt; no admin reconciliation in F3                                                                                                                                                                              |
| [Model endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints), [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr)                                                                                        | Public unauthenticated endpoints; Azure tags azure, azure/us, azure/eu observed; filtered endpoint output had no separate region field                                               | Availability research only; doesn't prove the location actually used by a smoke request                                                                                                                                                          |
| [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs), F0 versions/findings                                                                                   | installed BullMQ 6.5.3, @nestjs/bullmq 12.0.0, Nest 12.3.2                                                                                                                           | Preserve outbox ID job identity and durable receipts; don't rely on queue-ID retention for effects                                                                                                                                               |
| [Valkey XADD](https://valkey.io/commands/xadd/), [EXPIRE](https://valkey.io/commands/expire/), vendor app-queues skill                                                                                                                 | pinned image 9.0.7, ioredis 6.0.0; exact versus approximate MAXLEN                                                                                                                   | Bounded run streams, terminal TTL; BullMQ remains the work queue                                                                                                                                                                                 |
| [Nest standalone](https://docs.nestjs.com/standalone-applications) and current evaluation/worker composition                                                                                                                           | Nest 12.3.2 and existing no-HTTP factory                                                                                                                                             | Extend single public evaluation entry; worker excludes auth runtime                                                                                                                                                                              |
| [OTel Node instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), [AI telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)                                                                                | Current @ai-sdk/otel registration; SDK docs state inputs/outputs record by default when registered                                                                                   | Explicit false recording and safe spans; exact new telemetry package pins/peers must be researched before plan tasks                                                                                                                             |
| [Vitest global setup](https://vitest.dev/config/globalsetup), current workspace configuration                                                                                                                                          | Existing root package-prepare global setup plus backend integration global setup; no per-test containers                                                                             | Extend existing per-run isolation rather than creating another stack                                                                                                                                                                             |
| [Telemetry package metadata](https://www.npmjs.com/package/@ai-sdk/otel), official npm metadata read through pnpm view                                                                                                                 | @ai-sdk/otel 1.0.163; @opentelemetry/sdk-node 0.300.0 peers @opentelemetry/api >=1.10.0 <1.11.0; api 1.10.0                                                                          | Research candidates only, no dependencies installed; verify SDK compatibility, changelog and exact pins during planning                                                                                                                          |
| [Drizzle migrations](https://orm.drizzle.team/docs/migrations), installed db README/F0 findings                                                                                                                                        | drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1                                                                                                                                   | Append-only migrator migrations, no schema push; repositories stay inside db boundary                                                                                                                                                            |
| [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html) | PostgreSQL 17 docs read 2026-11-05; installed/pinned 17.11 image; owner enabled FORCE RLS and uses NULLIF tenant policies                                                            | Capacity trigger serializes admission through the singleton row; tenant table access remains default-deny without context; no SECURITY DEFINER run lookup; trigger functions use fixed qualified names/search path and restricted execute grants |
| [Drizzle migrations](https://orm.drizzle.team/docs/migrations), installed `drizzle-orm/node-postgres/migrator.js`, existing `0014_admin_setup.sql` and `_journal.json`                                                                 | Drizzle 0.45.4, drizzle-kit 0.31.11; installed `readMigrationFiles` splits at `--> statement-breakpoint`, hashes journaled SQL, reads each journal tag in order                      | Add one append-only `0015` SQL file and journal entry, use statement breakpoints, preserve migrator-owned migration path and existing SQL conventions                                                                                            |
| F3 design sizing addendum and [measured stream memory JSON](../../references/F3-stream-memory.json)                                                                                                                                    | Owner-approved MAXLEN 1024, max serialized event 4096 bytes, slot 6,291,456 bytes; observed 5,269,728 bytes for 1024 entries at 4096 bytes on pinned Valkey 9.0.7 image (2026-11-05) | Keep values in config; derive active capacity as `floor(memoryBudgetBytes / slotBytes) - terminalSlots` (default budget 30 slots yields 24 active plus 6 terminal); enforce org active cap 6                                                     |
| F0 db/queue/ai READMEs, JobExecutor/OutboxDispatcher, public evaluation entry, F0-versions and F0-S6-findings                                                                                                                          | main 63c26f9, actual current code read                                                                                                                                               | Preserve receipt transaction and NOTIFY wake-up; add short claims rather than model I/O inside existing executor                                                                                                                                 |

### Task 10 research addendum (2026-11-06)

| Source                                                                                                                                                                                                                      | Exact version / date read                                                                                          | Decision supported                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PostgreSQL 17 client connection defaults](https://www.postgresql.org/docs/17/runtime-config-client.html), [SET](https://www.postgresql.org/docs/17/sql-set.html), installed pinned Testcontainers image `postgres:17.11`   | PostgreSQL 17.11; official docs read 2026-11-06; integration tests verified server timeout code `25P04`            | `statement_timeout` only aborts an individual SQL statement. `transaction_timeout` terminates a session after the total explicit transaction duration; use transaction-local `set_config`, expire the application TenantSession at the deadline, and never commit after timeout. Backend termination rolls back the transaction; destroy the dead checked-out client rather than return it to the pool. |
| [node-postgres client API](https://node-postgres.com/apis/client), installed `pg@8.23.1` package/source (`lib/client.js`)                                                                                                   | `pg@8.23.1` exact backend pin and installed source inspected 2026-11-06; package does not include a CHANGELOG file | Do not rely on `Client.cancel` internals as an abort API. Supervise the transaction through PostgreSQL's server timeout, observe the checked-out client's connection error, expire the opaque session, await server termination before detaching a paused callback, then destroy the client.                                                                                                            |
| [AI SDK v7 tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [tool reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool), installed `ai@7.0.159` bundled docs, declarations and changelog | `ai@7.0.159` exact backend pin; official docs and installed files read 2026-11-06                                  | SDK tool schemas validate proposed inputs, but the durable neutral proposal must still be checked against the current registered Zod schema/version/capabilities before storage and execution. Lexon schedules execution only after the proposal step commits and passes no SDK call ID into operation identity.                                                                                        |
| [Node.js 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html), installed `node@24.22.1`; canonical JSON unit/integration tests                                                                                  | Node.js `24.22.1`; official API read 2026-11-06                                                                    | Hash recursively key-sorted canonical JSON with SHA-256; operation identity is the committed step and call occurrence, while the argument hash detects a conflicting replay.                                                                                                                                                                                                                            |

Task 10 review verification (2026-11-06): the official [Zod JSON Schema documentation](https://zod.dev/json-schema), checked with installed Zod4.6.7, distinguishes input from output conversion. Tool advertisements use `io: 'input'`; unrepresentable schemas fail registration. Proposal validation produces the normalized JSON snapshot once, and execution uses that verified snapshot rather than applying transformations again. PostgreSQL byte-size comparisons cover JSONB separators, Unicode and numeric expansion; controlled active-SQL deadlines are verified as typed timeout outcomes with model-visible safe results.

### Task 3 accounting verification (2026-11-05)

| Source                                                                                                                                                                                                                     | Exact version / date read                                                                  | Decision supported                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), installed `ai/dist/index.d.ts` and `CHANGELOG.md`                                                                                           | AI SDK 7.0.159, 2026-11-05; package pin and installed declarations checked                 | Provider usage components are independently optional; retain missing token components as their original reservations. No provider SDK types enter Usage.                                                                                                                 |
| [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), installed [provider README](https://github.com/OpenRouterTeam/ai-sdk-provider) and `dist/index.d.ts`                   | OpenRouter provider 3.1.0, 2026-11-05; provider declarations expose usage cost as `number` | Persist only an explicitly supplied decimal string from the neutral contract; preserve null versus zero and never coerce cost through floating-point arithmetic. Task 5 must validate actual provider metadata and explicitly resolve any precision it cannot represent. |
| [PostgreSQL 17 numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html)                                                                                                                                    | PostgreSQL 17.11 image; official docs read 2026-11-05                                      | `numeric(20,10)` is exact but coerces excess fractional scale by rounding; retain the existing schema and reject cost strings beyond 10 fractional digits before settlement.                                                                                             |
| [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html), [REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html), and [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) | PostgreSQL 17 docs read 2026-11-05; image pinned to 17.11                                  | Row-locking SELECT also needs UPDATE privilege; capacity compare uses plain SELECT under its advisory transaction lock, and a new migration revokes runtime UPDATE/DELETE.                                                                                               |
| [Drizzle migrations](https://orm.drizzle.team/docs/migrations), installed `drizzle-orm` migrator source and `_journal.json`                                                                                                | drizzle-orm 0.45.4 and drizzle-kit 0.31.11, 2026-11-05                                     | Append Task 3 migration 0016 with an append-only journal record; do not alter 0015.                                                                                                                                                                                      |

Research is limited to Lexon's docs/code and official vendors. No third-party
legal-product code or brief-generator branch was inspected.

### Task 5 research notes (2026-11-05)

| Source                                                                                                                                                                                                                                                                                                                           | Exact version / date read                           | Decision supported                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), installed `ai@7.0.159` source (`src/generate-text/stream-text.ts`, `src/test/mock-language-model-v4.ts`) and changelog                                                                                                                            | AI SDK 7.0.159, 2026-11-05                          | One `streamText` invocation per physical request; `maxRetries: 0`, `maxOutputTokens`, caller abort signal, and installed v4 mock are supported.                                                                                                                                                                                                               |
| [OpenRouter provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [ZDR](https://openrouter.ai/docs/guides/features/zdr), [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), installed `@openrouter/ai-sdk-provider@3.1.0` README/declarations/`dist/index.js` | Provider 3.1.0, 2026-11-05                          | Provider parser emits response metadata from incoming chunks; usage cost is a JavaScript number. Always request `azure/us`, no fallback, ZDR and denied data collection.                                                                                                                                                                                      |
| [GPT-6 Luna public endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints)                                                                                                                                                                                                                                   | Public endpoint response read 2026-11-05            | Azure `azure/us` is listed. Development allowlist uses exact pair `id=openai/gpt-6-luna`, `provider=azure/us`, and `region=us`; request sends `only` and `order` as `['azure/us']`. Endpoint availability does not prove the physical route used by a generation.                                                                                             |
| [PostgreSQL 17 numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html), installed PostgreSQL 17.11 image; [Drizzle migrations](https://orm.drizzle.team/docs/migrations), installed `drizzle-orm@0.45.4` migrator                                                                                               | PostgreSQL docs read 2026-11-05; drizzle-orm 0.45.4 | Constrained `numeric(20,10)` rounds excess scale; unconstrained `numeric` preserves exact scale. Migration 0018 widens cost storage and blocks negative/infinite values. Convert finite nonnegative provider numbers using shortest `number.toString()` plus string-only exponent expansion, with a 512-character canonical bound and no arithmetic/rounding. |

Task 5 retry-classification review (2026-11-05): installed `ai@7.0.159` exports branded `APICallError.isInstance` and `StreamProviderError.isInstance`; installed `@openrouter/ai-sdk-provider@3.1.0` `dist/index.js` `handleFetchError` wraps `TypeError("fetch failed")` with any non-null cause as retryable. Therefore the adapter authenticates SDK instances, honors an SDK retry flag only when its cause is absent or is a recognized retryable network error, and rejects known TLS certificate failures or unknown cause chains even if the provider wrapper set the flag. Raw network causes count only when an actual `Error` chain contains one of the installed provider's explicit retryable transport codes. No message/name heuristic or new retry loop is used.

## Builder check

A fresh gpt-6-luna/high reviewer read this draft on 2026-11-05. Two questions
were raised: cross-store cancellation/publication ordering and the strength of
the tokenizer-free budget guarantee. The publication rule above explicitly
defines the promise in terms of the terminal stream marker, retains durable
state checks and discards buffered chunks on reconnect; it does not invent a
PostgreSQL/Valkey atomic transaction. The product owner approved conservative admission (not an absolute billing
ceiling), hard output limits, stopping after any reported reservation overrun,
per-attempt input calibration, and the attested key credit limit as the last
safeguard for smoke/evals. These corrections are incorporated above; neither
question remains open for design approval. Region remains
the explicit P8 deferral; observed smoke facts must not be fabricated.

## Planning research addendum (2026-11-05)

The owner approved this design and requested a calculated global active-run cap,
an exact dev Azure-slug proposal and explicit real-eval cost/schedule proposals.
The implementation plan records these for plan review; the earlier MAXLEN 10000
is a starting point, not a mandatory final default. Accepted: UTF-8 estimator,
1-second checkpoint interval plus size threshold, terminal TTL 3600 seconds.

Additional official sources read before task decomposition:

| Reference                                                                                                                                                                                                                                                                                   | Exact context and planning decision                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html), [NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html) | PostgreSQL 17.11; short row/advisory locks, fail-closed tenant tables, K3 global admission, transactional notifications. Tasks 2–4, 6–7, 9–12.                                                                                                                                                                                                 |
| [Valkey MEMORY USAGE](https://valkey.io/commands/memory-usage/), [EVAL](https://valkey.io/commands/eval/), XADD/EXPIRE above                                                                                                                                                                | Valkey 9.0.7 pinned digest, actual isolated Linux/aarch64 memory probe; exact trim, bounded event bytes and terminal retention. Tasks 1, 7–9, 12. All Lua keys must be explicit KEYS, not generated from stored values.                                                                                                                        |
| [BullMQ concurrency](https://docs.bullmq.io/guide/workers/concurrency), [priorities](https://docs.bullmq.io/guide/jobs/prioritized), [retry](https://docs.bullmq.io/guide/retrying-failing-jobs)                                                                                            | Installed 6.5.3 and Nest adapter 12.0.0; separate queue concurrency, priority persistence, no coupling of queue attempts to model attempts. Tasks 6–7, 9, 12.                                                                                                                                                                                  |
| [streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), testing/tools/UI protocol/telemetry sources above                                                                                                                                                        | Installed ai 7.0.159, matching bundled source/docs and provider 3.1.0; neutral single-generation adapter, early response metadata, no hidden retries and no input/output telemetry. Tasks 1, 3–5, 8–15.                                                                                                                                        |
| Official npm package metadata (pnpm view)                                                                                                                                                                                                                                                   | @ai-sdk/otel 1.0.159 depends on ai 7.0.159 and OTel API 1.9.1. Select @opentelemetry/api 1.9.1, sdk-node/exporter-trace-otlp-http 0.219.0, sdk-trace-base 2.8.0 (sdk-node's matching dependency; peer API >=1.3.0 <1.10.0). Newer sdk-node 0.300.0 requires API 1.10 and is not selected. Task 13; no dependency installation during planning. |
| [Vitest global setup](https://vitest.dev/config/globalsetup), current Vitest 5.0.5 project configs, F0 Testcontainers setup                                                                                                                                                                 | Keep existing global setup/shared image pins and per-file isolation; mock adapter composition remains within ai boundary. Tasks 2–16.                                                                                                                                                                                                          |
| [GitHub manual dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), existing pinned ci.yml                                                                                                                                                   | A newly added workflow must reach default branch before hosted dispatch. Test the same command locally/with mocked workflow wiring before merge; never merge to bypass that platform constraint. Tasks 16–17.                                                                                                                                  |
| [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html) and installed Node 24.22.1 APIs                                                                                                                                                                                      | SHA-1 name-based UUID v5 and SHA-256 canonical argument hashes use built-in crypto, no new dependency. Tasks 1, 4, 6, 10.                                                                                                                                                                                                                      |
| OpenRouter endpoint JSON and routing/ZDR docs above                                                                                                                                                                                                                                         | azure/us observed as an available endpoint tag; listed prompt/completion prices 0.00000011/0.00000055 USD per token on read date; availability/prices are not permanent guarantees. Exact slug and per-run credit allocation remain owner decisions at plan review. Tasks 5, 15–16.                                                            |

The memory probe used a new disposable, network-isolated container from the
shared pinned Valkey image, not an existing dev/test service. Synthetic versioned
text-delta JSON included UUIDs and was padded to exactly 1024 or 4096 bytes;
XADD stored one event field, MEMORY USAGE SAMPLES 0 measured the full stream.
No consumer group exists for these delivery streams. Results and arithmetic are
in the plan. The probe container was stopped and removed. This is sizing
research, not implemented engine code or an engine-hop latency measurement.

Planning self-review clarified two implementation safeguards without changing
the approved architecture: busy claim deliveries use BullMQ delayed work rather
than burning failure attempts (6.5.3 moveToDelayed/DelayedError signatures read
in installed package; official [process-step pattern](https://docs.bullmq.io/patterns/process-step-jobs)),
and per-organization executing-step fairness from section5.3 remains distinct
from F17 customer quotas. The plan proposes a2-step limit and keeps the required
global active-run cap separately. OpenRouter's routing Max Price section confirms
max_price prompt/completion values are USD per million tokens; reviewed eval
ceilings0.25/1.00 use those units. The pinned provider's declarations support
these request fields.

### Task 6 research recheck (2026-11-06)

| Source                                                                                                                                                                                                                                                                                                                                                                       | Version checked                                                                                                                                                              | Decision supported                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [priorities](https://docs.bullmq.io/guide/jobs/prioritized), [worker concurrency](https://docs.bullmq.io/guide/workers/concurrency), [retrying jobs](https://docs.bullmq.io/guide/retrying-failing-jobs), [step jobs](https://docs.bullmq.io/patterns/process-step-jobs); installed package declarations/source | bullmq 6.5.3 (package/lock), `Job.moveToDelayed(timestamp, token)` and `DelayedError` declarations read from installed 6.5.3; queue attempts and priority behavior preserved | Use separate interactive/batch workers, preserve priority/attempts/retention, and delay healthy busy claims with the worker token and `DelayedError` so delay does not spend a failure attempt.                                   |
| [NestJS queues](https://docs.nestjs.com/techniques/queues); installed `@nestjs/bullmq` decorator/explorer source                                                                                                                                                                                                                                                             | `@nestjs/bullmq` 12.0.0, `@nestjs/core` 12.3.2; installed `Processor(queue, WorkerOptions)` accepts independent worker concurrency                                           | Continue with native `Processor`/`WorkerHost` composition; register both worker processors only from AI-worker composition.                                                                                                       |
| [Valkey SET](https://valkey.io/commands/set/), [DELIFEQ](https://valkey.io/commands/delifeq/); installed ioredis command call and pinned container image                                                                                                                                                                                                                     | Valkey 9.0.7 image; ioredis 6.0.0. `SET NX PX` acquire, `SET IFEQ ... PX` renewal, and `DELIFEQ` owner-safe release verified with the integration container                  | Keep exactly two TTL-bounded permit keys per organization under the limiter prefix; stale owners cannot renew or release a replacement slot.                                                                                      |
| [RFC 9562 UUIDs](https://datatracker.ietf.org/doc/html/rfc9562), [Node.js crypto](https://nodejs.org/download/release/v24.22.1/docs/api/crypto.html)                                                                                                                                                                                                                         | RFC 9562 version 5 construction; Node 24.22.1 `createHash` API                                                                                                               | Construct deterministic DNS-namespace UUIDv5 without adding a dependency; validate positive safe step sequence and UUID run ID.                                                                                                   |
| [PostgreSQL 17 advisory locks](https://www.postgresql.org/docs/17/functions-admin.html), [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html)                                                                                                                                          | PostgreSQL 17 docs and pinned 17.11 test image                                                                                                                               | Use a transaction-level per-org guard before run/step row locks for claim and renewal; count live tenant step leases within that serialized transaction. Keep append NOTIFY transactional and retain dispatcher polling fallback. |

## Plan approval amendments (2026-11-05)

The owner approved MAXLEN1024, global active cap24, retained terminal cap6,
early eviction of oldest terminal streams, azure/us for synthetic development
(P8 still governs production), and manual-only real evals at USD0.10/16requests.
The same admission trigger additionally enforces a per-organization active-run
cap6 in the global-admission transaction, counting queued/running/cancelling/
awaiting_approval. Refusal creates no run/outbox/slot rows; terminal releases the
org slot exactly once; org B remains able to start when org A has6. This is
admission fairness, not F17 customer quotas. OpenTelemetry packages are first
installs: exact versions recorded in acceptance notes, and no exporter is
constructed unless a collector URL is configured (dev/CI default none).

### Task 13 safe telemetry and transactional audit (2026-11-07)

| Official source / package evidence                                                                                                                                                                                                | Exact version and date read                                                                                                                                                                                                                           | Decision                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry), [AI SDK OpenTelemetry package](https://www.npmjs.com/package/@ai-sdk/otel)                                                                                     | `ai@7.0.159`, `@ai-sdk/otel@1.0.159`; official docs and installed package README/declarations read 2026-11-07                                                                                                                                         | Register telemetry in AI Worker only. Explicitly disable input/output/provider detail recording and verify emitted SDK spans with hostile prompt/tool/output/error canaries. SDK-generated tool call IDs still appear in spans, so sanitize at the exporter boundary too.                                                                                                                     |
| [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), [exporters](https://opentelemetry.io/docs/languages/js/exporters/), official package metadata and installed declarations | `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.219.0`, `@opentelemetry/exporter-trace-otlp-http@0.219.0`, `@opentelemetry/sdk-trace-base@2.8.0`; exact npm metadata/peer ranges plus installed declarations read before install on 2026-11-07 | Keep API, SDK, exporter, and trace-base versions exactly pinned; peer ranges match. Return before constructing NodeSDK/exporter when no collector URL exists. When configured, disable resource autodetection, metrics, logs, instrumentation, propagation, and use an allowlisting exporter that strips events, links, status messages, provider/tool details, and host resource attributes. |
| [NodeSDK configuration](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-sdk-node) and installed `sdk-node@0.219.0` source                                                        | `@opentelemetry/sdk-node@0.219.0`; official source and local declarations checked 2026-11-07                                                                                                                                                          | Programmatic explicit trace exporter is configured only with a collector URL. Automatic environment exporters are not constructed on the default dev/CI path.                                                                                                                                                                                                                                 |

The first installation versions are recorded in Task 13 acceptance. No SDK
upgrade/fallback was used. `lexon_auth` remains limited to its existing generic
audit writer; the app audit validator accepts only four narrow AI audit event
types through the existing tenant transaction.

### Task 14 deterministic mock evaluations (2026-11-07)

| Official source / package evidence                                                                                                                                                               | Exact version and date read                                                                 | Decision                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Nest standalone applications](https://docs.nestjs.com/standalone-applications), installed `@nestjs/core` API and package metadata                                                               | `@nestjs/core@12.3.2`; official docs and installed declarations checked 2026-11-07          | Build an application context for explicit evaluation composition and close it through Nest lifecycle; do not create an HTTP listener or mount auth routes.                                                                                           |
| [Vitest global setup](https://vitest.dev/config/globalsetup.html), [Vitest lifecycle](https://vitest.dev/guide/lifecycle.html), installed setup/provider declarations                            | `vitest@5.0.5`; official docs and installed declarations checked 2026-11-07                 | Use global setup `provide`/test `inject` for generated connection descriptors. Keep orchestration in infrastructure testing and share one process-global coordinator across separately loaded source and built module graphs.                        |
| [AI SDK mock models](https://ai-sdk.dev/docs/ai-sdk-core/testing), installed `ai/test` declarations and [AI SDK 7 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0) | `ai@7.0.159`; official docs, installed declarations, and migration guide checked 2026-11-07 | Use `MockLanguageModelV4` only in backend infrastructure testing. SDK 7 places system context in top-level `instructions`; preserve all nonce-delimited system content and ordering while converting the neutral backend prompt before `streamText`. |

Task14 adds no runtime or test dependency. Evaluations enter through the single
public backend evaluation entry; deterministic providers are explicit
backend-owned fixtures and exercise the durable database, queue, receipts,
authorization, and approval services. Safe reports remain allowlisted.

### Task 16 bounded manual real evaluations (2026-11-07)

| Official source / package evidence                                                                                                                                                                                                                   | Exact version and date read                                                                                                                                                                                                                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GitHub manually running workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) and [workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) | Official docs reread 2026-11-07. Pinned existing actions: checkout v6 SHA `d23441a48e516b6c34aea4fa41551a30e30af803`, pnpm setup v4 SHA `b906affcce14559ad1aafd4ab0e942779e9f58b1`, setup-node v6 SHA `249970729cb0ef3589644e2896645e5dc5ba9c38`. | A new `workflow_dispatch` workflow must be present on the default branch before hosted dispatch; a dispatched run uses its selected branch/tag ref. Keep the paid job conditional on `refs/heads/main`, with only `workflow_dispatch`, read-only permissions, pinned actions, one concurrency group, and secret/attestation variables scoped to the guarded execution step. Hosted activation remains post-merge operator verification. |
| [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)                                                                                                                            | Official docs reread 2026-11-07.                                                                                                                                                                                                                  | Secret contexts are supplied only to the protected real-evaluation step. The mock PR gate remains in `pnpm test` and receives no provider secret.                                                                                                                                                                                                                                                                                       |
| [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), installed `@openrouter/ai-sdk-provider` and `ai` packages                                                                                               | Official docs reread 2026-11-07; installed `@openrouter/ai-sdk-provider@3.1.0`, `ai@7.0.159`.                                                                                                                                                     | Forward `provider.max_price` as `{prompt:0.25,completion:1.00}` USD per million tokens exactly. Reuse the existing real gateway, fixed route/privacy preferences, disabled SDK retries, and the durable evaluation engine; do not add another provider transport.                                                                                                                                                                       |
| Existing evaluation public entry and installed backend workspace                                                                                                                                                                                     | `@nestjs/core@12.3.2`, `vitest@5.0.5`, Node `24.22.1`; source/declarations inspected 2026-11-07.                                                                                                                                                  | Extend only `@lexon/backend/evaluation` with a neutral real-gateway/request-policy contract. The runner uses the actual RunService/StepExecutor/attempt path and keeps one decimal invocation budget across the three cases and retries.                                                                                                                                                                                                |

Real evaluation admission requires both the existing dated ZDR-only account
attestation and an operator-owned `LEXON_REAL_EVAL_ALLOCATION_ATTESTED` value
that affirms a dedicated USD0.10 allocation with no other consumers for this
invocation. Neither local code nor hosted workflow configures the account or
credit limit. Unknown attempts retain their conservative reservation; a price
overrun or exhausted reserve/request ceiling blocks every subsequent call.
Reports contain only case identifiers/scores, total known cost, and unknown
attempt count. Actual account verification, paid model execution, and hosted
dispatch activation are deferred to owner setup and post-merge verification.

## Task1 owner review corrections, implemented first in Task2

Run start/advance/resume jobs carry ctx={orgId:uuid,userId:uuid}, K3 only, like
F0 envelopes. A worker opens withTenant from validated ctx, THEN loads the run;
it must not discover tenant ownership using a SECURITY DEFINER run→org lookup.
A mismatched org context reads/writes nothing (Task7 flow7). RunId and every
operationId are UUID-validated, including approval-required and operation-status.
Lexon-generated message IDs are UUIDs. SDK-provided text/tool/approval part IDs
remain bounded opaque strings (256code units proposed), not forced to UUID or
trimmed. Behavioral RED precedes these corrections before repository adoption.

## Task2 owner least-privilege correction, first in Task3

Owner accepted Task2 subject to revoking lexon_app UPDATE on
ops.ai_engine_capacity in a new migration;0015 remains immutable. Runtime
retains SELECT/INSERT for insert-or-compare. UPDATE/DELETE denial, same-fingerprint
second-process success, and different-fingerprint mismatch refusal are tested.
Changing capacity later is migration/operator work. slot_bytes6291456 and the
per-org maximum6 are deliberate fixed CHECK/config limits; raising either
requires a reviewed migration.

Research rechecked2026-11-05: [PostgreSQL17 SELECT](https://www.postgresql.org/docs/17/sql-select.html)
states all SELECT row-locking clauses also require UPDATE privilege;
[REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html) and transaction
isolation docs support removing the runtime FOR UPDATE comparison while
retaining the existing advisory xact lock. The owner-only admission trigger
keeps its own serialization; no new SECURITY DEFINER configuration bypass.

Accounting convention for the current storage shape: inputBudgetTokens plus
outputBudgetTokens is the single persisted aggregate token budget. Server
profile projection must match it; unknown reservations never release either
component. Missing reported components retain their component reservation.

### Task 4 authorization and context verification (2026-11-05)

| Source                                                                                                                                                                                                                                                     | Exact version / date read                                                             | Decision supported                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Node.js 24.22.1 crypto API](https://nodejs.org/download/release/v24.22.1/docs/api/crypto.html)                                                                                                                                                            | Installed runtime `24.22.1`; official exact-release docs read 2026-11-05              | Use built-in `node:crypto` `createHash('sha256')` for canonical operation hashes and `randomBytes` for per-context fencing nonces; no dependency is needed.                                                                                                                                                                                                     |
| [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [function security](https://www.postgresql.org/docs/17/perm-functions.html), and [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html) | Pinned PostgreSQL image `17.11-bookworm`; official PostgreSQL 17 docs read 2026-11-05 | The narrow authorization-facts function has fixed trusted `search_path`, revoked PUBLIC/Auth execute, and only `lexon_app` execute. It checks supplied tenant context and locks organization, user, then membership so the effect transaction serializes with F1 membership changes. It performs no run-to-organization discovery and makes no policy decision. |
| F1 auth schema, `identity.types.ts`, `run-actor.ts`, and `0008_org_invariants.sql`                                                                                                                                                                         | Installed project code read 2026-11-05; Better Auth SDK unchanged                     | Keep session lifetime separate from durable worker lifetime. Persist nullable initiating session ID and MFA timestamp on `app.ai_runs`, with no foreign key to `auth.session`; use active verified Identity evidence for start/decision and stored provenance plus freshly locked current facts for worker phases.                                              |
| F3 authorization and approval requirements in this design                                                                                                                                                                                                  | Read 2026-11-05                                                                       | F3 supplies no role-to-resource capability matrix. Current active membership, account state, organization state, and required MFA gate only trusted server-profile capabilities; roles add no capability or substitute approver. Resource-specific policy belongs to the owning feature slice.                                                                  |

### Task 7 execution research (2026-11-06)

- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) and [advisory-lock functions](https://www.postgresql.org/docs/17/functions-admin.html): verified transaction locks and row-lock lifetime against the pinned PostgreSQL17.11 image. The local psql17.9 client is separate from the server pin. Preserve organization-advisory → run → step and keep external I/O outside transactions.
- [Nest lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events) and [queues](https://docs.nestjs.com/techniques/queues), installed Nest12.3.2 / adapter12.0.0: actual API/worker initialization compares capacity before consumer activation; failed configuration refuses startup.
- Read current F0 receipt/tenant/outbox source, pg8.23.1, TypeScript6.0.3 and Zod4.6.7. Caller-session receipt execution validates context and rolls back with stale effects. A complete immutable profile snapshot and explicit generation/continuation delta preserve configuration and iteration semantics independently of sequence/retry. Usage settlement remains authoritative inside that same transaction; ownership-loss exceptions are typed and distinct from validation errors.

### Task 8 streaming research (2026-11-06)

- [Valkey XADD](https://valkey.io/commands/xadd/), [EVAL](https://valkey.io/commands/eval/), [TIME](https://valkey.io/commands/time/), [EXPIRE](https://valkey.io/commands/expire/), and [MEMORY USAGE](https://valkey.io/commands/memory-usage/), checked against pinned Valkey9.0.7: exact `MAXLEN = 1024`, explicit script keys, mutation-time lease deadlines, and atomic terminal append/closed guard preserve bounded publication. `MEMORY USAGE ... SAMPLES 0` includes full shared registries. Local Linux/aarch64 measurements remain distinct from CI/x64 evidence.
- Installed ioredis6.0.0 declarations and connection behavior: explicit bounded connection/command timeouts and transport-error containment allow stream unavailability without undoing PostgreSQL progress. Tenant-scoped database proofs complete before Valkey commands; no cross-store atomicity is claimed.
- [AI SDK UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), installed ai7.0.159 message processor/chunk declarations: structured tool input can be fragmented into JSON deltas. An operation-ID-only completion is Lexon metadata that F4 must resolve from durable state before forwarding SDK completion. Whole tool result values remain outside stream events.
- Publication reserves capacity before bounded encoding and queues detached snapshots only: four running/pending/reserved publications per composite claim, at most 32 parts of 4096 bytes each. Recovery invalidates pending output before reset. Fresh durable status, rather than cached lease expiry, authorizes bounded ghost cleanup; active and approval-paused streams are retained. Terminal generation bindings make replay and eviction safe without unbounded tombstones.

### Task 9 execution and queue-hop research (2026-11-06)

- [AI SDK `streamText` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) and [generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), read 2026-11-06 against installed `ai@7.0.159`, its bundled docs, source and CHANGELOG: `fullStream` is consumed as an async iterable; async event handling must await durable writes before requesting more stream events. AI SDK's model metadata is a promise and is not a substitute for the provider generation metadata event. The gateway remains a one-generation adapter (`stopWhen: stepCountIs(1)`, `maxRetries: 0`, `streamRetries: 0`); durable retries/continuations stay in the queue engine.
- [BullMQ worker guide](https://docs.bullmq.io/guide/workers) and [NestJS queues guide](https://docs.nestjs.com/techniques/queues), read 2026-11-06 against installed BullMQ `6.5.3` and `@nestjs/bullmq@12.0.0` / Nest `12.3.2`, including installed worker declarations: actual worker startup waits for readiness and durable-step handlers are registered with the existing `QueueConsumer`; no parallel queue path is introduced for latency measurement.
- [PostgreSQL 17 NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html), [LISTEN](https://www.postgresql.org/docs/17/sql-listen.html), and [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), read 2026-11-06 against pinned PostgreSQL `17.11`: notifications are delivered after transaction commit, but dispatcher polling remains the 1000 ms fallback and the queue-hop measurement records actual dispatch-to-worker claim rather than inferring latency from notifications.
- Installed `@nestjs/bullmq@12.0.0`, `pg@8.23.1`, `ioredis@6.0.0`, `vitest@5.0.5`, and local PostgreSQL/Valkey Testcontainers setup checked 2026-11-06. Test fixtures continue using the shared infrastructure descriptor with per-file database, prefix, and bucket isolation; no prestarted service is assumed.
- Task 9 follow-up, read 2026-11-06: the official AI SDK [streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) and [generating text guide](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), plus installed `ai@7.0.159` declarations and `CHANGELOG.md`, confirm `fullStream` async iteration and explicit retry settings. Only `iterator.next()` failures are classified as provider failures; awaited callback failures (metadata/checkpoint/database/stream ownership) propagate. A PostgreSQL claim heartbeat renews serially during generation, and a separate awaited one-second timer flushes dirty checkpoints while a stream is paused. The timer is stopped and its pending write awaited before attempt settlement or retry.
- Task 9 queue follow-up, read 2026-11-06: the official [BullMQ workers guide](https://docs.bullmq.io/guide/workers) and installed `bullmq@6.5.3` worker declarations support the existing actual-worker measurement path. Hop samples wait for each handler completion and assert zero busy outcomes; the previous sample set is retained as `contended, invalid as gate evidence` and excluded from the gate result.
- Final Task 9 lifecycle verification, read 2026-11-06: [Node24.22.1 AbortController/AbortSignal](https://nodejs.org/download/release/v24.22.1/docs/api/globals.html#class-abortcontroller) supports an owned request deadline and exact parent abort reason. One PostgreSQL heartbeat spans context collection, model attempts, retry backoff and receipt settlement; its default interval is 5000 ms, with shorter intervals for short leases. Model calls default to 60000 ms. Failure cleanup aborts and awaits iterator return without replacing the primary engine error. Checkpoint revisions acknowledge only the captured prefix, and timer teardown waits for the serialized owner. These checks refine the earlier implementation notes above; they do not add an SDK loop or cross-store atomicity claim.

### Task 17 final verification research (2026-11-07)

- [AI SDK UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) and installed `ai@7.0.159` stream processor/chunk declarations were checked against actual `readUIMessageStream` behavior. A real producer-to-Valkey-to-SDK consumer regression proved that text parts require start/end framing and that terminal finish must close an open part after producer loss. The test-only consumer adapter is kept in the AI infrastructure testing directory; production import-boundary tests deny imports from it.
- [Valkey EVAL](https://valkey.io/commands/eval/), [TIME](https://valkey.io/commands/time/), [XADD](https://valkey.io/commands/xadd/) and [MEMORY USAGE](https://valkey.io/commands/memory-usage/) were checked against the pinned Valkey 9.0.7 test image. The publication deadline is 250 ms including queue wait/retries. Deadline tests delay a real isolated EVAL call, and guard growth tests populate the added bounded metadata in the measured key set; fixed 6 MiB slot and stream-capacity values are unchanged.
- [node-postgres Client API](https://node-postgres.com/apis/client) was checked against installed `pg@8.23.1`. Cleanup uses only public query/release behavior: it counts in-flight queries, restores the original query function before pool release, releases active SQL errors immediately, and queues rollback plus immediate release for an idle paused callback. Integration evidence covers active and idle blackhole paths, backend loss, lock reacquisition and bounded shutdown; no private client fields or global warning suppression are used.
- [AI SDK streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) and [generating text guide](https://ai-sdk.dev/docs/ai-sdk-core/generating-text), checked against `ai@7.0.159`, support the existing async iterator and cancellation semantics. The regression fix commits durable cancellation before relying on the terminal Valkey script to close open SDK parts; stale ownership failures continue to propagate outside the cancellation path.
- The docs above and installed package versions were checked on 2026-11-07. These notes support implementation-level API decisions only; they do not establish hosted Linux/x64 or live-provider acceptance.

### Task 15 stateless smoke and calibration research (2026-11-07)

- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), current official documentation read 2026-11-07 against installed `@openrouter/ai-sdk-provider@3.1.0`: request preferences `only`, `order`, `allow_fallbacks`, `zdr`, and `data_collection` express an exact provider route and privacy constraints. The smoke reuses `createRealModelGateway`, whose outgoing-request contract already verifies those fields; it does not create a second transport.
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), current official documentation and installed provider `3.1.0` README/implementation read 2026-11-07: Chat Completions usage has `prompt_tokens`, `completion_tokens`, and `cost`; the adapter maps these to `providerMetadata.openrouter.usage`. The smoke reports the gateway's validated usage/cost only, and reports ratio unavailable for absent or zero input usage. The current adapter surfaces the provider string but no physical-region field, so output separates configured region from observed region and explicitly labels physical location unverified.
- [AI SDK `streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) and [settings](https://ai-sdk.dev/docs/ai-sdk-core/settings), read 2026-11-07 and checked against installed `ai@7.0.159` declarations and `CHANGELOG.md`: async iterable stream consumption, `maxRetries: 0`, output-token bounding, and an `AbortSignal` are supported. Smoke uses the established gateway's zero-retry behavior and Node's deadline signal; text events are consumed without retaining or writing their content.
- [Node.js v24 AbortSignal](https://nodejs.org/download/release/v24.22.1/docs/api/globals.html#static-method-abortsignaltimeoutdelay), checked 2026-11-07 against the pinned runtime `24.22.1`: `AbortSignal.timeout(delay)` creates a signal that aborts after the delay. Smoke applies the required 30000 ms call deadline.
- The verified implementation uses the allowlisted model route, estimator v1, a fixed synthetic prompt, at most one request, and no application/DB context. Current public evidence records mock-only verification; operator account evidence and real calibration remain deferred.
