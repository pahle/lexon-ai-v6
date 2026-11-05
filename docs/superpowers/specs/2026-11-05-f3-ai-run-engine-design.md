# F3 — Headless AI Run Engine design

Date: 2026-11-05. Status: approved by the product owner; approved implementation plan in progress.
Branch: `f3-ai-run-engine`, based on `origin/main` at `63c26f9`.
Task1 foundation is implemented and accepted; later tasks remain pending. This document incorporates the owner's corrections
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

Reviewed per-environment allowlist starts with openai/gpt-6-luna on Azure.
Every request enforces provider.zdr=true, data_collection=deny, exact reviewed
provider restriction and allow_fallbacks=false; never accept request overrides.
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

Research is limited to Lexon's docs/code and official vendors. No third-party
legal-product code or brief-generator branch was inspected.

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

## Task1 owner review corrections, implemented first in Task2

Run start/advance/resume jobs carry ctx={orgId:uuid,userId:uuid}, K3 only, like
F0 envelopes. A worker opens withTenant from validated ctx, THEN loads the run;
it must not discover tenant ownership using a SECURITY DEFINER run→org lookup.
A mismatched org context reads/writes nothing (Task7 flow7). RunId and every
operationId are UUID-validated, including approval-required and operation-status.
Lexon-generated message IDs are UUIDs. SDK-provided text/tool/approval part IDs
remain bounded opaque strings (256code units proposed), not forced to UUID or
trimmed. Behavioral RED precedes these corrections before repository adoption.
