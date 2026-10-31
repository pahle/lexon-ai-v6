# F0 S6 findings

Status: implementation and local validation complete through Task 17. Final CI acceptance is recorded below after the PR checks run.

## Task 1 toolchain

- Source generators: Nest CLI 12.0.11 ESM and assistant-ui CLI 0.0.127 default.
- Nest emitted Vitest/Vite configuration with no explicit metadata plugin; characterize this before selecting a transform.
- Exact dependency versions and peer evidence are recorded in F0-versions.md.
- The chronological task sections below record the subsequently completed runtime/database/queue/AI/MCP/storage/topology proofs.

### Verified result

- `pnpm exec vitest run --project backend-unit backend/test/unit/toolchain.spec.ts`: 1 test passes using native Vite 8 transformation, with no SWC plugin.
- The expected missing-metadata failure in the plan does not occur: the current scaffold/toolchain already implements this capability. Keep this characterization proof instead of disabling working behavior to fabricate a RED result.
- Product entrypoints and feature behavior are still absent; only a test-owned DI fixture exists.

Task 1 final checks: root test 1/1; backend typecheck; TS6 fixture compilation and Node ESM import; ESLint; single TS 6.0.3 and Zod 4.6.7 resolutions; frozen install with unchanged lockfile. Full application build and other-package suites are deliberately pending their owning tasks, not reported as passing empty suites.

## Task 2 contracts

18 contract cases pass (19 total with metadata proof). Shared build/typecheck, filtered package test, and Vite browser-target bundle/import succeed. The failing first run found the missing contract export; implemented only browser-safe schemas/types/interfaces.

## Task 3 boundaries

47 executable ESLint fixture cases pass, including alias/relative path normalization, type imports, re-exports, dynamic-import bypass rejection, privileged-driver ownership, and exactly one public eval entry. Root and filtered frontend lint execute the fixtures. Root application tests remain 19/19. Fixtures run in a temporary tree with real ESLint10/TypeScript parser; no blanket test-file exemption.

## Task 4 configuration and logging

Runtime-specific config and actual Pino/HTTP logging tests pass (36 tests total). Invalid URL exceptions were caught by the failing privacy test and are now reduced to configuration field names. A failing child-logger test demonstrated Pino child bindings bypass log formatters; a final streamWrite allowlist now removes arbitrary bindings while preserving request IDs. Captured real log JSON excludes all tested credential/content sentinels. Backend build/typecheck and root lint pass.

## Task 5 real test infrastructure

One Vitest integration global setup starts the pinned dependency stack, migrates as a non-superuser lexon_migrator, and clones a closed template per test file. Parallel A/B files prove the same logical row/key/object name remains isolated across databases, prefixes and buckets. Role ownership and grants, pg_trgm and idempotent migrations pass. Runtime role credentials are configured out of band. Default containers are torn down; local opt-in reuse still uses fresh templates/namespaces and is rejected in CI. Cleanup orchestration has failure-path unit proofs.

Observed compatibility details: SeaweedFS S3 config uses accessKey/secretKey (not AWS SDK accessKeyId/secretAccessKey). Its per-bucket collection growth required more than two volume slots; the integration image now allows 64 small volumes instead of failing concurrent bucket writes. Vitest5 requires separate sequence groupOrder when maxWorkers differs between integration and unit projects.

## Task 6 tenant boundary

Real PostgreSQL tests pass for fresh and size-one reused connections after both commit and rollback. The fixture is populated with a third tenant before no-context probes, avoiding an empty-table false proof. A/B read/update/delete/insert isolation, role restrictions, session expiration, missing-user reset and statement timeout recovery pass. Opaque sessions hold no public client/pool; runtime import-boundary fixtures reject private db/session and test-helper access. Public class declarations expose only options, callbacks, status and lifecycle. Root tests: 48/48; lint fixtures: 51/51; backend build/typecheck pass.

## Task 8: native BullMQ integration

Verified 2026-10-31: @nestjs/bullmq 12.0.0, BullMQ 6.5.3, NestJS 12.3.2,
ioredis 6.0.0, Valkey 9.0.7. Native Processor / WorkerHost works in the ESM
application context, including actual retries and child-process stalled-job
recovery. No peer override or fallback wrapper is needed.

Three attempts with observed exponential delays passed. Retained IDs suppress
reinsertion; explicitly removing the completed queue job permits another
delivery which returns duplicate, with one PostgreSQL effect. Failed-job
reasons/stack traces exclude the handler's error content. Policy checks and
MAXLEN/TTL Streams round trip pass against the real service. A private TCP
proxy outage rejects within the producer budget and recovers without changing
shared service configuration.

Two SIGKILL tests use compiled workers: after effect insertion before commit,
the connection loss rolls back both receipt and effect; after committed execute
before processor resolution, the receipt survives. In both cases a confirmed
replacement-process delivery completes with exactly one effect. The second
case returns duplicate. These checkpoints exist only in test fixtures.

## Task 10: S3 portability

AWS SDK client/presigner 3.1161.0 with SeaweedFS 4.51 passes real binary
put/get/delete, exact inclusive range 1..3, HTTP presigned PUT, and signature
tampering rejection. HeadBucket probes bucket access without writes and the
private outage probe is bounded. SDK errors are sanitized at the boundary.
The initial presigned upload returned BadDigest: automatic CRC32 described
the absent body at signing time. Only the presigning client now selects AWS's
documented WHEN_REQUIRED request checksum mode; regular SDK uploads retain
default checksum behavior. Public/internal signing endpoints are separate.

## Task 11: non-HTTP worker health

Terminus 12.1.0 native indicators bound hanging probes and expose only mapped
up/down values. Snapshot/checker/writer tests cover required states, dependency
readiness independent from liveness, standby, unexpected fields, clock edges,
atomic replacement, EACCES invalidation/recovery, failed invalidation expiry,
stalled heartbeat and a late shutdown write regression. The compiled checker
returns 0 for healthy and 1 for missing/stale/unhealthy files, with empty
stdout/stderr in all four cases. Root composition and tmpfs mounts follow in
Tasks 12 and 15; this is not yet a running Compose topology proof.

## Task 12: runtime roots, native HTTP validation and evaluation

NestJS 12.3.2 independent roots pass real HTTP readiness/liveness, native
Body-schema StandardSchemaValidationPipe and shared error contracts. Invalid
UUIDs, unknown keys and malformed JSON produce sanitized errors. Request IDs
are assigned before body parsing and propagated in response/log output; the
filter resolves the transient PinoLogger through Nest's scoped resolver.
A real wildcard-address bind collision verifies startup cleanup and nonzero
exit with sanitized boot logs. The collision fixture uses the same address
as the API; a loopback-only listener did not reliably collide on macOS.

API/dispatcher have no registered processor, standalone roots have no HTTP
server, and a Node24 load hook observes the document worker's actual loaded
module URLs: no AI-worker root or infrastructure/ai path, no TCP listen call.
AI worker boots without storage/model secrets. Dispatcher standby writes a
ready standby snapshot; a private database proxy outage makes it unready.
Closing roots removes snapshots, processors and dedicated lock sessions.
Queue-handler and dispatcher progress are owned by their work loops. Timed-out
health checks share still-pending underlying probes rather than accumulating
new driver operations. Snapshot-write failures emit a fixed operational event.

The backend exports exactly ./evaluation. Evals imports the built package
export, starts EvaluationModule through actual Nest application-context DI,
resolves the package version provider, and closes it. No static version stub
or source-path alias is used. Vitest global preparation builds shared/backend
exports, including for directly filtered integration/eval commands.

Pino's out-of-context binding is process-scoped; the production roots run in
separate processes as designed. In-process composition checks focus on module
registration and lifecycle; child-process import/boot tests exercise the real
process boundary. Compose networking remains pending Tasks 15–16.

## Task 13: AI SDK/OpenRouter/MCP ESM proof

AI SDK 7.0.159 / OpenRouter 3.1.0 constructs a language-model-v4 provider
without a request. The SDK's MockLanguageModelV4 streams Hello world and
finishes with stop; injected provider fetch count is zero. MCP client/server
2.4.0 uses StreamableHTTPClientTransport with fetch delegated to the actual
createMcpHandler in-process. It negotiates 2026-07-28, lists/calls the probe
tool, returns structured accepted:true and closes both sides. Global external
fetch is rejected; no transport fallback was needed.

Allowlist tests enforce region, literal ZDR, provider, ISO review timestamp
and unique model-provider pairs. The checked-in F0 file remains empty. The AI
module exports no raw provider; an additional negative lint fixture rejects
private provider-wrapper imports outside the AI folder. The only AI module
registration is the AI-worker root; document-worker tracing is re-run after
registration. Production model selection and inference remain F3 work.

## Task 14: frontend contracts and retained chat toolchain

Next16.4.3 / React19.3.1 / TypeScript6.0.3 builds with an unreachable backend
URL. connection() keeps the page dynamic; the server HTTP request has a
one-second deadline, while browser queries stay on /api. Nine tests cover
loading/version/unavailable states, schema-validated client responses, exact
UUID request body, local invalid input with no fetch, and safe backend errors.
Base UI1.9.0, Query5.105.0 and RHF7.91.0/Zod resolver6.0.2 are exercised.

The existing assistant-ui0.15.32 supported local runtime renders under the
actual provider with a state-reading child; adapter and network calls remain
zero. Adapter/AI SDK React exports compile. This package characterization
passed on its first run; the missing frontend clients/components supplied the
implementation RED tests. No fake runtime cast or disconnected chat was added.
Style base-nova and the style-aware assistant-ui registry remain validated by
shadcn info. Scaffold TS7/oxlint/oxfmt settings were replaced with TS6 and
ESLint/Prettier. The actual route inventory contains only / and _not-found,
plus the no-op proxy. No Route Handler/server model implementation exists.
Turbopack rejected emitted .js paths to TypeScript source, so this Bundler-mode
package uses standard extensionless local imports; Node packages retain .js.

## Task 15: real Compose foundation

The pinned Node24.22.1 build creates four backend targets from one compiled
codebase and a production-only deployed dependency closure. Next standalone
build is separate and receives no infrastructure credentials. All runtime
images run non-root. Backend filesystems are read-only with writable health
and temporary tmpfs mounts. Docker/Compose render checks prove the same image
manifest, service limits, networks, and secret scope as the integration bed.
Compose5.1.1 runs the v2-compatible service specification.

A fresh unique E2E stack completed bootstrap, migrations and bucket setup,
then all four runtimes/data services became healthy. Playwright runtime-health
passed API shared health/version, worker readiness+liveness exec checks, and
host access to frontend/API. The documented development launcher also booted
a fresh lexon-dev stack using temporary local .env credentials and separate
host ports, returned version0.0.1, and was removed with only its own resources.
No data-plane host ports are published. Frontend's development edge remains
non-internal; the F20 no-egress gap is explicitly retained.

## Task 16: browser/API and actual topology

Playwright1.64.1 exercises SSR and browser health/version agreement, same-origin
requests, local invalid UUID with no POST, exact valid POST, shared API response
schemas and absence of chat routes. The built image boots its public evaluation
export from the backend package directory. Frontend environment/static assets
are checked against the run's actual infrastructure credential sentinels.

Actual Docker membership is inspected. An API direct-IP TCP connection reaches
the controlled fixed-response endpoint on egress; the same connection from the
document worker fails, while its Postgres/Valkey/S3 core connections and
readiness pass. No DNS/public-internet oracle is used. Frontend is edge-only;
its outbound-connectivity gap is intentionally deferred to F20.

Native CONFIG GET proves noeviction/AOF/everysec. A separate nested Compose
project rejects each wrong setting with API exit1, then correct settings boot
healthy. Successful one-shot jobs use compose wait, rather than up --wait's
running-state requirement. Test fixtures use same-package working directories
for Node self exports and distinguish the form's alert from Next's announcer.
Cleanup unit tests verify failed startup, abort and failed teardown always
remove only owned resources/private files; signals propagate to child commands.

## Task 17: bounded mutation baseline

Command: `pnpm --filter @lexon/backend test:mutation`.
Stryker core/vitest-runner10.1.1, Vitest5.0.5, TypeScript6.0.3, Node24.22.1.
The runner plugin is explicitly listed because pnpm's strict package layout
prevented automatic discovery. Two worker processes use the same native Vite
TS/decorator transform as normal tests. The focused configuration selects five
real assertion tests; no containers start per mutant and no empty-suite bypass
exists. No TypeScript checker is needed for this runtime baseline; typecheck
remains an independent required gate.

Final measured baseline (4 seconds): **96.77%**, 31 mutants, 30 killed,
1 survived, 0 no-coverage, 0 timeouts, 0 runtime/compile errors.

| Mutated file                                 | Killed | Survived |  Score |
| -------------------------------------------- | -----: | -------: | -----: |
| infrastructure/db/authorization-predicate.ts |     15 |        1 | 93.75% |
| modules/platform/job-envelope.ts             |     15 |        0 |   100% |

The first run scored77.42%; surviving optional-user mutants exposed missing
assertions in this focused scope. Added strict equality, own-key absence,
validated user preservation and sanitized two-field error assertions. The
remaining mutant changes `issue.path.join('.')` to `join('')`; the current
flat context schema only produces one-segment paths, so it is equivalent for
all possible current paths. It remains visible and unsuppressed.

Artifacts: `backend/reports/mutation/mutation.html` and `mutation.json`
(regenerated locally, ignored). F0 sets no score threshold. Scope deliberately
covers only these two meaningful policy/validation files. Transaction/receipt/
dispatcher/queue/RLS behavior is covered by the real integration/crash suites,
not claimed as mutation coverage. `job-executor.ts` is excluded because its
transactional proof would otherwise restart infrastructure per mutant. This
limitation is the approved Task17 amendment.

## Final acceptance evidence

Read the updated brief and approved decisions again on 2026-10-31. The table
maps each numbered requirement to executable evidence; chronological sections
above retain compatibility decisions and concrete failure/fix findings.

| Brief item | Evidence                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| 1          | Four workspace manifests; pnpm recursive and filtered gates                                  |
| 2          | Exact manifests/lockfile; workspace overrides; one TS6.0.3/Zod4.6.7 resolution               |
| 3          | Root/filtered build/lint/typecheck/test/E2E; real dev launcher; owned format scripts         |
| 4          | 53 real ESLint boundary fixtures, invoked by lint; negative alias/path/export controls       |
| 5          | Browser-safe shared package tests and browser bundle proof (Task2)                           |
| 6          | 18 shared contract tests; HTTP/browser health and diagnostic contracts                       |
| 7          | Only platform domain; five infrastructure folders with rule pages                            |
| 8          | Runtime-composition and compiled child import/listen trace; actual four-target Compose       |
| 9          | Runtime-config tests plus compiled boot-failure field-name/privacy regression                |
| 10         | Real serialized Pino HTTP/child-binding privacy tests and request-ID tests                   |
| 11         | Native Terminus timeouts, file checker/writer failures; API and Compose probes               |
| 12         | Native Body/schema StandardSchemaValidationPipe HTTP cases and shared form schema            |
| 13         | AI7/OpenRouter3 v4 construction and Hello world mock, zero fetch; empty reviewed schema      |
| 14         | MCP2.4 real in-process handler, protocol2026-07-28, list/call/close, zero external fetch     |
| 15         | Fresh migrated template, role/schema/pg_trgm/ownership/privilege assertions                  |
| 16         | Db-private bounded pools and statement-timeout rollback/reuse proof                          |
| 17         | Explicit org/user transaction context, expired session and absent-context assertions         |
| 18         | Exact NULLIF USING/WITH CHECK + FORCE fixture pattern and db README                          |
| 19         | Authorization predicate assertions and bounded Stryker baseline                              |
| 20         | Populated fresh/reused/rollback fail-closed, A/B read/write/delete and auth-role tests       |
| 21         | Real receipt/effect concurrency/rollback/crash tests; leader/fencing/lease/outage/poll tests |
| 22         | Native @nestjs/bullmq12/BullMQ6 retries, retention, queue-removal and SIGKILL redelivery     |
| 23         | Real CONFIG GET plus isolated wrong eviction/AOF/fsync startup rejection/recovery            |
| 24         | Next16/React19 build, BaseUI/RHF/Query rendering, retained base-nova registry                |
| 25         | No model/Route Handler/chat UI; built route inventory and /api/chat404; no secret assets     |
| 26         | Browser same-origin requests and SSR/backend version agreement through actual Compose        |
| 27         | Empty route groups and compiled no-op proxy                                                  |
| 28         | Two successful images; four backend Dockerfile targets; pinned manifest; resource checks     |
| 29         | Actual network inspection and direct-IP egress positive/negative/core controls               |
| 30         | SeaweedFS binary/range/delete/presign/signature/HEAD/outage contract                         |
| 31         | Vitest metadata/HTTP/integration, Playwright browser/API, Stryker96.77%, actual eval DI      |
| 32         | .github/workflows/ci.yml: exact tools, frozen install, package gates, both test layers       |
| 33         | Root developer flow, migration/rollback/retention guidance and five infrastructure READMEs   |

Final local root run: frozen install, lint, typecheck, build, format check,
**123/123 Vitest tests (31 files)** and **58/58 Node tooling assertions** pass.
The previously measured Stryker baseline remains 30/31 killed, one equivalent
survivor, no uncovered/errors/timeouts. No mutated file changed afterward.
Package gates and Compose verification are reported with their final run below;
GitHub CI is a distinct acceptance result and is not inferred from local success.

Known limitations: no F1 authentication/Better Auth proof; no production model
selection, populated allowlist, AI engine, chat or document processing; no
external-effect idempotency guarantee; no receipt deletion; bounded health-file
failure latency; two-file mutation scope; frontend outbound connectivity remains
the explicit F20 gap. No locked technology revision or compatibility fallback
was needed. Native Vite metadata replaced the unnecessary planned transformer.

Final package runs: contracts18, backend95, frontend9, evals1 tests pass;
each package lint/build/typecheck also passes. Final Compose run passes9/9,
including browser and separate nested-policy recovery. Filtered E2E commands
passed backend7, frontend1, contracts2 and evals1. Final root build/format and
frozen lockfile gates pass. Tooling tests total58, including53 lint-boundary
fixtures and5 rendered-topology/setup/cleanup cases. CI evidence follows the
review PR; local results are not presented as a GitHub result.
