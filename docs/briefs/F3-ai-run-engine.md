# F3 — AI Run Engine (headless)

## Goal

Build the one engine that runs every AI task in Lexon (LEX-ARC-001 §4.7):
runs that are queued, executed in the AI Worker with a model–tool loop,
streamed to Valkey, checkpointed, cancelled, paused for approval and resumed,
and accounted for in `usage_events`. Features (Chat in F4, tools in F5,
retrieval in F8, memory, workflows, subagents…) plug in later through run
profiles, context providers, and tool providers, without changing the engine.

F3 has **no HTTP endpoint and no UI**. It is exercised through domain
services, the AI Worker, integration tests with a mock model, the `evals/`
runner, and one operator smoke command against the real model.

## Users and permissions

| Actor | Can | Cannot |
|---|---|---|
| Signed-in user (through later slices) | Start, cancel, and decide approvals on runs in organizations they belong to, as the capability policy allows | Start or read runs in another organization; enable tools or models by sending flags |
| AI Worker | Execute queued runs in the run's tenant context from the validated job payload | Read or write another tenant's data; call a model outside the allowlist |
| Operator | Run the model smoke command in an environment that has the key | Use the smoke command to send client content |

## Decisions already made (product owner, 2026-11-05)

1. **Model allowlist starts with one model:** OpenRouter `openai/gpt-6-luna`.
2. **Zero data retention is mandatory.** Every request enforces zero data
   retention and denies data collection; if no provider qualifies, the run
   fails with a clear error. Verified on 2026-11-05: `openai/gpt-6-luna` has
   ZDR endpoints (Azure) in OpenRouter's public ZDR endpoint list.
3. **Evals:** every PR runs evals with a **mock model** (free, deterministic).
   Evals against the real model run **manually or on a schedule** with a
   spending limit.
4. **A development OpenRouter key exists.** It is a secret: it lives only in
   the local, uncommitted environment and in a GitHub Actions secret for the
   manual eval workflow. It never appears in the repository, logs, test
   output, screenshots, or chat.

## In scope

### Run lifecycle and persistence

1. `ai_run` with the state machine of LEX-ARC-001 §4.7: `queued` →
   `running` → `awaiting_approval` → `completed` | `failed`, and
   `cancelling` → `cancelled`. Illegal transitions are rejected and tested.
   Every run row carries `org_id` under RLS (`withTenant`), the starting
   user, the run profile id, the resolved model, budgets, timestamps, and a
   safe error code (never raw provider text).
2. Starting a run (domain service, no HTTP) writes the run and its outbox
   entry in **one transaction** (§4.1 steps 1–2). The dispatcher forwards it
   to BullMQ with job id = outbox id. The worker records a processed-job
   receipt (F0) so redelivery never runs a step twice.
3. **Checkpoints** at step boundaries (and periodically during long
   generations) store the partial assistant output; completion writes the
   final output, usage, and `completed` in one transaction. Run input and
   output are K1 data: tenant-scoped tables, never logged.
4. **Worker failure:** a stalled job is retried with the same id and resumes
   from the last checkpoint; the stream receives a `reset` event for the
   in-progress output.

### Execution

5. **Job registry:** replace F0's no-op `ai-interactive` consumer with a
   job-type → handler registry and the queues of §5.3 that F3 needs
   (`ai-interactive`, `ai-batch`), each with its own concurrency. Job
   payloads are versioned Zod contracts in `shared/`.
6. **Model–tool loop** with the AI SDK through `infrastructure/ai` only, with
   an iteration limit and a token budget from the run profile; exceeding
   either ends the run with a defined status and error code.
7. **Model access (`infrastructure/ai`):**
   - the reviewed allowlist (existing `ModelAllowlistSchema`) is loaded from
     per-environment configuration and validated at startup; the dev
     allowlist contains `openai/gpt-6-luna`, its provider, region, and
     `zeroDataRetention: true`;
   - every request sends explicit OpenRouter provider preferences that
     enforce zero data retention and deny data collection, restricted to the
     allowlisted provider, with no fallback outside it;
   - a request for a model not on the allowlist is refused before any
     network call;
   - "no qualifying provider" and other provider failures map to safe error
     codes; retries follow a bounded, documented policy;
   - AI SDK input/output recording (telemetry) is off.
8. **Cancel** (domain service): sets `cancelling`, signals the worker, the
   worker aborts through an `AbortSignal`, saves partial output, and sets
   `cancelled`. Cancelling a finished run is a no-op.

### Extension contracts (§4.7)

9. **Run profile:** default and allowed models, iteration limit, token
   budget, queue and priority, and the capabilities it may enable.
10. **Context provider:** contributes a part of the prompt with its own token
    budget. A shared helper wraps every untrusted piece (documents, memory,
    web, tool results) in **nonce-delimited untrusted-data blocks** with an
    instruction to treat it as data.
11. **Tool provider:** registers tools with a Zod argument schema,
    read/write classification, approval requirement, timeout, and result
    size limit. Oversized results are truncated with a marker; timeouts end
    the tool call with a safe error the model can see.
12. **Capability policy:** computes the active capabilities and tools from
    identity, organization (and later project) context, and resource
    permissions, on the server, **every time a run starts or resumes**. A
    tool that is not permitted is not advertised to the model and is
    rejected if the model calls it anyway. Caller-supplied flags are never
    inputs.
13. F3 registers **no product features**. Test and eval code register test
    profiles and providers (an echo profile, a read tool, a write tool that
    needs approval, a context provider that injects hostile text). Production
    registries start empty except what item 18 needs.

### Streaming

14. Each run writes events to the Valkey Stream `run:{runId}` (`XADD` with
    `MAXLEN`), following the AI SDK UI message stream protocol plus Lexon
    envelope events (`status`, `reset`, `approval-required`, `finish`,
    `error`). The event schema and version live in `shared/`. After the run
    ends the stream gets a short TTL. The SSE endpoint and stream hub are
    **F4**. If Valkey is unavailable, the run continues and checkpoints in
    PostgreSQL remain the source of truth (§5.4).

### Approval pause and resume

15. When a tool needs approval, the worker stores the pending operation with
    a **snapshot hash** of its arguments, sets the run to
    `awaiting_approval`, publishes an event, and **ends the job**.
16. A domain service records the decision after validating owner, snapshot
    hash, and permissions, then enqueues a `resume` job through the outbox.
    On resume the capability policy is recomputed; an approved operation runs
    once (idempotent by operation id); a rejected one is returned to the
    model as rejected. Approval HTTP, UI, and expiry of unanswered approvals
    are **F5**.

### Accounting and observability

17. Every model call records a `usage_events` row (organization, user, run,
    step, model, provider, input/output tokens, cost from OpenRouter usage
    accounting) exactly once per step, even when a step is retried.
    Quotas that block runs are **F17**.
18. **Operator smoke command** (for example
    `pnpm --filter @lexon/backend run ai:smoke`): sends one fixed, non-client
    prompt through the real allowlist, provider preferences, and key from the
    environment, and prints model, provider, token counts, and cost. It
    stores nothing and refuses to run without the key.
19. OpenTelemetry spans for run, step, model call, and tool call with ids,
    sizes, durations, and status only, never prompt or output text
    (§6.2, §7.1).

### Evals

20. `evals/` reaches the engine only through `@lexon/backend/evaluation`
    (extend that public entry). CI runs the mock-model subset:
    - lifecycle (complete, cancel, budget exceeded, approval pause/resume);
    - **prompt injection**: a context provider or tool result that tells the
      model to call the write tool never executes it without capability and
      approval;
    - usage recorded once per step on retry.
21. A **manual / scheduled** GitHub Actions workflow runs a small real-model
    eval set with `OPENROUTER_API_KEY` from repository secrets and a hard
    spending limit; it never runs on pull requests from forks and prints no
    content beyond scores.

## Out of scope

- HTTP run endpoints, SSE stream hub, `ChatTransport`, conversations and
  messages, Home chat → **F4**.
- Real tools, approval HTTP and UI, approval expiry, tool audit views → **F5**.
- Retrieval, documents, citations → **F7–F8**. Memory → **F9**. Workflows →
  **F10**. Web research → **F11**. Subagents → **F12** (the engine keeps
  child runs possible: a profile can set depth and budget, but no subagent
  tool ships).
- Per-organization quotas and blocking rate limits → **F17**.
- More models, production key, region decision → before production (P8).

## User flows (system flows, tested without HTTP)

1. **Happy path:** start run → outbox → dispatcher → worker → model streams
   text → events in `run:{id}` → checkpoint → `completed`, usage recorded.
2. **Budget exceeded:** the loop hits its iteration or token limit → run ends
   with the defined status and error code; partial output kept.
3. **Cancel during streaming:** `cancelling` → abort → partial output saved
   → `cancelled`; no further events after the final status.
4. **Approval:** model calls the test write tool → `awaiting_approval`, job
   ends → approve → `resume` job → tool runs once → run completes. Reject →
   the model sees a rejection result. A stale snapshot hash is refused.
5. **Crash:** worker dies mid-step → job retried → `reset` event → step
   re-runs from the checkpoint → usage counted once for the step.
6. **Blocked model:** profile names a model not on the allowlist → run fails
   before any network call. Provider without ZDR → never selected.
7. **Cross-tenant:** a worker job whose payload names another organization's
   run reads nothing and writes nothing.

## Data and contracts

- Tables (Chat domain, LEX-ARC-001 §3.1): `ai_runs`, run checkpoints/outputs,
  pending tool operations; Usage domain: `usage_events`. All tenant-scoped
  with RLS and negative tests. Drizzle migrations with RLS policies.
- `shared/`: run status enum, job payload schemas (`run.start`,
  `run.resume`), stream event schema (versioned), safe error codes.
- Module placement: the engine is feature-agnostic code inside the **Chat**
  module (§3.1 owns AI runs, tool approval, subagents) exposing the provider
  registration contracts; `usage_events` belong to the **Usage** module.
  `infrastructure/ai` holds the model client, allowlist, and provider
  preferences, and imports no module (lint rule `infrastructure-domain`).

## Non-functional requirements

- **Secrets:** `OPENROUTER_API_KEY` is read only by the AI Worker runtime
  (and the smoke/eval tools), from environment or Docker secret; the API
  runtime never has it. Config validation never echoes it. A test proves it
  does not appear in logs or error output.
- **Privacy:** no K1 in logs, traces, errors, or Sentry; provider error text
  is mapped, not forwarded.
- **Tenancy:** every read and write in the worker uses the run's tenant
  context from the validated payload; negative tests for cross-tenant job
  payloads and for queries without context.
- **Idempotency:** at-least-once delivery, effectively-once effects: step
  receipts, usage unique per step, approved operations unique per id.
- **Testability:** the engine runs without HTTP and without network using
  the AI SDK mock model (§4.7 rule).

## Research first

- OpenRouter provider routing (zero data retention, data collection, `only`,
  fallbacks): https://openrouter.ai/docs/features/provider-routing
- OpenRouter ZDR, including the October 2026 safety-screening exception and
  "Safety Retention" endpoints (do not allow them for Lexon):
  https://openrouter.ai/docs/features/zdr
- OpenRouter usage accounting: https://openrouter.ai/docs/use-cases/usage-accounting
- OpenRouter limits and errors: https://openrouter.ai/docs/api-reference/limits
- `@openrouter/ai-sdk-provider` 3.1.0 README (pinned in backend).
- AI SDK 7: https://ai-sdk.dev/docs/ai-sdk-core/generating-text,
  https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling,
  https://ai-sdk.dev/docs/agents/loop-control,
  https://ai-sdk.dev/docs/ai-sdk-core/testing (mock models),
  https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- BullMQ 6 job ids, retries, stalled jobs: https://docs.bullmq.io/guide/jobs/job-ids
- Valkey Streams `XADD`/`MAXLEN`/`EXPIRE` (pinned 9.0.x).
- OpenTelemetry for Node (attribute rules in LEX-ARC-001 §7.1).
- F0 outbox, dispatcher, receipts, and `withTenant` code on `main`.

## Skills to use

`.agents/skills/`: `ai-sdk`, `valkey`, `vitest`, `docker-compose-patterns`,
`karpathy-guidelines`. No new skill needed.

## Acceptance criteria

- [ ] State machine with all legal and illegal transitions tested.
- [ ] Start-run writes run + outbox atomically; redelivery runs nothing twice.
- [ ] Job registry replaces the no-op consumer; `ai-interactive` and
      `ai-batch` queues with their own concurrency.
- [ ] Mock-model integration tests (Testcontainers) for flows 1–7.
- [ ] Allowlist refusal before network; every real request carries ZDR and
      data-collection-deny preferences restricted to the allowlisted
      provider (asserted on the outgoing request).
- [ ] Usage recorded exactly once per step, including after retry.
- [ ] Capability policy recomputed on start and resume; unpermitted tool
      neither advertised nor executed.
- [ ] Untrusted-data fencing helper used by the test context provider;
      injection evals pass.
- [ ] Stream events validate against the `shared/` schema; TTL after finish;
      Valkey outage does not lose the run.
- [ ] No K1 or key in logs/traces/errors (tests).
- [ ] Cross-tenant negative tests for every new table and the worker.
- [ ] `ai:smoke` works with a real key locally (evidence: model, provider,
      tokens, cost; no content stored).
- [ ] Manual real-model eval workflow exists, guarded, with a spending
      limit; mock evals run in CI.
- [ ] CI follow-up: replace the stale feature-branch list in
      `.github/workflows/ci.yml` push triggers with `main` (pull requests
      already run CI).

## References

- LEX-ARC-001 §3.1, §3.2, §4.1 (steps 1–3, 5, 7–9), §4.7, §5.3, §5.4, §6.1,
  §6.2, §7.1, §7.2, §7.3; LEX-TS-001 (AI SDK 7, OpenRouter provider,
  BullMQ 6, Valkey 9.0.x).
- F0 follow-ups (STATE): no-op consumer, receipts limited to PostgreSQL
  effects, evals entry point.

## Open questions

1. **Provider region** for `openai/gpt-6-luna` (Azure: global, `us`, or `eu`)
   stays open until the cross-border transfer review (LEX-ARC-001 §6.4,
   prerequisite P8). Development uses synthetic data only; record the region
   the router actually used in the allowlist evidence.
