# F3 — AI Run Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Implementation subagents use **gpt-6-luna**, reasoning **high**, with an isolated context (`fork_turns: none`); verify dispatch settings and stop if unavailable. Main session performs spec-compliance then code-quality review per task, and a fresh whole-branch review at the end. Steps use checkbox syntax for tracking.

**Goal:** Deliver the headless, tenant-isolated AI Run Engine with durable one-step jobs, bounded model attempts, transactional tool effects, approval/cancel/recovery, safe streams/accounting, and mock/real evaluation entry points.

**Architecture:** PostgreSQL owns run/step/attempt/operation state. One BullMQ job advances one durable sequence; F0 receipts atomically commit effects and the next outbox entry, with model I/O outside transactions. Chat orchestrates; Usage accounts; worker-safe Identity policy authorizes; infrastructure owns SDK, SQL, queue and telemetry mechanics.

**Tech Stack:** Node 24.22.1, pnpm 10.33.1, TypeScript 6.0.3, Zod 4.6.7, Nest 12.3.2, ai 7.0.159, OpenRouter provider 3.1.0, BullMQ 6.5.3 / Nest adapter 12.0.0, Valkey 9.0.7, PostgreSQL 17.11, Drizzle 0.45.4 / Kit 0.31.11, Vitest 5.0.5; exact existing image manifest.

**Spec:** [Approved design](../specs/2026-11-05-f3-ai-run-engine-design.md), [brief](../../briefs/F3-ai-run-engine.md), controlling LEX-TS-001 v1.11 and LEX-ARC-001. Owner conversation corrections in the design replace erroneous per-step usage wording. Status: approved by the product owner on 2026-11-05, including revised stream capacity, early terminal eviction, azure/us, and manual USD0.10/16-request eval envelope; Tasks1–2 accepted after review; Tasks3–17 remain pending.

## Global Constraints

- Work on `f3-ai-run-engine`, based on main `63c26f9`; never commit/push main, rebase prior slices, or alter F2.1 UI/goldens. Each accepted task gets its own commit and feature-branch push; open the final PR to main after completion. No implicit merge authorization.
- Preserve SDD Luna/high implementation routing. Main reviews spec first, quality second. A failed review returns to the same implementer; no silent model fallback. Research precedes every task using the design Research notes/addendum and matching installed docs; record new findings, never guess APIs.
- TDD: write the named assertion tests, observe the relevant RED, then minimal production code and GREEN. Unit tests use root project filters; integration uses shared global Testcontainers setup and per-file isolation, never a prestarted stack. No new tokenizer or workflow framework.
- Exactly one TypeScript 6.x and Zod 4.x; exact dependency pins and workspace YAML settings. No dependency upgrade to latest ai: telemetry selection below matches 7.0.159.
- F3 has no HTTP/UI/SSE hub, product profiles, remote write adapters, approval expiry, customer quotas, or production K1 model execution. Production registries are empty. Smoke uses fixed synthetic input and stores no application data.
- Run start/advance/resume carry strict K3 ctx with orgId/userId UUIDs; the worker opens withTenant from ctx before run lookup, never SECURITY DEFINER run-to-org discovery. RunId and operationId are UUIDs; SDK-supplied IDs stay bounded opaque strings.
- Runtime capacity configuration is insert-or-compare: lexon_app SELECT/INSERT only; UPDATE/DELETE denied by migration0016. slot_bytes6291456 and per-org ceiling6 are fixed CHECK/config validation, raised only via reviewed migration/operator work.
- All tenant data uses `withTenant`, opaque `TenantSession`, authorization predicates, composite org/run FKs and FORCE RLS. Repositories/SQL stay in infrastructure/db; SDK imports stay in infrastructure/ai; infrastructure never imports modules; evals use only `@lexon/backend/evaluation`.
- At-least-once delivery; effectively-once logical effects. Model usage is unique per attempt; unknown attempts keep full durable reservations. Default per-step maximum attempts **2**. Every physical request has a persisted attempt except stateless smoke; `maxRetries: 0` everywhere. Hard output bound from profile.
- Conservative admission, not an absolute billing ceiling: no call unless reservation fits. Any reported over-reservation usage fails the run, retains partial output, and forbids further calls. Store estimate and reported input separately. Unknown cost remains NULL; reconciliation belongs to F17.
- Only initiator approves/rejects, once, matching hash and current policy, checked again on resume. Initiator access loss rejects operation and fails run. Platform/org roles do not confer approval authority.
- Write registration requires transactional/idempotency-key/reconcile mode. Only transactional execution ships; external recovery choices get unit tests. Stable operation persisted before execution; effect/receipt/result share one tenant transaction. No uncommitted model tool execution.
- Terminal jobs produce no model calls/events. Terminal stream marker atomically closes publishing; no later event follows it. PostgreSQL and Valkey commits are not falsely described as atomic. Stream failure does not stop durable progress.
- Accepted defaults: UTF-8 estimate plus documented overhead; **1000 ms** checkpoint interval plus size threshold; terminal TTL **3600 s**. Proposed revised MAXLEN/cap and development route/eval cost below require plan approval.
- Real execution needs valid dated `LEXON_OPENROUTER_ZDR_ONLY_VERIFIED`, key, ZDR-only account/guardrail excluding all Safety Retention, logging off, and operator key credit limit. Codex changes no account settings and calls no admin/generation-reconciliation endpoint. Explicit request privacy remains unconditional.
- No K1/K2 in diagnostic logs/traces/errors/queue failure strings. Only safe codes/IDs/sizes/timing. Secrets only in AI Worker/smoke/real-eval composition, never API/frontend/document-worker/dispatcher.

## Review Focus

1. A stopped worker resumes after a replacement owns the run: it must not settle usage, execute tools, append past final, or schedule continuation (Tasks 7, 8, 12).
2. Many short runs complete within the 3600-second TTL: retained streams must not defeat the active-run memory cap (Tasks 2, 7, 8).
3. Non-ASCII/hostile context and large tool schemas/results: estimation covers actual model-visible input, truncation preserves Unicode/structure and policy independently blocks writes (Tasks 3, 4, 10, 14).
4. Permissions change between approval/claim and a transactional write: authoritative checks serialize with membership changes; foreign caller cannot fail someone else's run (Tasks 4, 10, 11).
5. Provider returns usage/ID but connection breaks or DB commit fails: preserve early ID, count the new attempt separately, retain unknown reservation, never retry invisibly (Tasks 3, 5, 9, 12).

## Capacity calculation and proposed defaults for owner review

Streams budget: floor(768 × 1048576 × 0.30) = **241591910 bytes = 230.4 MiB**. Size JSON events INCLUDING Lexon envelope, IDs, SDK part and escaping; 1 KiB is the realistic sizing sample, **4096 bytes is the enforced maximum**. Larger text/tool-input deltas are split at UTF-8 boundaries; large whole-result events carry bounded operation metadata, not raw arguments/results. Full values remain in PostgreSQL. Stream protocol tests must prove the chosen parts still form valid UI messages; never silently discard a required protocol part.

Measured 2026-11-05 in a new network-isolated Linux/aarch64 container using `config/container-images.env` Valkey 9.0.7 digest `sha256:2d04268dfa26ab31cfa3fdc538866e76438b2d00e41db41b8cb86d780ac5a416`. One XADD field named event; versioned text-delta JSON padded to exact serialized size; exact MAXLEN; `MEMORY USAGE ... SAMPLES 0`; no consumer group:

| MAXLEN | Event bytes | Measured stream bytes |    MiB |
| ------ | ----------: | --------------------: | -----: |
| 10000  |        1024 |              12038488 | 11.481 |
| 10000  |        4096 |              51460568 | 49.077 |
| 1024   |        1024 |               1235520 |  1.178 |
| 1024   |        4096 |               5269728 |  5.026 |

Use `slotBytes = ceilToMiB(ceil(MAXLEN × maxEventBytes × 1.30) + 65536)` for conservative payload/allocator and guard/registry allowance; reserve a further **20% of the total Streams budget**. At MAXLEN 10000 and max 4096 this is 51 MiB/slot, supporting only floor(230.4 × 0.8 / 51) = **3 slots**. Too small. Proposed MAXLEN **1024** gives **6 MiB/slot**, floor(230.4 × 0.8 / 6) = **30 stream slots**: **24 active runs + 6 retained terminal streams** = **180 MiB**, leaving **50.4 MiB** of the budget. Compared with the measured worst stream, a 6 MiB slot also leaves about 1 MiB for guard/registry/allocation variance. This is sizing evidence, not a platform-independent exact memory guarantee: repeat on CI Linux/x64 and fail the sizing check if a slot exceeds 6 MiB; stop for revised sizing rather than silently raise caps.

`AI_MAX_ACTIVE_RUNS_PER_ORG=6` is an admission fairness limit enforced by the SAME trigger/transaction as the global cap, not a customer quota. Count queued/running/cancelling/awaiting_approval in both limits; terminal commit releases each exactly once. Org A at6 is refused without any run/outbox/slot rows while org B can still start.

`AI_MAX_ACTIVE_RUNS=24` is GLOBAL across all API/worker processes and tenants; queued/running/cancelling/awaiting_approval all count. A paused approval holds capacity until a valid decision/cancel; expiry is deliberately F5, so unanswered approvals can exhaust F3 admission across at least four organizations; one organization can hold at most6 slots. This is an explicit F3 operational limit, not hidden customer quota logic. Start must reserve admission in the SAME PostgreSQL transaction as run/outbox creation; terminal commit releases it. Per-org cap6 is admission fairness, not F17 customer quota logic. Migrator-owned trigger/single capacity row enforces concurrent admission; a per-process counter or RLS-filtered count is invalid.

Stream pool retains at most six terminal streams; terminal TTL is an upper bound, **oldest terminal stream may be deleted before 3600 s under pressure**. Active streams are never evicted for admission. Lifecycle/cleanup tracks only K3 IDs; expired/terminal guard+registry entries are bounded. If Valkey is unavailable, durable admission still applies and generation/checkpoints continue without stream buffering. A resumed old producer cannot recreate a reclaimed stream without current DB authorization. This early terminal eviction is a plan proposal, explicitly visible to the owner.

Configuration validates all coupled values at boot: actual declared Valkey maxmemory, fraction ≤0.30, event/MAXLEN bounds, slot formula, headroom, active+terminal count. Store effective capacity configuration in one DB singleton; differing process configurations fail boot, rather than racing different limits. Defaults: interactive concurrency **4**, batch **2**, per-organization simultaneously executing steps **2** for architecture section5.3 scheduling fairness (distinct from F17 customer quotas); max active **24**; lease **30000 ms**, renew **5000 ms**; checkpoint **1000 ms OR 8192 changed UTF-8 bytes**; cancel DB poll **1000 ms**; model call timeout **60000 ms**; stream write deadline **250 ms**. Checkpoint threshold means earlier writes on size, not delaying indefinitely for both conditions.

## Provider and real-eval proposals for owner review

- Dev allowlist: `{id:"openai/gpt-6-luna",provider:"azure/us",region:"us",zeroDataRetention:true,reviewedAt:<actual review timestamp>}`. The public catalog exposes azure/us. It is more specific and reproducible than base azure, which may span regions. Synthetic development only, no production cross-border approval inferred. Request `only:["azure/us"]`, matching order, no fallback, ZDR true, data collection deny. Record actual response provider and selected regional route evidence; do not claim an unreported physical datacenter.
- Real eval schedule: **manual only** (`workflow_dispatch`), no cron. Proposed budget **USD 0.10 per invocation**, maximum **16 physical model calls**, per-call output **512 tokens**, input admission **16384 estimated tokens**, total command timeout **5 minutes**. Sequential cases; unknown-cost calls retain their reserved money as well as token reserve.
- Use a reviewed eval price ceiling **USD 0.25/M input, USD 1.00/M output**, sent through provider max_price and checked in local price reservations. Worst admitted call reserve `(16384×0.25 + 512×1)/1000000 = USD 0.004608`; 16 calls reserve USD 0.073728. Token estimate caveat still applies. Reported overrun halts immediately. Fixed suite contains three synthetic cases (plain completion, hostile context, approval-protected write), total physical request ceiling includes retries.
- Operator configures a key credit allocation **no greater than USD 0.10 for that manual invocation**, without concurrent other consumers; replenishment/reset is operator-owned and never automated by Codex. Attestation covers this allocation. Local admission and max_price are not falsely called an absolute billing limit. Workflow serializes real-eval invocations and exposes neither content nor secrets. Smoke uses one request, **128 output tokens**, **30-second timeout**, with the same attestation/key safeguard; no retry.

## File structure and interfaces

Paths below are exact planned ownership, not scaffolding permission. Export domain services only through module `index.ts`; private repositories stay in db. Add migrations 0015 (engine/attempt/admission), 0016 (capacity privilege correction), 0017 (worker actor facts), 0018 (operations), 0019 (AI audit types/permissions if needed), with append-only journal entries; never edit applied migrations. Test-only effect tables belong to testing helpers.

| Area                | Files / responsibility                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Portable contracts  | shared/src/ai-run.ts (status, errors, job/stream schemas), shared/src/index.ts exports                                                                                                                                                                                               |
| Chat domain         | backend/src/modules/chat/{index.ts,chat.module.ts,run-contracts.ts,run-registry.ts,run-state.ts,run.service.ts,step-coordinator.ts,step-executor.ts,tool-executor.ts,approval.service.ts,cancel.service.ts,untrusted-context.ts,canonical-operation.ts}                              |
| Usage               | backend/src/modules/usage/{index.ts,usage.module.ts,attempt.service.ts,token-estimator.ts,attempt-budget.ts}                                                                                                                                                                         |
| Identity            | backend/src/modules/identity-access/{run-capability-policy.ts,run-authorization.service.ts,index.ts}; standalone worker-safe module in run-authorization.module.ts                                                                                                                   |
| Database            | backend/src/infrastructure/db/{ai-records.ts,ai-run.repository.ts,ai-step.repository.ts,ai-attempt.repository.ts,ai-operation.repository.ts,ai-capacity.repository.ts,run-actor-facts.ts,index.ts,db.module.ts,schema.ts,outbox.repository.ts,job-envelope.ts}; new migrations above |
| Model boundary      | backend/src/infrastructure/ai/{model-contracts.ts,model-gateway.ts,provider-stream.ts,real-model-prerequisites.ts,provider-errors.ts,index.ts,ai.module.ts}; test mock factories only in testing/scripted-model.ts                                                                   |
| Queue/streams       | backend/src/infrastructure/queue/{run-streams.ts,run-stream-scripts.ts,stream-capacity.ts,cancel-signals.ts,queue-producer.ts,queue-consumer.ts,index.ts}; backend/src/modules/platform/job-registry.ts                                                                              |
| Runtime / telemetry | backend/src/{config/ai-config.ts,config/runtime-config.ts,bootstrap/runtime-providers.ts,bootstrap/runtime-lifecycle.ts,entrypoints/ai-worker/root.module.ts,infrastructure/telemetry/ai-telemetry.ts,infrastructure/telemetry/index.ts}; no auth root in worker                     |
| Evaluation/operator | backend/src/evaluation/{index.ts,evaluation.module.ts,evaluation-contracts.ts,evaluation-harness.ts}; backend/src/entrypoints/ai-smoke/main.ts; evals/src/real-evals.ts; evals/test/f3-engine.spec.ts; evals/global-setup.ts; .github/workflows/real-evals.yml                       |
| Evidence            | docs/references/F3-acceptance.md; docs/references/F3-stream-memory.json (research now, reproducible integration proof later)                                                                                                                                                         |

Core types and neutral types defined by Task 1: `RunProfile`, `RunActor`, `ModelInput`, `ModelEvent`, `ModelOutcome`, `ModelGateway`, `StepClaim`, `ToolDefinition`, `EngineRegistrations`. StepClaim is DB-owned in ai-records.ts (Task1 type only); persistence records extend it in Task2. Identity owns RunActor. These placements prevent infrastructure-domain or Identity/Chat dependency cycles. Domain-neutral wire/input types belong in infrastructure/ai/model-contracts.ts; Chat contracts import public AI types rather than exposing SDK types. No circular domain→infrastructure→domain imports. `RunActor` (Identity-owned) uses explicit user/org/session IDs and MFA timestamp from a server-verified invocation; untrusted job payload never mints one. Worker rechecks stored actor facts independently of the browser session lifetime.

## Task execution rule

Each task below has one RED→minimal implementation→GREEN cycle and a commit. Before that commit run the listed focused verification and applicable package lint/typecheck, record main-session spec/quality review and exact evidence in F3-acceptance. Push only after task acceptance. Root remains on the feature branch. Do not mark unrun integration tests green or a schema-only task as the whole feature complete.

---

### Task 1: Define run contracts, state transitions and registration

**Files:** Create `shared/src/ai-run.ts`, `shared/test/ai-run.spec.ts`, `backend/src/modules/chat/{run-contracts.ts,run-registry.ts,run-state.ts,index.ts}`, `backend/src/infrastructure/ai/model-contracts.ts`, `backend/test/unit/{run-state.spec.ts,run-registry.spec.ts}`, `backend/src/infrastructure/db/ai-records.ts` (StepClaim only), `backend/src/modules/identity-access/run-actor.ts`; modify their public index.ts type exports; modify shared/src/index.ts; create F3-acceptance.md.

**Interfaces:** Produces `RunStatusSchema`, `RunErrorCodeSchema`, `RunJobSchema`, `RunStreamEventSchema` (version 1); `RunProfile` with id/version, allowed/default models, queue/priority, maxIterations, tokenBudget, maxOutputTokens, maxAttemptsPerStep defaults to2 with positive safe-integer server-profile overrides, context budgets, capability names and optional child depth/budget bounds (no child implementation). `RunActor` is opaque identity evidence defined in identity-access/run-actor.ts, re-exported by Identity and minted only there; Chat consumes its public type, Identity never imports Chat. `StepClaim={runId,orgId,userId,sequence,expectedVersion,fence,leaseUntil}` is defined in db/ai-records.ts and re-exported through db/index.ts, never imported by infrastructure from a domain module. `EngineRegistrations={profiles,contexts,tools}`. `RunRegistry.register(registrations):void` and `canTransition(from:RunStatus,to:RunStatus):boolean`. Neutral `ModelInput` holds text/JSON messages, schemas, model/provider, maxOutputTokens and AbortSignal; `ModelEvent` is a finite metadata/text/tool-proposal/usage union; `ModelOutcome` carries stop/tool_calls/error, optional generation/provider/usage/cost and safe code. ReportedUsage={inputTokens:number;outputTokens:number;cachedInputTokens?:number;reasoningOutputTokens?:number}; nullable unknown values remain absent, not coerced to0. Cost is a decimal USD string. `ModelGateway.generate(input:ModelInput):AsyncIterable<ModelEvent>`; no ai SDK imports here. `ToolDefinition` discriminates read from write and transactional/idempotency-key/reconcile modes, with timeout/result-size/schema/capability/approval contracts. Remote callbacks receive stable operationId, but no real implementation ships.

**Research:** Design Research notes: SDK UI protocol/types and tools; Node crypto; installed Zod 4.6.7; architecture section 4.7. Re-read referenced sections and bundled definitions before selecting event fields.

- [x] **Step 1: Write the failing tests.** Named tests `legal transition matrix`, `reject unversioned or content-bearing jobs`, `write registration requires idempotency mode`, `duplicate profile/tool ids rejected`, `read tool needs no mode`, `external mode requires its declared callback`, `empty production registry`. Assert `canTransition('completed','running') === false`, `canTransition('running','awaiting_approval') === true`; malformed queue/model caller flags fail `.safeParse(...).success`; all seven statuses and finite safe codes are covered. Include runtime-invalid registrations, not just TypeScript assertions.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(canTransition('completed', 'running')).toBe(false);
expect(canTransition('running', 'awaiting_approval')).toBe(true);
expect(() => registry.register(writeWithoutMode)).toThrow();
```

- [x] **Step 2: Observe RED.** Run `pnpm exec vitest run --project contracts --project backend-unit ai-run.spec run-state.spec run-registry.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [x] **Step 3: Implement the deliverable.** Write strict versioned Zod unions and pure registry/state logic, with no side effects. Job kinds are run.start.v1, run.advance.v1, run.resume.v1 plus existing platform.noop.v1 compatibility; ID-only payload contains runId, sequence, expectedVersion. Define safe codes AI_BUDGET_EXCEEDED, AI_ATTEMPT_LIMIT, AI_ITERATION_LIMIT, AI_ACCESS_REVOKED, AI_MODEL_FORBIDDEN, AI_PROVIDER_UNAVAILABLE, AI_PROVIDER_AUTH, AI_INVALID_TOOL, AI_TOOL_TIMEOUT, AI_TOOL_OUTCOME_UNKNOWN, AI_CAPACITY_EXCEEDED, AI_INTERNAL. Tool callbacks use the opaque tenant transaction type only in backend contracts, never shared. Define ContextProvider.collect({actor,runId,input,budget}):Promise<{label:string;text:string}[]>; registry applies its profile budget before contribution. Registered fixture/tool limits are input<=16384 UTF-8 bytes, result<=16384 bytes, timeout5000ms unless a stricter profile limit; profile bootstrap rejects limits above config maxima. Keep provider-native/UI part translation inside AI boundary.

- [x] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project contracts --project backend-unit ai-run.spec run-state.spec run-registry.spec`; expect all selected tests PASS. Build contracts; backend typecheck; confirm no SDK/Node dependency added to shared. Unit test command project name must match shared/vitest.config.ts (contracts); do not change the project to fit a guessed command.

- [x] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): define run contracts, state transitions and registration`, then `git push -u origin f3-ai-run-engine`.

### Task 2: Persist tenant state and enforce global admission

**Files:** First modify shared/src/ai-run.ts and shared/test/ai-run.spec.ts for owner Task1 review corrections; then create backend/drizzle/0015_ai_engine.sql and journal entry, extend db/ai-records.ts, create db/{ai-run.repository.ts,ai-step.repository.ts,ai-attempt.repository.ts,ai-capacity.repository.ts}; modify db/{schema.ts,index.ts,db.module.ts}; create db/testing/ai-fixture.ts, backend/test/integration/{ai-storage.spec.ts,ai-capacity.spec.ts}, backend/test/unit/ai-config.spec.ts; create config/ai-config.ts; modify config/runtime-config.ts.

**Interfaces:** Consumes Task 1 status/job types. Produces DB-owned `RunRecord`, `AttemptRecord`, `StepRecord` and `StepCommit` structures corresponding to design fields; repositories expose only `TenantSession` methods. `AiRunRepository.insert(tx,input):Promise<RunRecord>`, `find(tx,runId):Promise<RunRecord|null>`, `transition(tx,{runId,expectedVersion,from,to,errorCode?}):Promise<boolean>`; `AiStepRepository.find(tx,{runId,sequence}):Promise<StepRecord|null>`, `claim(tx,{runId,sequence,expectedVersion,leaseMs}):Promise<StepClaim|null>`, `renew(tx,claim,leaseMs):Promise<boolean>`, `checkpoint(tx,claim,{attemptId,text}):Promise<boolean>`, `commit(tx,claim,commit:StepCommit):Promise<boolean>`; `AiAttemptRepository.insert(tx,claim,record:AttemptRecord):Promise<void>`, `updateMetadata(tx,claim,input:{attemptId:string;generationId:string;provider?:string}):Promise<boolean>`, `settle(tx,claim,input:{attemptId:string;outcome:'succeeded'|'failed'|'unknown';usage?:ReportedUsage;costUsd?:string}):Promise<boolean>`, and `list(tx,runId:string):Promise<AttemptRecord[]>` are expected-state primitives; ReportedUsage is the neutral model-contracts token breakdown. DB record shapes never import Chat/Usage types. `AiCapacityRepository.configure(config):Promise<void>` validates one singleton; no raw connection export. `readAiConfig(env):AiConfig` computes slots and validates all capacity numbers above.

**Research:** PostgreSQL 17 locking/RLS/NOTIFY and CREATE FUNCTION; Drizzle 0.45.4 migration conventions; design sizing addendum and measured JSON. Read installed migration source and existing 0014 journal format.

- [x] **Step 0: Correct Task1 contracts before repositories consume RunJobSchema (owner review).** Write RED tests first: run.start/advance/resume require strict ctx={orgId:uuid,userId:uuid}; missing/malformed ctx or either ID fails. RunId and ALL operationId fields (approval-required and operation-status) use z.uuid(). Lexon-generated messageId uses UUID; SDK-origin text/tool/approval part IDs remain opaque bounded strings (proposed max256 code units), preserving the SDK value rather than trimming it. Test legitimate SDK ids, invalid Lexon UUIDs and overlength IDs. Run `pnpm exec vitest run --project contracts ai-run.spec` and observe behavioral RED before implementation. Implement, run GREEN, rebuild contracts and backend typecheck; record as Task1 review corrections in F3-acceptance before any new repository uses the schema. No SECURITY DEFINER run-to-org lookup: future worker opens withTenant(job.ctx), then tenant-scoped run lookup. Task7 flow7 proves mismatched ctx.orgId reads/writes nothing.

- [x] **Step 1: Write the failing tests.** Tests `cross-tenant child FK rejected`, `fresh and reused no-context queries empty`, `24th admitted 25th refused` (spread across at least four organizations), `org A at6 refused while org B starts`, `org refusal leaves no run/outbox/slot rows`, `terminal releases org slot exactly once`, `two starts compete for last global slot`, `rollback releases admission`, `terminal commit releases exactly once`, `approval pause retains slot`, `inconsistent process cap refuses boot`. Use at least four organizations to reach global24 under org6, two tenant fixtures for isolation/org-fairness checks, and independent DB connections, never a migrator for runtime assertions. Assert the losing start creates zero run/outbox/admission rows. Config tests assert MAXLEN=1024,eventBytes=4096,slotBytes=6291456,maxActive=24,maxActivePerOrg=6,terminal=6; active+terminal=31 is rejected under default budget.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(admittedRunCount).toBe(24);
expect(losingStartRunRows).toHaveLength(0);
expect(losingStartOutboxRows).toHaveLength(0);
```

- [x] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-integration --project backend-unit ai-storage.spec ai-capacity.spec ai-config.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [x] **Step 3: Implement the deliverable.** Create app.ai_runs, app.ai_steps, app.ai_attempts (Usage-owned records), app.ai_checkpoints, plus ops.ai_engine_capacity and ops.ai_run_slots containing K3 only; add default-compatible queue/priority routing columns to ops.outbox in this migration for Task6. Add per-org composite FKs, unique (run,sequence), (step,attempt ordinal), unique attempt id, decimal cost, separate estimated/reported input, reserved output, generation ID, active/settled outcome fields. Claims use atomic row/version/fence checks with clock_timestamp, never app clock for expiry. An expired takeover and marking that lost fence's still-active attempts unknown occur in the SAME short transaction; a new owner may not erase already-settled usage. StepRecord exposes lease/fence/state so coordinator can distinguish live-busy from old/terminal/noop without treating null as completed. Admission trigger locks the singleton, counts BOTH global ops slots and current-org active slots (default6), inserts/deletes slots with run state in the same transaction; runtime cannot bypass by naming another tenant. Capacity boot validation is a short infrastructure-owned transaction, no secret-bearing errors. Bound string/JSON sizes before storage, no tool table yet. Use selected exact memory inputs; store config fingerprint and fail differing process settings.

- [x] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-integration --project backend-unit ai-storage.spec ai-capacity.spec ai-config.spec`; expect all selected tests PASS. Run existing tenant-isolation.spec and auth-privileges.spec alongside new tests; check app/auth grants unchanged except explicitly new tables. No RLS bypass or exported pg/drizzle handle.

- [x] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): persist tenant state and enforce global admission`, then `git push -u origin f3-ai-run-engine`.

### Task 3: Account model attempts and durable token reservations

**Files:** First create backend/drizzle/0016_ai_capacity_privileges.sql + append-only journal entry; modify db/ai-capacity.repository.ts and integration/ai-capacity.spec.ts/testing fixture for owner correction; then create modules/usage/{attempt.service.ts,attempt-budget.ts,token-estimator.ts,usage.module.ts,index.ts}; create backend/test/unit/{token-estimator.spec.ts,attempt-budget.spec.ts} and backend/test/integration/ai-attempts.spec.ts; extend db/ai-attempt.repository.ts only for required primitives.

**Interfaces:** Consumes Task 2 repositories/records. `estimateInputTokens(input:ModelInput):{version:1,inputTokens:number}` excludes AbortSignal/non-model metadata and uses the canonical model-visible serialization formula in the design. `AttemptService.reserve(tx,claim,{attemptId,modelInput,limits:{maxAttemptsPerStep,tokenBudget,maxOutputTokens}}):Promise<AttemptRecord>`; Usage consumes this neutral policy projection, never imports Chat or RunProfile; `metadata(tx,claim,{attemptId,generationId,provider?}):Promise<void>`; `settle(tx,claim,{attemptId,outcome:'succeeded'|'failed'|'unknown',usage?,costUsd?}):Promise<{budgetExceeded:boolean}>`; `remaining(tx,runId):Promise<number>`. Metadata/usage are state-checked and unique by attempt UUID; no call to provider.

**Research:** AI SDK 7.0.159 token breakdown/usage accounting, OpenRouter README cost metadata, PostgreSQL decimal arithmetic and row locks; approved estimator/budget correction.

- [x] **Step 0: Apply Task2 owner least-privilege correction first.** Write behavioral RED asserting lexon_app UPDATE is denied on ops.ai_engine_capacity; DELETE also denied. Add a NEW migration0016 revoking UPDATE/DELETE, never modify0015. Keep only SELECT/INSERT needed for insert-or-compare. PostgreSQL SELECT FOR UPDATE also requires UPDATE privilege: remove that clause from the runtime configure comparison, retaining its existing advisory transaction lock. Test a separate connection/process-equivalent capacity repository with the same fingerprint succeeds; a second with a different fingerprint fails specifically with safe configuration mismatch (not privilege failure). Run `pnpm exec vitest run --project backend-integration ai-capacity.spec`, record RED/GREEN, and note owner correction plus fixed slot_bytes6291456/per-org maximum6 in acceptance before continuing accounting. Raising either fixed CHECK/config ceiling requires a reviewed migration/operator step. No runtime UPDATE grant workaround.

**Domain ownership clarification:** Usage persists actual settlement and returns budgetExceeded; it does not implement Chat lifecycle transitions. A recorded over-reservation attempt must make every later reserve fail even after restart and even if the aggregate remaining amount is positive. Task9 atomically persists the final failed run/error/partial output using that flag. Do not throw after persisting usage in settle, which would cause the caller transaction to roll it back.

**Accounting storage convention:** one run token budget is the sum of persisted inputBudgetTokens and outputBudgetTokens, not two independently refillable pools. Reserve must validate the trusted server limits.tokenBudget matches that stored total and modelInput.maxOutputTokens matches the enforced profile limit; remaining reads the stored total after restart. Task7 profile-to-record mapping must preserve this total. Partial reported usage retains the missing component's reservation; unknown always retains both original components. No unknown→zero coercion.

- [x] **Step 1: Write the failing tests.** Named tests `unknown keeps whole reserve after restart`, `failed with no usage keeps reserve`, `reported usage replaces reserve`, `partial usage keeps missing component reserve`, `unknown retains reserve even if metadata carries usage`, `over-reserve fails and blocks next reservation`, `two concurrent reservations cannot overspend`, `attempt 3 rejected at default 2`. Formula assertion: empty model-visible UTF-8 serialization bytes + 64 per message + 256 per tool + 1024 framing; include emoji/Indonesian, schemas, context and tool results, and overflow/NaN rejection. SQL tests create a NEW AttemptService after first commit, proving no in-memory budget source. Cost null stays null; zero known cost stays zero.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(reloadedRemainingTokens).toBe(runBudget - unknownReservation);
expect(knownAttempt.reportedInputTokens).toBe(17);
expect(settlement.budgetExceeded).toBe(true);
await expect(nextReservation).rejects.toMatchObject({
  code: 'AI_BUDGET_EXCEEDED',
});
```

- [x] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit --project backend-integration token-estimator.spec attempt-budget.spec ai-attempts.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [x] **Step 3: Implement the deliverable.** Implement exact integer token arithmetic and decimal cost persistence. All attempts, including failed/unknown, count toward per-step max; model iteration is independent. Unknown usage never becomes zero. A completion with reported usage exceeding the attempt reservation is persisted truthfully and returns budgetExceeded so run finalization fails, keeping partial output. Store estimation version and estimated input before the request. Settling the same attempt twice cannot duplicate usage or release a reservation twice.

- [x] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit --project backend-integration token-estimator.spec attempt-budget.spec ai-attempts.spec`; expect all selected tests PASS. Backend lint/typecheck; include duplicate settlement/reused session rejection and rollback tests.

- [x] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): account model attempts and durable token reservations`, then `git push -u origin f3-ai-run-engine`.

### Task 4: Authorize worker runs and fence untrusted context

**Files:** Create db/run-actor-facts.ts, backend/drizzle/0017_run_actor_facts.sql + journal; create modules/identity-access/{run-authorization.service.ts,run-authorization.module.ts,run-capability-policy.ts}; modify identity-access/index.ts and db/index.ts; create modules/chat/{untrusted-context.ts,canonical-operation.ts}; tests backend/test/unit/{run-capability.spec.ts,untrusted-context.spec.ts,canonical-operation.spec.ts}, backend/test/integration/run-authorization.spec.ts.

**Interfaces:** `RunAuthorizationService.withActor(identity:VerifiedIdentity,work:(actor:RunActor)=>Promise<T>):Promise<T>` validates existing active verified scope and mints opaque RunActor; `authorize(tx,actorFacts,policy:{profileId:string;capabilities:readonly string[]},phase:'start'|'resume'|'tool'|'decision'|'cancel'):Promise<CapabilityDecision>` (Identity never imports Chat profile types); policy `decideRunCapabilities(input:RunPolicyFacts):CapabilityDecision` is the ONE eligibility function, including approver rules. `RunActorFacts` contains only IDs, user verified/banned/2FA flags, membership role, org kind/state/require2fa and trusted run-auth evidence. `fenceUntrusted(text:string,label:string):string`; `canonicalOperationHash({toolId,toolVersion,args}):string` uses deterministic key ordering and SHA-256.

**Research:** Architecture authorization/break-glass; PostgreSQL narrow SECURITY DEFINER, safe search_path and locks; existing auth per-column privileges and F1 parent-org mutation locks; Node 24 crypto. No Better Auth SDK changes.

- [x] **Step 1: Write the failing tests.** Assert membership loss/ban/provisioning org denies; role alone never permits another initiator approval; MFA-required org cannot reuse insufficient evidence; decision caller mismatch has no run mutation. Test concurrent membership removal against a transactional effect using matching parent-org lock order. Hostile text containing guessed delimiters is fenced with fresh collision-free nonce; canonical hash ignores object-key insertion order but changes for args/tool version, rejects non-JSON input.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(decideRunCapabilities(otherInitiatorFacts).mayDecide).toBe(false);
expect(canonicalOperationHash(firstKeyOrder)).toBe(
  canonicalOperationHash(secondKeyOrder),
);
expect(executedUnapprovedWrites).toBe(0);
```

- [x] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit --project backend-integration run-capability.spec untrusted-context.spec canonical-operation.spec run-authorization.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [x] **Step 3: Implement the deliverable.** Narrow migrator-owned auth facts function checks tenant context, has fixed search_path, no credential columns, PUBLIC execute revoked and lexon_app-only execute. It returns facts, makes NO policy decision, and locks current org/user/member rows in F1-compatible order for effect/decision transactions; no long lock during model I/O. Worker-safe module composes this facade and policies without IdentityAccessModule.forPolicy/auth SDK/HTTP. RunActor is minted from server verification at start/decision; worker rechecks membership using persisted actor IDs and MFA evidence, never accepting flags from job data. Context fencing is defense in depth; tool policy remains the security boundary.

- [x] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit --project backend-integration run-capability.spec untrusted-context.spec canonical-operation.spec run-authorization.spec`; expect all selected tests PASS. Boundary fixtures prove infra cannot import this policy and worker graph does not import Better Auth. Run existing F1 membership-concurrency tests if locking is touched.

- [x] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): authorize worker runs and fence untrusted context`, then `git push -u origin f3-ai-run-engine`.

### Task 5: Implement guarded single-generation model adapter

**Owner clarification before adapter work (2026-11-05):** Task4 user/member FOR UPDATE was a conservative default, not an F1 protocol requirement. First add behavioral RED for two same-user runs authorizing concurrently, then a NEW `backend/drizzle/0018_ai_authorization_shared_reads.sql` and journal entry replacing only those lock modes with FOR SHARE; organization remains FOR SHARE. Never edit or renumber accepted migrations0015–0017. Extend run-authorization integration fixtures/tests as needed. Authorization is called only in short tenant transactions, never across model or Valkey I/O. Prove that both same-user runs can pass authorization without waiting for the other's whole step, with explicit transaction/step barriers and real PostgreSQL. Retain F1 selection and same-actor removal regressions. Record the rationale in acceptance notes. This shifts the still-future operation migration to0019 and optional audit migration to0020.

Task 5 implementation clarification (2026-11-05): OpenRouter 3.1.0 reports cost as a JavaScript number while Task 3's `numeric(20,10)` would round valid higher-scale prices. Migration0018 also widens `cost_usd` to unconstrained exact PostgreSQL numeric and adds finite/nonnegative validation; repository boundary canonicalizes decimal strings up to512 characters. Convert finite provider numbers through shortest `number.toString()` and string-only exponent expansion, with no floating-point currency arithmetic or rounding. Test mocked provider SSE cost through real `AttemptService.settle` and PostgreSQL reload. ModelInput tool history now uses neutral assistant text/tool-call parts and tool-result parts; exact AI SDK v7 mapping is verified against installed prompt part definitions and retains opaque call IDs and JSON payloads. This is an infrastructure contract refinement only; it adds no Chat/lifecycle execution.

**Files:** Create ai/{model-gateway.ts,provider-stream.ts,provider-errors.ts,real-model-prerequisites.ts,testing/scripted-model.ts}; modify ai/{index.ts,ai.module.ts,openrouter-provider.ts}, backend/config/model-allowlist.json and config/ai-config.ts; tests in backend/src/infrastructure/ai/{model-gateway.spec.ts,provider-stream.spec.ts,real-model-prerequisites.spec.ts}; update F0 allowlist assertion to F3 reviewed dev config without weakening missing-region/ZDR tests.

**Interfaces:** Implements Task 1 `ModelGateway.generate`, whose `ModelEvent` stream now includes terminal `ModelOutcome` with succeeded/failed/unknown attempt classification. `createRealModelGateway({allowlist,key,attestation,fetch?}):ModelGateway` enforces prerequisites before fetch. `createScriptedModelGateway(scripts:ModelScript[]):ModelGateway` is test/evaluation composition only; ModelScript is neutral JSON events, no raw SDK model returned. Early metadata is yielded and consumer-acknowledged before later content proceeds. `validateRealModelPrerequisites(env):{verifiedOn:string}` refuses invalid/missing/future attestation dates with fixed explanatory copy, without exposing key. Neutral model history explicitly represents assistant tool calls and matching tool results; schema-invalid or orphaned results fail before fetch.

**Research:** See Task 5 research notes in the approved design for exact sources, versions, dates, and decisions: installed provider 3.1.0 dist response-metadata/usage source; AI SDK streamText 7.0.159 source, v4 mock and model message types; provider routing/ZDR docs and public azure/us endpoint; PostgreSQL 17 exact numeric and Drizzle0.45.4 migration behavior. Exact dev route entry is `{id:"openai/gpt-6-luna",provider:"azure/us",region:"us"}`; provider request sends both `only` and `order` as `['azure/us']`. `reviewedAt` is the allowlist research review date, not the separate account ZDR attestation date.

- [x] **Step 1: Write the failing tests.** Outgoing-fetch tests assert model `openai/gpt-6-luna`, exact allowlist provider `azure/us`, only/order `azure/us`, allow_fallbacks=false, ZDR=true, data_collection=deny and maxOutputTokens mapping on every request. A mismatched input provider/model and absent key/attestation give zero fetch calls. A retryable 503 causes exactly one fetch per generate invocation. Hold the actual parsed stream after metadata: a test consumer persists generation ID with a short tenant transaction while finish/content are still gated, then release it; abort reaches transport; provider body containing K1/key appears in no safe outcome. Tool history tests carry opaque call IDs and matching JSON results. Test usage with reasoning/cache details, exact cost through settlement/reload, and unknown/malformed error mapping.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(request.provider).toMatchObject({
  only: ['azure/us'],
  zdr: true,
  data_collection: 'deny',
  allow_fallbacks: false,
});
expect(fetchSpy).toHaveBeenCalledTimes(1);
expect(generationIdPersistedBeforeFinish).toBe(true);
```

- [x] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit model-gateway.spec provider-stream.spec real-model-prerequisites.spec ai-compatibility.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [x] **Step 3: Implement the deliverable.** Use streamText once with maxRetries:0 and no executable SDK tools; tool definitions advertise schemas while Chat controls durable operations. Wrap the v4 model stream boundary to capture response metadata before AI SDK's high-level stream hides it; yield neutral metadata in order and await consumer persistence. Translate SDK protocol/usage/finish parts into ModelEvent without logging raw payloads. All telemetry recording explicitly false. Transport interruption or caller abort without authoritative final outcome settles as unknown (retains reserve); an explicit definitive provider failure settles failed, retaining reserve unless usage is reported. Do not falsely label an uncertain remote charge as a known zero-cost failure. Production allowlist uses proposed azure/us only after plan approval; no model fallback. Keep provider max_price as optional reviewed operator/eval constraint, not user-supplied selection.

- [x] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit model-gateway.spec provider-stream.spec real-model-prerequisites.spec ai-compatibility.spec`; run focused real PostgreSQL authorization and AI attempt integration tests including mocked-provider cost settlement/reload; expect all selected tests PASS. Run backend lint/build/typecheck and no-global-fetch mock test. Store no real key, verification date or smoke content in fixtures.

- [ ] **Step 5: Review, record, commit.** Record commands/results in `docs/references/F3-acceptance.md`; stage only this task's files and evidence and commit `feat(f3): implement guarded single-generation model adapter`. Push is not part of this task instruction.

### Task 6: Route deterministic step jobs through F0 queues

**Files:** Create modules/platform/job-registry.ts and modules/chat/step-job-id.ts; modify platform/index.ts, db/{job-envelope.ts,outbox.repository.ts,schema.ts}, queue/{queue-producer.ts,queue-consumer.ts,index.ts}; tests backend/test/unit/step-job-id.spec.ts and backend/test/integration/ai-queue-routing.spec.ts.

**Interfaces:** `stepJobId(runId:string,sequence:number):string` UUID-v5 using DNS namespace and name `lexon/run/<uuid>/step/<sequence>`. `OutboxRepository.append(tx,job,{id?,queue?,priority?}?):Promise<string>` retains old call compatibility; deterministic conflict must match immutable payload/routing. `JobRegistry.register(type,handler):void`, `resolve(type):handler`; durable handler returns `Promise<{kind:"done"}|{kind:"busy";retryAtMs:number}>`; handler declares short-transaction or durable-step dispatch strategy. `QueueProducer.enqueue` uses validated persisted queue/priority, jobId=outboxId; `QueueConsumer.start(registry)` registers ai-interactive/batch processors with independent concurrency. An application-owned per-org permit limits executing steps to2 across both queues (LEX-ARC5.3); permit state uses bounded limiter-prefix Valkey keys, never Streams budget or a caller flag. DB claim acquisition also serializes/counts live leases within that tenant to prevent lease-expiry races from admitting extra executing steps; an unavailable permit defers without a model request.

**Research:** BullMQ6 job IDs/priorities/retries and Nest12 integration; Node crypto UUID construction; PostgreSQL NOTIFY transaction semantics and current outbox claim/markSent code.

- [ ] **Step 1: Write the failing tests.** Tests deterministic UUID reference vector, different sequence differs, negative/unsafe seq rejected. Queue routing test sends start/advance/resume through both queues, checks stable IDs and priorities, retries duplicate append with matching vs different payload, and verifies only worker composition instantiates consumers. Preserve platform.noop.v1 tests and F0 receipt-redelivery crash tests. Unknown type is safe-invalid, not a no-op success. Two orgs test fairness: two held steps inorgA defer a third while orgB can execute; permits expire/renew/clean after worker death. This does not add per-org active-run or token/cost quotas.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(bullJob.id).toBe(outboxRow.id);
expect(bullJob.opts.priority).toBe(profile.priority);
expect(delayedBusyJob.attemptsMade).toBe(0);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit --project backend-integration step-job-id.spec ai-queue-routing.spec dispatcher.spec worker-crash.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Extend F0 transport rather than replacing dispatcher. Use the queue/priority columns added by Task2 for K3 claimed routing; registry never decides capabilities/model selection. Durable-step processors call coordinator/executor outside JobExecutor transaction; short transactional handlers retain executor behavior. Keep attempts=3/backoff250/completion/failure retention for actual failures. A busy valid claim returns typed `{kind:"busy",retryAtMs:number}`; processor calls `job.moveToDelayed(retryAtMs,token)` then throws BullMQ DelayedError, handled before generic error sanitization, so a healthy lease wait does not consume failure attempts. Once the owner loses its fence, a delayed delivery can claim; test this with a lease longer than the ordinary3failure retry window. Do not acknowledge a live claim as completed; represent a busy claim as delayed work, while finished/old/terminal deliveries are harmless acknowledged no-ops.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit --project backend-integration step-job-id.spec ai-queue-routing.spec dispatcher.spec worker-crash.spec`; expect all selected tests PASS. Run dispatcher integration proving NOTIFY wake and polling fallback unchanged; boundaries and backend typecheck.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): route deterministic step jobs through f0 queues`, then `git push -u origin f3-ai-run-engine`.

### Task 7: Start runs and coordinate fenced durable steps

**Files:** Create modules/chat/{run.service.ts,step-coordinator.ts,chat.module.ts}; extend Chat index/DB repositories as required; create backend/test/setup/ai-harness.ts (explicit storage/policy/gateway/registry composition) and backend/test/integration/{ai-run-start.spec.ts,ai-step-concurrency.spec.ts}; modify worker root only to compose interfaces, not activate incomplete production profiles.

**Integration handoff from Task2 review:** Before any run can start or worker consumer can execute, production composition must call `AiCapacityRepository.configure` with the validated server config. Test actual boot/config-mismatch refusal, not only the repository method. Wire API/worker/evaluation composition that creates or consumes runs consistently; do not read secrets or discover tenant ownership from a run ID. Flow7 must open withTenant from job.ctx, then find the run: mismatched ctx.orgId reads/writes nothing.

**Interfaces:** `RunService.start(actor:RunActor,input:{profileId:string;prompt:string}):Promise<{runId:string}>`; `StepCoordinator.claim(job:RunJob):Promise<{kind:"claimed";claim:StepClaim}|{kind:"busy";retryAtMs:number}|{kind:"noop"}>`; `renew(claim):Promise<boolean>`; `commit(job,claim,commit:StepCommit):Promise<'committed'|'stale'>`. StepCommit includes step output, outcome, attempt settlement, stored operation proposals and optional continuation kind. Commit invokes existing JobExecutor.execute with receipt/effects in same transaction. Run version/sequence is the optimistic precondition, fence prevents stale owner. ai-harness.ts produces `createAiHarness(services,registrations,gateway)` with start/dispatch/drain/inspect/close methods, using real DB repositories and policy; no fake persistence.

**Research:** Design protocol and Postgres row locks; F0 JobExecutor actual implementation, receipt contention and caller-supplied TenantSession; current worker/module graph.

- [ ] **Step 1: Write the failing tests.** Tests `start run+outbox atomic`, `profile/model denial before network`, `two concurrent deliveries one active claim`, `old owner cannot checkpoint/settle/commit`, `duplicate committed step schedules nothing`, `terminal start silent`, `receipt rollback permits retry`. Inject an outbox append failure and assert no run or admission survives. Two independent consumers race the same sequence; assert one generation admitted and one next outbox row (executor integration joins in Task 9).

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(successfulClaimCount).toBe(1);
expect(committedStepCount).toBe(1);
expect(nextOutboxRows).toHaveLength(1);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-integration ai-run-start.spec ai-step-concurrency.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Create initial run/step/outbox in a single tenant transaction after current policy checks and global admission. Keep queue/priority/profile snapshot server-owned/immutable. Claim transaction ends before generation. Commit checks current run state/version/sequence/fence before persisting through F0 receipt path; stale check must roll back any just-inserted receipt rather than consuming work owned by a replacement. Lease renewal every5s; expired takeover marks old active attempt unknown once. Approval continuation consumes fresh sequence while model iteration counts only generation calls. Expose no unguarded start API accepting raw identity IDs.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-integration ai-run-start.spec ai-step-concurrency.spec`; expect all selected tests PASS. Run capacity and cross-tenant storage tests; backend lint/typecheck. No model I/O while a transaction remains open.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): start runs and coordinate fenced durable steps`, then `git push -u origin f3-ai-run-engine`.

### Task 8: Bound and fence the run-wide stream pool

**Files:** Create queue/{run-streams.ts,run-stream-scripts.ts,stream-capacity.ts}; modify queue/index.ts; add backend/test/integration/{ai-streams.spec.ts,ai-stream-memory.spec.ts}; add backend/test/unit/run-stream-parts.spec.ts; extend docs/references/F3-stream-memory.json with actual CI measurement when available (no fabricated result).

**Interfaces:** `RunStreams.publish(claim,event:RunStreamEvent):Promise<'written'|'unavailable'|'stale'>`; `finish(claim,event):Promise<void>` writes final marker+closed guard atomically; `recover(claim,durableSnapshot):Promise<void>` drops buffered chunks and resets only authorized nonterminal runs. `StreamCapacity` enforces 30 slots/6 terminal default and bounded registries; all script KEYS explicit. `encodeStreamParts(event,maxBytes=4096):RunStreamEvent[]` emits schema-valid bounded fragments. No raw tool values in whole-result events; typed operation-ID metadata is Lexon envelope data for F4 to resolve from durable state.

**Research:** Valkey9 exact XADD/MAXLEN, EVAL/explicit KEYS, EXPIRE, MEMORY USAGE SAMPLES0 and design SDK protocol. Re-read parts that carry structured tool arguments before deciding fragments.

- [ ] **Step 1: Write the failing tests.** Test same stream across sequences, no premature run finish, exact XLEN≤1024, every serialized part≤4096 bytes including escaping/emoji, and TTL≤3600 after final. A stale fence and delayed async delta after finish append nothing. Complete 100 fast runs: ≤6 terminal streams/guards and ≤30 total slots, bounded registry MEMORY USAGE. Active streams aren't evicted. Delete guard after TTL, replay old producer: no recreation without current DB authorization. Real memory test 1024×4096B plus guard/index allowance fits6MiB on actual pinned Valkey; repeat with varying/noncompressible JSON, not just repeated x. No consumer groups.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(streamLength).toBeLessThanOrEqual(1024);
expect(totalRunSlotMemoryBytes).toBeLessThanOrEqual(6291456);
expect(eventsAfterTerminalMarker).toHaveLength(0);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit --project backend-integration run-stream-parts.spec ai-streams.spec ai-stream-memory.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Use guarded atomic append/finalization scripts, exact trim and finite deadlines. Validate durable ownership before initialize/reconnect; serialize one publisher per claim. Terminal pool eviction atomically deletes oldest terminal stream+guard and registry membership using explicitly passed keys, checks its terminal generation to avoid racing active ownership, and retries safely if candidate changed. If Valkey unavailable return unavailable without blocking DB execution or buffering unbounded output. Clean registry expired IDs during normal operations and bounded reconciliation; allow no orphan resurrection. Register original memory probe numbers without relabeling them CI/x64 evidence.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit --project backend-integration run-stream-parts.spec ai-streams.spec ai-stream-memory.spec`; expect all selected tests PASS. Actual stream memory probe plus schema/protocol tests must pass; stop on >6MiB slot and report sizing rather than increasing cap. Backend lint/typecheck.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): bound and fence the run-wide stream pool`, then `git push -u origin f3-ai-run-engine`.

### Task 9: Execute model steps and measure the queue hop

**Files:** Create modules/chat/step-executor.ts; wire runtime-providers.ts/runtime-lifecycle.ts/ai-worker root and Chat module; tests backend/test/integration/{ai-execution.spec.ts,ai-hop-latency.spec.ts}; extend ai-harness only for executing actual queue jobs; record measured latency in F3-acceptance.

**Interfaces:** `StepExecutor.execute(job:RunJob):Promise<{kind:"done"}|{kind:"busy";retryAtMs:number}>` consumes coordinator, AttemptService, ModelGateway, RunStreams, registry and policy. One generation per logical model step with at most profile attempts, no hidden SDK loop. ModelEvent metadata awaited into DB immediately; checkpoint updates 1s OR8KiB. A completed step settles its successful attempt/output/state/next outbox atomically. Tool-proposal outcome is persisted for Task10 rather than auto-executed. At this task boundary only tool-free test fixtures are registered; production registry remains empty, so incomplete tool handling is not exposed. `measureHop(services,{samples:20}):Promise<{coldMs,medianMs,p95Ms,maxMs,samplesMs:number[]}>` is test-only instrumentation through real OutboxDispatcher/QueueConsumer.

**Research:** AI stream usage/metadata callbacks, approved protocol, PostgreSQL NOTIFY aftercommit and BullMQ worker lifecycle. Use previous Tasks 3/5/6/7/8 interfaces exactly.

- [ ] **Step 1: Write the failing tests.** Happy path mock streams output/checkpoint/events/known usage/completed; two-step mock tool-free continuation remains same stream/profile queue/priority; output/nextoutbox rollback together; terminal job fetch count0/eventdelta0; attempt2 allowed/attempt3 not; iteration/token exhaustion fails partial. Hop test runs a warmed dispatcher (poll fallback remains1000ms) and actual workers, records commit-ready→claim timestamps without model time,20 warm samples+cold. Assert measurement data finite/nonnegative, report all samples and environment; no arbitrary timeout to manufacture a good result.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(run.status).toBe('completed');
expect(usageRows).toHaveLength(1);
expect(hop.samplesMs).toHaveLength(20);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-integration ai-execution.spec ai-hop-latency.spec ai-step-concurrency.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Orchestrate durable step outside SQL transaction; recheck current actor/capability facts before each generation and immediately before any transactional tool; persist attempt reserve before generate, metadata before streaming further; finish with short receipt commit. Backoff only explicit transient safe codes, default250ms once for2attempt profile; compare limits BEFORE each retry. Store intermediate provisional output separately from committed transcript; only successful step becomes model history. Abort on lost claim. No tool executes from an in-progress stream.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-integration ai-execution.spec ai-hop-latency.spec ai-step-concurrency.spec`; expect all selected tests PASS. **OWNER GATE:** record median/p95/max and cold sample. If any representative local warm hop is above roughly500ms, STOP and report before Task10 or optimizations. Do not average away a representative slow sample. CI load is recorded separately. Backend build/typecheck and no-open-transaction model barrier proof required.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): execute model steps and measure the queue hop`, then `git push -u origin f3-ai-run-engine`.

### Task 10: Commit tool operations and enforce idempotency modes

**Files:** Create backend/drizzle/0019_ai_operations.sql + journal, db/ai-operation.repository.ts, Chat/tool-executor.ts; extend db/schema/index/module and ai-records; tests backend/test/unit/tool-recovery.spec.ts, backend/test/integration/ai-tools.spec.ts; effect fixture only in db/testing/ai-fixture.ts.

**Interfaces:** `AiOperationRepository.persist(tx,claim,proposal):Promise<OperationRecord>` before execution; `ToolExecutor.execute(tx,claim,operationId):Promise<ToolResult>` uses SAME TenantSession for receipt/result/effect. `chooseToolRecovery({mode,receipt?,remoteApplied?:true|false|'unknown'}):'return-stored'|'execute-transaction'|'retry-same-key'|'reconcile-first'|'outcome_unknown'` is pure. OperationRecord includes stable id, committed step/call occurrence, args/hash/toolversion/mode and execution/approval outcome. External adapters remain unsupported in real execution composition.

**Research:** PostgreSQL transaction semantics and statement cancellation; installed SDK tools schema validation; design idempotency modes and canonical argument hashing. Do not use provider-call IDs as new operation identities on retry.

- [ ] **Step 1: Write the failing tests.** Test transactional effect+result+receipt rollback together; SIGKILL after commit before acknowledgement yields1effect; duplicate two identical stored deliveries return same result; two intentional calls with same arguments have different IDs. Unit recovery table covers all modes, undecidable reconcile produces outcome_unknown and0execute. Missing mode rejected at registration; external execution cannot fall through to unprotected execute. Timeout rollbacks and late callback using expired session fail; truncate emoji/JSON result with visible marker, fenced before next model request.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(effectRows).toHaveLength(1);
expect(operation.result).toEqual(replayedResult);
expect(
  chooseToolRecovery({ mode: 'reconcile', remoteApplied: 'unknown' }),
).toBe('outcome_unknown');
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit --project backend-integration tool-recovery.spec ai-tools.spec run-registry.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Persist operations at successful proposal-step commit; execute in next durable advancement (approval may insert a pause) so unknown model attempts never own side effects. Sequence advances on the execution unit; model iteration doesn't. Lock run/version and current authorization facts during actual transactional tool. Handler receives only transaction-bound persistence capability, no gateway/raw driver. Safely cancel timed-out DB work and await rollback before releasing session; do not race an uncooperative promise and then commit. Store outcome_unknown as safe typed tool result/event for future external implementations. Remote contract unit tests do not pretend to call real remote APIs.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit --project backend-integration tool-recovery.spec ai-tools.spec run-registry.spec`; expect all selected tests PASS. Run attempt recovery/step-concurrency tests with new operations; backend lint/build/typecheck.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): commit tool operations and enforce idempotency modes`, then `git push -u origin f3-ai-run-engine`.

### Task 11: Pause for approval and resume under current policy

**Files:** Create Chat/approval.service.ts; extend step-executor/run.service/run-contracts and repository expected-state primitives; tests backend/test/integration/{ai-approval.spec.ts,ai-approval-concurrency.spec.ts}.

**Interfaces:** `ApprovalService.decide(actor:RunActor,input:{runId:string;operationId:string;snapshotHash:string;decision:'approve'|'reject'}):Promise<void>`. Consumes one Task4 capability-policy function. Resume job reads stored decision/operation, reauthorizes and uses fresh sequence/outbox ID. Decision error is safe and no HTTP status contract is introduced in F3.

**Research:** Design initiator-only authority and once-only decision; F1 lock ordering and current member facts; approved job sequence versus model iteration distinction.

- [ ] **Step 1: Write the failing tests.** Test pause frees worker/transaction; exact snapshot hash approval enqueues one resume; reject returned to model; simultaneous decisions yield1accepted; repeat and stale hash refused; another org owner/platformadmin cannot decide and does NOT change legitimate run. Remove initiator membership before decision and separately after decision/before resume: operation rejected,run failed,noeffect/noresume continuation. Tool/capability removed from server registry/profile cannot execute on resume.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(acceptedDecisions).toBe(1);
expect(resumedAfterAccessLoss.status).toBe('failed');
expect(resumedAfterAccessLoss.errorCode).toBe('AI_ACCESS_REVOKED');
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-integration ai-approval.spec ai-approval-concurrency.spec ai-tools.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Decision+outbox atomic with expected pending state. Distinguish a foreign caller refusal from actual initiator access loss. On true access loss atomically reject operation and fail/release active slot; no indefinite awaiting_approval. Resume does not reuse consumed step receipt; recheck hash/tool version/current capabilities/approval before execution. A rejected decision produces durable denial tool result and next model generation if budget permits. Unanswered expiry, UI and approval HTTP remain absent.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-integration ai-approval.spec ai-approval-concurrency.spec ai-tools.spec`; expect all selected tests PASS. Cross-tenant approval tests and worker auth-composition test; no new auth-role outbox function.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): pause for approval and resume under current policy`, then `git push -u origin f3-ai-run-engine`.

### Task 12: Cancel in-flight work and prove crash recovery

**Files:** Create Chat/cancel.service.ts and queue/cancel-signals.ts; extend coordinator/executor, stream reconnect behavior and runtime shutdown; create backend/test/process/{ai-worker-main.ts,ai-worker-harness.ts}; tests backend/test/integration/{ai-cancel.spec.ts,ai-worker-crash.spec.ts}; extend test/process/tsconfig.json only for fixtures.

**Interfaces:** `CancelService.cancel(actor:RunActor,runId:string):Promise<void>` verifies current authority, commits cancelling and signals IDs only. `CancelSignals.subscribe(runId,onCancel):Promise<()=>Promise<void>>` plus DB1s fallback; worker propagates combined AbortSignal for cancel/lease loss/shutdown. Recover active attempt as unknown only after old fence lost; new attempt UUID and retained full reserve. Process harness exposes test-only IPC pause points before final persistence/after commit; no production failpoint env.

**Minor coverage handoff from Task2 re-review:** Add a deterministic test of the exact old guard-read→insert-before-FK window (test-only database gate or identify the intended run-lock blocker explicitly). Existing post-method transaction barriers prove blocking but can also observe FK KEY SHARE locks; do not call them exact-window reproduction. Production run→step lock ordering is reviewed as closing the defect.

**Research:** AI SDK abort/stream cleanup, BullMQ stalled recovery6.5.3, PostgreSQL fencing, Valkey final script ordering; read existing F0 process harness and outage proxy.

- [ ] **Step 1: Write the failing tests.** Actual child SIGKILL after model responded/before commit: old unknown+newattempt, generation ID retained if exposed, one committed output/effect and usage per attempt. Kill after final receipt commit/beforeack: no regeneration/effect. Pause old worker, let lease expire and replacement complete, release old: no writes/events. Cancel queued/paused/running; repeat cancel terminal no-op; while streaming abort reaches model, save partial once, no event after finalmarker; Valkey outage still cancels via DB; stale producer reconnect after cancelled cannot append/recreate. Cancel/tool commit order tested in both directions.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(attempts.map((a) => a.outcome)).toEqual(['unknown', 'succeeded']);
expect(committedOutputs).toHaveLength(1);
expect(toolEffects).toHaveLength(1);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-integration ai-cancel.spec ai-worker-crash.spec worker-crash.spec ai-approval.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Persist cancel first, use best-effort prompt signal and durable fallback; never depend solely on Pub/Sub. For no active owner cancel immediately, for in-flight owner fence/version ensure one terminal partial commit. Queue cancellation and model abort do not substitute for run state authority. On exhausted transport/queue recovery mark run failed and release slot through durable finalization; abandoned running rows cannot silently occupy capacity forever. Shutdown awaits bounded abort/transaction cleanup, not raw error logging.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-integration ai-cancel.spec ai-worker-crash.spec worker-crash.spec ai-approval.spec`; expect all selected tests PASS. Use real replacement processes and per-file private proxies; do not kill shared Testcontainers services. Confirm no leaked workers/sessions/claims.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): cancel in-flight work and prove crash recovery`, then `git push -u origin f3-ai-run-engine`.

### Task 13: Add safe AI telemetry and transactional audit

**Files:** First OpenTelemetry installs in backend; add exact backend dependencies/package lock: @ai-sdk/otel1.0.159, @opentelemetry/api1.9.1, sdk-node0.219.0, exporter-trace-otlp-http0.219.0, dev sdk-trace-base2.8.0; create telemetry/ai-telemetry.ts, modify telemetry/index and ai-worker bootstrap; update audit/audit-event.ts; create backend/drizzle/0020_ai_audit.sql + journal if DB allowlist requires it; tests backend/test/unit/ai-telemetry.spec.ts and backend/test/integration/ai-privacy-audit.spec.ts; add boundary fixtures.

**Interfaces:** `startAiTelemetry({collectorUrl?,serviceName}):Promise<{close():Promise<void>}>`; SDK registerTelemetry/OpenTelemetry stays inside ai adapter, injectable safe tracer port comes from telemetry. Audit event names chat.run_started.v1, chat.run_finished.v1, chat.tool_operation.v1, chat.approval_decided.v1 have strict K3 metadata (run/step/operation/attempt IDs, configured model/provider, status/safe code). Append through existing AuditService.append(TenantSession,...), in same org transaction. No raw exception record or token propagation in tracing context.

**Research:** Official npm matching-version metadata in design addendum; download/read exact package README/changelog before dependency edits. SDK defaults record input/output when registered: explicitly false; OTel Node HTTP exporter only to collector, never vendor endpoint. LEX-ARC6.2/7.1 and existing append-only audit.

- [ ] **Step 1: Write the failing tests.** Capture actual in-memory OTel spans + pino/error/queue output for provider failures, hostile prompts/tool results, config/key parsing, abort and tool timeout. Assert sentinel prompt/output/key absent from serialized data; expected run/step/model/tool spans with IDs/durations/status present; no configured collector constructs0exporters and makes0networkcalls; configured collector selects only that URL; sanitized model/provider audit present exactly once on duplicate delivery. Runtime audit UPDATE/DELETE/TRUNCATE still denied. Boundary fixture rejects infrastructure→domain and SDK imports outside ai, including @ai-sdk/otel direct use from Chat.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(serializedTelemetry).not.toContain(promptSentinel);
expect(serializedTelemetry).not.toContain(secretSentinel);
expect(runAuditRows).toHaveLength(1);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit --project backend-integration ai-telemetry.spec ai-privacy-audit.spec audit-store.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Pin matched telemetry versions with no ai upgrade, initialize before AI Worker application context, disable automatic content-bearing instrumentation and SDK recording in all environments; safe attribute allowlist before export. Construct/register an exporter ONLY when a collector URL is configured; dev/CI have no exporter by default. Record every first-installed exact OTel version in acceptance notes. In-memory span processors in tests do not enable a network exporter. Do not export raw provider metadata (may contain sensitive content). Keep ai:smoke stateless/no audit DB composition; numeric operator output only. Expand app audit schema/privilege checks narrowly; lexon_auth does NOT gain ops table privileges or AI outbox capabilities.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit --project backend-integration ai-telemetry.spec ai-privacy-audit.spec audit-store.spec`; expect all selected tests PASS. pnpm install --frozen-lockfile after lock generation, full boundary suite, backend lint/build/typecheck; inspect actual emitted spans, not config booleans alone.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): add safe ai telemetry and transactional audit`, then `git push -u origin f3-ai-run-engine`.

### Task 14: Expose the engine to deterministic mock evaluations

**Files:** Extend evaluation/{index.ts,evaluation.module.ts}; create evaluation/{evaluation-contracts.ts,evaluation-harness.ts}, evals/global-setup.ts, evals/test/f3-engine.spec.ts; modify evals/vitest.config.ts and existing global-infrastructure to acquire a shared once-per-run coordinator; create infrastructure/db/testing/test-infrastructure.ts for extracted lifecycle, no duplication; tests scripts/test/evaluation-boundary.spec.mjs and backend/test/unit/evaluation-composition.spec.ts.

**Interfaces:** Public `createEvaluationContext(options?:EvaluationOptions):Promise<EvaluationContext>` preserves old no-option version/close result, new engine variant exposes `start/cancel/decide/read/drain/close` using neutral types, no repository/client handles. `prepareEvaluationInfrastructure():Promise<{descriptor:EvaluationServices;release():Promise<void>}>` is exposed through SAME package entry for eval global setup; descriptor contains generated test URLs only, never printed. Shared coordinator memoizes one Postgres/Valkey/SeaweedFS acquisition per Vitest run and refcounts teardown across selected projects; per-file DBclone/keyprefix/bucket unchanged. Tests/evals register echo/read/write/hostile fixtures only here.

**Research:** Nest standalone context docs, Vitest5 globalSetup provide/inject, current backend global setup/per-file fixtures, AI SDKv4 mocks; boundary rules allow only one public evaluation package entry.

- [ ] **Step 1: Write the failing tests.** Mock eval assertions cover complete/cancel/budget/approval/crash accounting, hostile context and tool result cannot cause an unapproved/unpermitted write, one effect after replay, unknown attempt retained. Mock scripted gateway is implemented with SDK MockLanguageModelV4 internally, no eval imports ai or backend internals. Test the coordinator starts exactly3 containers once with backend+eval selected and tears down after both; package-only eval command also provisions/cleans independently. Old version-context smoke stays green. Default registries have zero product fixtures.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(mockScores.every((score) => score.passed)).toBe(true);
expect(containerStartCount).toBe(3);
expect(realProviderFetchCount).toBe(0);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project evals --project backend-unit f3-engine.spec evaluation-composition.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Extend single evaluation export with explicit test configuration. Move common test-infrastructure lifecycle behind the shared coordinator rather than spawning a stack per eval/test. Production entry remains lazy for testcontainer imports; calling normal evaluation bootstrap without fixtures never loads Testcontainers or model keys. Thin eval/global-setup uses ONLY public evaluation export. No in-memory replacement for persistence in engine integration evals.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project evals --project backend-unit f3-engine.spec evaluation-composition.spec`; expect all selected tests PASS. Also run pnpm --filter @lexon/evals test and full pnpm test to prove single-command startup and shared provisioning; node --test scripts/test/evaluation-boundary.spec.mjs; evals lint/build/typecheck.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): expose the engine to deterministic mock evaluations`, then `git push -u origin f3-ai-run-engine`.

### Task 15: Add guarded real smoke and estimator calibration

**Files:** Create entrypoints/ai-smoke/main.ts and ai/smoke.ts, backend/test/unit/ai-smoke.spec.ts; modify backend/package.json (ai:smoke) and docs/references/F3-acceptance.md; add backend/config/model-allowlist.dev.json only if per-environment path split is needed, keeping one reviewed source per environment.

**Interfaces:** `runAiSmoke({env,write,fetch?}):Promise<number>` uses real gateway, fixed prompt `Reply with the single word READY.`,1request,maxOutputTokens128,timeout30000ms. It prints only model/provider/declared route and observed region evidence, token/cost numbers, estimatedInput/reportedInput/ratio; output text is never printed or stored. Script `pnpm --filter @lexon/backend ai:smoke` builds/runs the stateless entry, no database/storage configuration required.

**Research:** OpenRouter provider3.1 response metadata/usage accounting and exact routing; accepted budget calibration and prerequisite; Node AbortSignal timeout.

- [ ] **Step 1: Write the failing tests.** Unit tests absent/invalid attestation/key fail before fetch and output explains ZDR-only/no Safety Retention/logging off/keycreditcap; never echoes env values. Real-shaped mocked response yields expected estimate/reported ratio; zero/missing input usage prints unavailable; no DB object constructed; one request even503; raw content/key never in writes/errors. Then execute actual local smoke ONLY if owner-configured prerequisites are available; do not fabricate attestation or change account. Missing prerequisite remains an explicit operator dependency, not a skip marked pass.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(smokeFetchCount).toBe(1);
expect(calibration.ratio).toBe(
  calibration.estimatedInput / calibration.reportedInput,
);
expect(output).not.toContain(modelOutputSentinel);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project backend-unit ai-smoke.spec real-model-prerequisites.spec`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Reuse guarded adapter/estimator, no duplicated provider path. Numeric calibration is the small real eval case comparing estimator to actual input usage. Record operator's actual verified date, timestamp/model/provider/route evidence, estimated/reported input and ratio, tokens/cost, no admin endpoints called; if response exposes only provider Azure, disclose that regional route came from restricted azure/us/catalog evidence, not physical-location observation. Store NO provider output or key. If actual response usage exceeds reservation, report calibration and safe failure honestly.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project backend-unit ai-smoke.spec real-model-prerequisites.spec`; expect all selected tests PASS. Backend build/typecheck and actual smoke evidence gate. Do not run network-dependent tests in pnpm test or PR CI; no screenshot needed for headless output.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): add guarded real smoke and estimator calibration`, then `git push -u origin f3-ai-run-engine`.

### Task 16: Run mock PR evals and bound manual real evaluations

**Files:** Create evals/src/real-evals.ts and evals/test/real-eval-budget.spec.ts, .github/workflows/real-evals.yml, scripts/test/real-eval-workflow.spec.mjs; modify evals/package.json and .github/workflows/ci.yml push branches→[main], preserving visual workflow and other gates.

**Interfaces:** `runRealEvaluations({budgetUsd:'0.10',maxRequests:16,maxOutputTokens:512,maxEstimatedInputTokens:16384,priceCeiling:{inputPerMillion:'0.25',outputPerMillion:'1.00'},timeoutMs:300000}):Promise<ScoreReport>` boots same public evaluation engine with real gateway. Each request first reserves conservative dollars; unknown keeps reserve, known cost reconciles, overrun stops further calls. `ScoreReport` contains case IDs/scores, total known cost and unknown count only, no model/tool content. Command `pnpm --filter @lexon/evals eval:real`; workflow_dispatch only, read-only permissions, single concurrency group, secrets/attestation only on trusted main ref.

**Research:** GitHub workflow dispatch/default-branch and secret-context docs; OpenRouter explicit max_price routing and usagecost; design spend-limit note. Official routing Max Price documentation confirms prompt/completion values are USD per million tokens (reverified2026-11-05); send max_price={prompt:0.25,completion:1.00}, not per-token fractions. Test this exact outgoing shape.

- [ ] **Step 1: Write the failing tests.** Test9-cent consumed plus2-cent reservation refuses0fetch; unknown call retains dollar reserve;17th request refused; sequential3fixture suite under globalphysical ceiling; reported overrun stops. Workflow static tests: no pull_request_target/pull_request/schedule; protected ref main, bounded timeout, pinned existing actions, no secret on fork path, attestation from vars and key from secrets; stdout scores only; CI push onlymain and PR mockeval remains inside pnpm test. Never add a scheduled paid trigger without owner change.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(requestCount).toBeLessThanOrEqual(16);
expect(rejectedTwoCentCallFetchCount).toBe(0);
expect(workflowEvents).toEqual(['workflow_dispatch']);
```

- [ ] **Step 2: Observe RED.** Run `pnpm exec vitest run --project evals real-eval-budget.spec && node --test scripts/test/real-eval-workflow.spec.mjs`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Implement proposed manual-only USD0.10 budget and 16-request ceilings through same model/attemptpath, exact privacy prefs, price ceilings and hard outputcaps; no OpenRouter admin endpoints for credits or generation reconciliation. Require owner attestation covering ≤USD0.10 dedicated allocation/no other consumers for this invocation. Workflow refuses missing vars/secret via safe code. Since brand-new workflow cannot dispatch before merge to defaultbranch, verify command locally with approved prerequisites and workflow structure before PR; record hosted-dispatch activation as postmerge operator verification, never merge early to manufacture evidence.

- [ ] **Step 4: Verify GREEN.** Run `pnpm exec vitest run --project evals real-eval-budget.spec && node --test scripts/test/real-eval-workflow.spec.mjs`; expect all selected tests PASS. Run mock eval package gate, full node tooling tests and YAML validation. Manual local paid eval only with prerequisites; record score/cost counts without content. If trusted hosted workflow already exists use normal branch mechanism only after checking, never alter main.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): run mock pr evals and bound manual real evaluations`, then `git push -u origin f3-ai-run-engine`.

### Task 17: Verify the complete branch and publish review evidence

**Files:** Update F3-acceptance.md, approved design research notes with actual verified API details, plan checkboxes, and public package/runtime documentation; no new product scope. PR body includes final behavior, validation, paid-run evidence and F17/P8/external-mode limitations.

**Interfaces:** Consumes all tasks; produces reviewable feature branch and PR f3-ai-run-engine→main. Preserve whole-branch review report and unresolved operator/postmerge evidence explicitly. No merge to main.

**Research:** Re-read brief/design/source-of-truth referenced sections and check task coverage; verification-before-completion and finishing-branch skills apply at execution, not during plan writing.

- [ ] **Step 1: Write the failing tests.** Add any genuinely missing adverse-path test discovered by review before modifying production logic. Coverage checklist maps every brief criterion and owner correction to an actual test/evidence record; verify no unexecuted command or quota/precondition skip is labeled green. Confirm fixed maxoutput, budgetunknown reservations, runactivecapacity, retainedstreamcapacity,24/30 defaults, routed provider, smoke calibration and500ms gate all have evidence.

Representative assertions in those named tests (locals come from their specified test setup):

```ts
expect(unmappedAcceptanceCriteria).toEqual([]);
expect(unresolvedCriticalOrImportantFindings).toEqual([]);
expect(changedF21GoldenPaths).toEqual([]);
```

- [ ] **Step 2: Observe RED.** Run `pnpm test && pnpm lint && pnpm format:check && pnpm build && pnpm typecheck`. Expect the named assertions to fail because the new behavior is missing; configuration/import failure alone is acceptable only for the initial new exported symbol.

- [ ] **Step 3: Implement the deliverable.** Run all package checks, node --test scripts/test/*.spec.mjs, existing identity mutation command, and pnpm test:e2e on clean feature head. Review all new tables/grants/RLS, worker runtime composition, source redaction and outgoing request tests. Request a fresh whole-branch reviewer; main resolves Critical/Important findings with RED/GREEN and scoped rerun. Preserve accepted F2.1 baseline bytes. Record actual Linux CI plus local hop/memory environment and no-admin observation; keep unknown cost reconciliation/F5 external adapters/P8 production region as explicit gaps.

- [ ] **Step 4: Verify GREEN.** Run `pnpm test && pnpm lint && pnpm format:check && pnpm build && pnpm typecheck`; expect all selected tests PASS. Commit/push final evidence, open PR to main, inspect actual head CI and require relevant gates green. Paid hosted workflow may await default-branch activation as explicitly documented; actual smoke/calibration cannot be fabricated. Stop if hop gate or owner prerequisite blocks required acceptance; do not call the slice complete with hidden missing evidence.

- [ ] **Step 5: Review, record, commit and push.** Main session reviews spec compliance, then code quality; resolve findings and record commands/results in `docs/references/F3-acceptance.md`. Stage only this task's files and evidence, commit `feat(f3): verify the complete branch and publish review evidence`, then `git push -u origin f3-ai-run-engine`.

## Self-review and approval checklist

- [x] Spec coverage: lifecycle/storage/admission (1–3,7,9,12); outbox/queues/receipts (6–7,9); model/privacy (5,13,15–16); contracts/context/capabilities (1,4,10–11); streams/capacity (8); attempts/accounting (3,9,12); eval/public-entry (14–16); headless runtime and CI (9,13–17). Every brief acceptance item and later owner correction mapped; no UI/remote tool/expiry/customer-quota creep.
- [x] Signature/step scan: one definition for all named cross-task types and methods; no AI SDK imports outside ai; short transaction callbacks never encompass model or Valkey I/O; tests use real repos plus scripted SDK model, not fake persistence.
- [x] Failure focus: each of five Review Focus lines has explicit named test coverage in its assigned tasks.
- [x] Research: design notes plus addendum cite official exact-version APIs read before decomposition; memory probe is actual pinned Linux/aarch64 evidence and not called Linux/x64 CI evidence. New OTel package contents/peer compatibility rechecked at installation.
- [x] Proportion: grouped setup with the feature that needs it; one independently reviewable deliverable per task, exact test commands and RED/GREEN gates; no full implementation bodies embedded.

Owner approved azure/us, manual-only USD0.10/16-call real-eval envelope, revised MAXLEN1024 / active24 / terminal6 stream capacity, and early terminal eviction. Added per-org active admission cap6 in Task2 and first-install/exporter-opt-in instructions in Task13. Execute in preserved SDD Luna/high mode. This turn is authorized to start Task1.
