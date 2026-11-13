# F4 Task 13 scaled private search gate

Date: 2026-11-12

## Acceptance

The owner-approved Task 13 amendment requires owner-scoped B-tree plans under
real app-role RLS, no whole-table sequential scans of chats, messages, or run
outputs, a heavy owner with 2,000 chats and 50,000 messages, and at least one
million other-user messages. It requires 30 warm requests for each of four
query classes (stem, partial, article 1320, and no-match), reporting p50, p95,
and maximum; p95 must be below 300 ms. A miss stops work for owner direction.
The approved amendment prohibits RLS bypasses, forced planner settings,
LEAKPROOF changes, and SECURITY DEFINER search wrappers.

The Task 13 migration adds no search GIN indexes. Earlier production-shaped
candidate plans did not use them, so the unused GIN DDL was removed as directed
by the amendment. F8 retrieval and spike S3 must separately solve indexed FTS and trigram search
under RLS at document scale; this F4 per-owner scan is not that evidence.

## Before the owner-first query change

The earlier diagnostic used 100,000 synthetic user-message rows rather than
this amendment's representative fixture. Catalog inspection reported
`proleakproof=false` for `to_tsvector`, `plainto_tsquery`, `ts_rank_cd`,
`ts_match_vq`, `ts_match_tq`, `ts_match_tt`, and `word_similarity_op` (`<%`).
The indexed FTS expression matched the query's
`to_tsvector('english', coalesce(user_text,''))`; the corrected trigram candidate
used query-left `<%` target-right. Neither measured candidate used GIN.

With the owner/live-chat join, both candidates selected `chats_owner_activity`
and `chat_messages_org_id_chat_id_id_key`, applying the search predicate as a
filter. Captured EXPLAIN ANALYZE execution times were **283.720 ms lexical** and
**334.964 ms trigram**. An isolated FTS candidate without that chat join selected
a message sequential scan (847.479 ms in an earlier capture). These are
candidate-query observations, not full API latency or amended-gate acceptance.
The later production query starts with a materialized owner/live-chat CTE; its
representative plan assertions and failed warmups are recorded below.

## Fixture and source fingerprint

The final bounded benchmark fixture uses the same valid 13-user/12-assistant
linked chat tree for the heavy owner and unrelated tenants. The heavy owner
has 2,000 chats, 50,000 messages, and 24,000 canonical synthetic answer runs.
Six unrelated tenants/users each have 6,667 chats and at most 25 messages per
chat: **40,002 chats and 1,000,002 messages** total. Their messages alternate
user and assistant roles, with valid parent links and synthetic answer runs.
No generated text contains legal analysis. Owner answer-output lengths are
distributed as p50 512 bytes, p90/p95 4,096 bytes, p99/max 12,288 bytes.

The benchmark runs under the fixture's cloned PostgreSQL 17 database. The
recorded server version from this testcontainer family is
`17.11 (Debian 17.11-1.pgdg12+2)`. The API and tenant database use the configured
10,000 ms statement timeout; the plan helper reads `statement_timeout` from the
same app-role session. `enable_seqscan` remains `on`. No planner override was
used.

Host and VM details captured before the gate: Apple M4, macOS 27.0, arm64,
10 CPUs, 16 GiB host memory; Docker Desktop Linux/aarch64 VM with 10 CPUs and
8,217,059,328 bytes of memory. PostgreSQL container CPU and memory limits were
unlimited within the VM.

Source revision at the start of the final corrected run: `b754f07c062d8c4e6b74500c134fdd92475c65ce`.
Selected source SHA-256 values:

| File                                                             | SHA-256                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `backend/drizzle/0035_chat_search.sql`                           | `75bd1bd7f5a72c86cc13e3576a650d97dc7c0fea8f8c7e92117bd0c66f56f9ac` |
| `backend/src/infrastructure/db/chat-search.repository.ts`        | `aa6a4379f6745eeff2c68e5694d97e50ebb1b62897254999d334857f0bc2bb5d` |
| `backend/src/infrastructure/db/testing/chat-search-benchmark.ts` | `95d99a5bcd66c4db19db18c8850ea1cd826179b4e2f1407954349fe2e7183fb5` |
| `backend/src/infrastructure/db/testing/chat-fixture.ts`          | `e64bb29b2708b84e8f298a78395310aa37508cea7b0ec187ff575f47a13fbc94` |
| `backend/test/integration/chat-search-performance.spec.ts`       | `e931235e6b4eff28fa9f4cd70e4a3cb459f46072f3834e0a13b77212bd8a1ee7` |

## Plan and warmup outcome

Command:

```sh
pnpm exec vitest run --project backend-integration chat-search-performance.spec
```

The corrected fixture completed seeding and all four plan checks before API
warmups began. The test assertions establish that every plan ran as
`lexon_app` with tenant org/user settings and `enable_seqscan=on`; the owner
CTE uses `chats_owner_activity` with both org and owner predicates; all message
nodes are index-backed; and no plan has a sequential scan on `chats`,
`chat_messages`, or `ai_runs`. The exact serialized plan line was truncated by
the command-output limit, so leaf message-index names and the full pg_settings
table are not retained in this artifact.

Warmup output is server-side request `responseTime`, not the benchmark's
client-side elapsed timer. It is partial because the run was stopped after
repeated statement-timeout failures:

| Query class (execution order) | Observed status and server response times               |
| ----------------------------- | ------------------------------------------------------- |
| stem (`agreements`)           | 5 × HTTP 200: 8,257; 7,876; 7,644; 8,055; 8,145 ms      |
| partial (`contrac`)           | 5 × HTTP 500: 10,039; 10,042; 10,047; 10,045; 10,036 ms |
| article (`1320`)              | 2 × HTTP 200: 8,033; 7,436 ms                           |
| no-match                      | Not reached                                             |

After the five consecutive 10-second HTTP 500 responses, the benchmark process
was interrupted and the cloned database was dropped by the per-file fixture.
The warmup summary line was emitted only after all four classes, so client-side
elapsed values for these partial samples were not persisted. The run produced
no 30-sample class, no p50/p95/max, and no complete warmup matrix. The
performance gate is **failed/incomplete**; this does not establish a measured
p95. No timeout was increased and no production query or RLS policy was
changed after this result.

An earlier trial with the million unrelated messages concentrated in six
chats was not a representative fixture and is excluded from acceptance
evidence. The final fixture distributes those same messages across 40,002
valid chats. An intermediate fixture draft with same-role parent links failed
the existing chat-tree guard before seeding; it also is not benchmark evidence.

## Research and limits

PostgreSQL 17 documentation describes row-security policies and security
barriers, including the planner restrictions around non-leakproof expressions:
[row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html),
[security barriers](https://www.postgresql.org/docs/17/rules-privileges.html),
[`pg_proc`](https://www.postgresql.org/docs/17/catalog-pg-proc.html),
[GIN indexes](https://www.postgresql.org/docs/17/gin.html), and
[pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html). Earlier catalog
inspection found the text-search functions, `@@` implementations, and
`word_similarity_op` marked `proleakproof=false`; no function or policy was
changed to work around those documented constraints.

The gate's request failures need owner review before further performance
work. This report does not claim the 300 ms target was met, does not waive the
30-sample requirement, and does not mark Task 13 complete.

## Owner-authorized generated-vector optimization and final gate

The owner then authorized a bounded optimization: stored generated English
vectors for user messages and canonical answer output, a materialized
query-input CTE, safe prefix-query construction, and title-only trigram
matching. The answer vector follows the existing search rule: completed runs
use `final_output`; all other statuses use `partial_output`. No vector index
was added because the final representative plans did not select one. The
production search path retains app-role RLS and the same explicit owner,
organization, and nondeleted-chat checks. Search timeout SQLSTATE 57014 maps
to a fixed HTTP 503 message.

The corrected final run used the command above. It seeded 2,000 owner chats,
50,000 owner messages, 24,000 canonical answer runs, and 1,000,002 unrelated
messages across 40,002 unrelated chats. It applied migration 0036 to the
populated tables and ran `ANALYZE app.chats, app.chat_messages, app.ai_runs`
before planning. PostgreSQL reported `17.11 (Debian 17.11-1.pgdg12+2)`; the
same app-role connection reported `statement_timeout=10000 ms`,
`enable_seqscan=on`, `work_mem=4096 kB`, `shared_buffers=16384` (8kB pages),
`effective_cache_size=524288` (8kB pages), `random_page_cost=4`,
`seq_page_cost=1`, `jit=on`, `effective_io_concurrency=1`, and
`max_parallel_workers_per_gather=2`. No planner override was used.

All four EXPLAIN JSON plans passed the owner-first and no-whole-table-scan
assertions. Each owner CTE starts with `chats_owner_activity` using both
`org_id` and `owner_user_id`; message access uses `chat_messages_tree` and
other primary/unique B-tree indexes. No plan has a sequential scan on chats,
chat_messages, or ai_runs. No generated-vector GIN index was selected or
created. The complete sanitized plan nodes and settings are retained in the
benchmark JSONL artifact.

Adding the stored generated columns to the populated fixture took 3,018.03 ms
for the message vector and 3,792.81 ms for the answer vector. Afterward,
message relation bytes were 431,923,200 before and 451,477,504 after, with
51,304,300 vector bytes (vector size p50 87 bytes, p95 89 bytes). Run relation
bytes were 262,668,288 before and 277,094,400 after, with 45,818,400 vector
bytes (p50/p95 67 bytes). Direct writes to both generated columns were
rejected as expected.

After five successful warmups per class, the harness recorded 30 successful
API requests per class. These are client-side elapsed milliseconds from the
HTTP request helper:

| Query class      | Samples | p50 ms | p95 ms | Maximum ms | Failures |
| ---------------- | ------: | -----: | -----: | ---------: | -------: |
| stem             |      30 | 246.60 | 281.75 |     283.26 |        0 |
| partial          |      30 | 223.51 | 237.41 |     259.13 |        0 |
| article (`1320`) |      30 | 224.45 | 231.26 |     260.06 |        0 |
| no-match         |      30 | 168.18 | 173.22 |     174.37 |        0 |

All four measured p95 values are below the owner-approved 300 ms target. The
earlier failed warmup run remains documented as historical; it did not
contain a complete measurement set and was not used to claim a p95 miss. The
artifact is `test-results/f4-search/gate-2026-11-12T03-54-29.116Z-39372.jsonl`.
Its source SHA-256 manifest includes the 0035/0036 migrations, repository,
schema, fixture, benchmark helper, service, and performance test. Host was
Apple M4/macOS 27.0/arm64 with 10 CPUs and 16 GiB; Docker Desktop VM had 10
CPUs and 8,217,059,328 bytes, with container limits unlimited inside the VM.
After measurement, only formatting was applied to the repository, fixture,
benchmark helper, service, and search tests; tests were also changed to import
repositories through the public database barrel after lint identified the
boundary violation. No production behavior changed. The artifact hashes refer
to the exact pre-format source used for measurement, not the formatting-only
follow-up commit.

This is bounded evidence for the accepted per-owner chat-search fixture. It
does not establish indexed full-text or trigram behavior under RLS at document
scale; the separate F8 retrieval and S3 spike remain responsible for that
scale requirement.

## Task 13 review fixes and durable final gate (2026-11-12)

The review-fix source is commit `2bf4281fa7e6d783c90e59d5242445fa238f42b1`
(`fix(chat): preserve punctuated search prefixes`), following
`ae13a980d905b7fd9ee4f796941c43216dc8f5d7`. The complete durable
synthetic JSONL artifact is
[F4-search-final-gate-2026-11-12.jsonl](F4-search-final-gate-2026-11-12.jsonl),
SHA-256 `0bfb1da386b700c0137c8113e6821fd447913090bd8e220026026aba4dc86e6c`.
The artifact contains the sanitized full nested plans, app-session settings,
four plan records, 20 warmups, all 120 client request timings, migration
measurements, and the performance summary. Its eight-file source manifest
matches the producer commit exactly. Unlike the earlier JSONL referenced above,
this copy is committed and contains no absolute workspace path. The previous
final gate remains in git history; this run is the newest gate.

### Corrected selection and safe snippets

Message candidates now outrank a title candidate within the same chat, so a
title cannot discard a matching message navigation target. Among messages the
best score wins; equal scores use source order then message ID as stable ties.
Title-only results still have no message target. Search prefix generation adds
the prefix operator only to the final nonnumeric token; earlier tokens require
their exact English-normalized lexemes. Numeric article tokens remain ordinary
terms.

For page rows only, the repository uses PostgreSQL 17 `ts_headline` with
`HighlightAll=true` and per-request random start/stop markers. The service
removes all marker pairs, uses the first actual highlighted span to build a
plain-text excerpt of at most 500 UTF-16 code units, and returns offsets into
that excerpt. This preserves original text, including markup-like strings; the
returned content is text and must never be rendered as HTML. The lookahead row
continues to have a null excerpt. PostgreSQL documents that `ts_headline`
chooses matching fragments and supports custom markers; with `HighlightAll`
the whole document is selected before application-side bounded trimming. See
the official [PostgreSQL 17 text-search controls and headline safety notes](https://www.postgresql.org/docs/17/textsearch-controls.html#TEXTSEARCH-HEADLINE).

The search regression now verifies title/message priority, nonfinal exact
terms versus final-token prefixes, plural-to-singular stem snippets near the
end of a long answer, offset correctness, multiple markers, hostile marker-like
source text, trailing punctuation preserving a final word prefix (`contrac!`),
numeric `1320!` remaining an ordinary term, punctuation-only input returning no
matches safely, deterministic message ID ties, an inactive-branch hit followed by
branch resolution, and deletion between search and target resolution. Existing
URL/cursor/error canaries remain. HTTP logging and OTel tests include a search
query canary in a POST body and in unapproved span attributes. The repository
has no Sentry SDK or Sentry sink in either backend or frontend; a Sentry-shaped
synthetic object is tested against the existing generic log filter, and no
actual Sentry integration is claimed. If a Sentry SDK is added later, it needs
its own integration canary.

### Plan shape and measurements

Command: `pnpm exec vitest run --project backend-integration chat-search-performance.spec`
— **1 file passed, 1 test passed**, duration 158.09 seconds. This final run used
producer commit `2bf4281fa7e6d783c90e59d5242445fa238f42b1`, PostgreSQL
`17.11 (Debian 17.11-1.pgdg12+2)`, the same representative fixture (2,000
owner chats/50,000 owner messages/24,000 canonical answer runs and 1,000,002
other-tenant messages across 40,002 chats), `statement_timeout=10000 ms`, and
`enable_seqscan=on`. Hardware and the other exact app-session settings are in
the JSONL header/preflight records.

The four retained nested plans each have 68 nodes. All executed as
`lexon_app` with tenant org/user settings. `app.chats`, `app.chat_messages`,
and `app.ai_runs` reported row security enabled and forced. The owner CTE
contains the actual `chats_owner_activity` index subtree, with both `org_id`
and `owner_user_id` in its index condition; catalog `pg_get_expr(indpred,...)`
records the partial predicate `(deleted_at IS NULL)`. No whole-table
sequential scan on chats, messages, or run outputs appeared. The plans used
`chats_owner_activity`, `chat_messages_tree`, `chat_runs_org_id_run_id_key`,
`chats_pkey`, `ai_runs_org_id_id_key`, and `ai_runs_pkey`; no vector GIN index
was selected or created. The artifact preserves each nested node and its
estimates, filters, index conditions, costs, settings, row-security proof,
partial-index predicate, and planning/execution time.

After 5 successful warmups per class, the final run recorded 30 successful API
requests per class. All 120 returned HTTP 200; values below are client-side
elapsed milliseconds:

| Query class      | Samples | p50 ms | p95 ms | Maximum ms | Failures |
| ---------------- | ------: | -----: | -----: | ---------: | -------: |
| stem             |      30 | 256.28 | 273.00 |     278.32 |        0 |
| partial          |      30 | 232.36 | 259.52 |     277.54 |        0 |
| article (`1320`) |      30 | 235.36 | 251.33 |     254.98 |        0 |
| no-match         |      30 | 169.62 | 188.87 |     194.31 |        0 |

Every p95 remains below the owner-approved 300 ms target. Migration 0036 on
the populated fixture took 2,816.14 ms for message vectors and 4,095.09 ms for
answer vectors. Message relation bytes changed from 436,469,760 to 451,477,504
(51,304,300 vector bytes; vector size p50/p95 87/89 bytes). Run relation
bytes changed from 263,757,824 to 277,094,400 (45,818,400 vector bytes;
p50/p95 67/67 bytes). `ANALYZE` ran after migration; direct writes to either
generated vector were rejected.

SHA-256 source manifest from the final measurement:

| File                                                             | SHA-256                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `backend/drizzle/0035_chat_search.sql`                           | `75bd1bd7f5a72c86cc13e3576a650d97dc7c0fea8f8c7e92117bd0c66f56f9ac` |
| `backend/drizzle/0036_chat_search_vectors.sql`                   | `e3f78202877a994e58e6eeddafc5242856036a10b28ae9460f83462573e85239` |
| `backend/src/infrastructure/db/chat-search.repository.ts`        | `62b22f0836d247dc81e82cc8a4392050120abcc31f9149d87176db9668804be7` |
| `backend/src/infrastructure/db/schema.ts`                        | `a53e6b1cf5ecdfc910725b6bf4e9b10a071746a88de1ec0a94ad3721120f2dd6` |
| `backend/src/infrastructure/db/testing/chat-search-benchmark.ts` | `cc5a2c671a66f01556501f526d609853896c884622e4428968673c90bd10ae08` |
| `backend/src/infrastructure/db/testing/chat-fixture.ts`          | `1566fd9ddf700d488bc841e637e94e200f1277cabb639d587b6f38c8014cda53` |
| `backend/src/modules/chat/chat-search.service.ts`                | `09d16180eb20ec7963423851b8def3e066423e2f11da048df59d702e8c6ad195` |
| `backend/test/integration/chat-search-performance.spec.ts`       | `d16ec396fdfa738d9422680ba716a84e0a172325a1229258545caf9c2842917e` |

The final benchmark fixture remains intentionally bounded and compressible:
it repeats synthetic positive terms and uses the approved answer length
distribution. The measured latency and vector-storage figures apply to this
fixture only; they do not generalize to arbitrary document corpora. F8 and the
S3 spike still own document-scale indexed search under RLS.

## Linux CI gate miss — owner decision required

The later normal Linux CI run [43157101686](https://github.com/pahle/lexon-ai-v6/actions/runs/43157101686)
at `9f1c619460f7bc9a55a3a4b4b04c575658b91712` failed the same unchanged
search performance assertion: stem p95 **360.011876 ms**, above 300 ms.
The search test ran for 200.075 seconds within the full test suite. The suite
reported 1,133 passed tests and one failure; Compose E2E passed. This is a
separate environment/run from the retained local gate and does not replace
its measurements. Task 13 acceptance is reopened pending owner direction;
Task 14 work is stopped and preserved uncommitted.

The harness wrote
`test-results/f4-search/gate-2026-11-12T04-52-20.598Z-6907.jsonl`
on the runner, but the unit/integration job has no artifact upload step and
GitHub reports no retained artifacts for this run. Consequently the full CI
plans, other classes' timings, sample rows and exact machine/database settings
cannot be recovered from its logs. They are not inferred from local evidence.
The local harness's Docker VM metadata is a literal description of the local
machine; it must not be presented as verified CI hardware. A future evidence
capture needs actual runner metadata and failure-path artifact retention.

No optimization, RLS change, planner override, timeout increase, threshold
change or manual CI retry was performed after discovering this miss. The owner
must decide the next measurement or optimization scope before work resumes.

## Isolated Linux setup attempt — no measurements

The owner approved moving the representative benchmark out of default tests,
with relevant-path/manual isolated CI and a mandatory final-head measurement.
The functional search tests remain in normal CI. The dedicated layer always
uploads JSONL with 14-day retention and prints per-class summaries before the
latency assertion; query, RLS, timeout, fixture and threshold are unchanged.

The first isolated job [43172798424](https://github.com/pahle/lexon-ai-v6/actions/runs/43172798424)
at `c704190738e41ef3813e0924737cae21b4ac437e` aborted during startup,
before the benchmark body or fixture ran. It produced **no latency samples**.
The always-upload step preserved its
[partial artifact](F4-search-linux-startup-2026-11-12.jsonl), SHA-256
`005a49ed775bf329106ce4d40062513104e43881b79baf266b878f761e2fc950`.
Its actual runner was Ubuntu image `20261101.360.1` (`ubuntu24`), AMD EPYC
9V74, 4 CPUs and 16,760,348,672 bytes RAM, Docker 28.0.4. PostgreSQL limits,
plans and timing records do not exist for this setup attempt.

Vitest 5.0.5 imported all global setup modules before executing their callbacks.
The infrastructure module transitively imported workspace contracts before
package preparation created `shared/dist`. A clean Node 24.22.1 Linux canary
reproduced the same startup error without running the representative fixture.
The benchmark-only wrapper now initializes evidence, awaits package preparation,
then dynamically imports infrastructure. The repaired Linux canary passed and
the actual benchmark config collected its spec with the body skipped.

Normal CI [43172798227](https://github.com/pahle/lexon-ai-v6/actions/runs/43172798227)
at `c704190` passed both functional/unit/integration and Compose layers.
The isolated startup abort is neither passing nor failing latency evidence;
the single measured isolated run remains pending. No query optimization,
threshold change or retry to seek a better number was performed.

## Single isolated Linux measurement — gate missed, STOP

The startup and trigger repairs passed scoped spec/quality reviews. The
benchmark-only global setup now builds packages before loading infrastructure.
Automatic execution uses actual changed-file filters on pushes to all branches
(`branches: ['**']`, excluding tag events), plus manual dispatch. This avoids
PR filters' cumulative-diff behavior. A final-head run remains mandatory before
handoff; no further measured run is authorized after the miss below.

The single measured isolated Linux job
[43175713326](https://github.com/pahle/lexon-ai-v6/actions/runs/43175713326)
ran source `86ddad8572d46ee32e3633dda1e05562632ddbe3`.
It finished all four classes, with five warmups and **30 measured HTTP 200
requests per class**. The unchanged under-300-ms p95 gate failed for stem,
partial and article queries. There was no retry for a better number.
Task 13 performance acceptance remains open and Task 14 remains stopped.

The complete [Linux JSONL evidence](F4-search-linux-gate-2026-11-12.jsonl)
contains 157 records, including all 120 samples, 20 warmups, four complete
nested plans, actual runner/container metadata, source attribution, migration
costs, vector sizes, the summary, and the assertion failure. SHA-256:
`afcb37e9af9bbf3b676bee59942929491c41c6e6f95f282de02be9d4cafc91b0`.
GitHub artifact `13924043317` uploaded despite failure with 14-day retention;
the committed copy remains durable. Compact per-class summaries also survived
in the job log. The controller independently checked all 22 source hashes
against the producer, sample indexes/counts/statuses, nearest-rank statistics,
and the four plans. This verification did not rerun the benchmark.

### Local and isolated Linux results

Both use the unchanged synthetic fixture: 2,000 owner chats, 50,000 owner
messages, 24,000 canonical answer runs and 1,000,002 other-owner messages in
40,002 chats. The local producer is `2bf4281`; the Linux producer is `86ddad8`.
The production repository, search service, fixture and migrations have identical
source hashes. No query, RLS, timeout, sample-count or threshold change was made.

| Class            | Local p50 ms | Local p95 ms | Local max ms | Linux p50 ms | Linux p95 ms | Linux max ms |
| ---------------- | -----------: | -----------: | -----------: | -----------: | -----------: | -----------: |
| Stem             |       256.28 |       273.00 |       278.32 |       391.52 |   **405.30** |       498.37 |
| Partial          |       232.36 |       259.52 |       277.54 |       377.93 |   **401.93** |       405.51 |
| Article (`1320`) |       235.36 |       251.33 |       254.98 |       384.37 |   **407.02** |       407.34 |
| No match         |       169.62 |       188.87 |       194.31 |       222.20 |       227.88 |       231.35 |

The earlier contended/default-suite Linux result remains recorded separately:
stem p95 360.01 ms, without a retained full artifact. It is not substituted for
this complete isolated result. The startup-only attempt has no timing data.

### Actual Linux machine and PostgreSQL settings

Runner image: `ubuntu-24.04`, `ImageOS=ubuntu24`,
`ImageVersion=20261101.360.1`; Linux `7.0.0-1017-azure`, x64;
AMD EPYC 7763 64-Core Processor, **4 available CPUs**, **16,760,336,384 bytes RAM**.
Docker 28.0.4 reports the same CPU and memory capacity, systemd/cgroup v2.
PostgreSQL is `17.11 (Debian 17.11-1.pgdg12+2)`, image
`postgres:17.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5`.
Its actual HostConfig has memory, NanoCPUs, CPU quota/period/shares all zero
(no explicit limits), empty CPU-set and null PID limit. Effective cgroup
CPU is `max 100000`, CPU set `0-3`, memory has no finite recorded limit,
and PID maximum is 17,436. These are observed Linux values, not the local
Docker Desktop metadata.

App-session settings: `statement_timeout=10000ms`, `work_mem=4096kB`,
`shared_buffers=16384×8kB`, `effective_cache_size=524288×8kB`,
`effective_io_concurrency=1`, `jit=on`, `max_parallel_workers_per_gather=2`,
`random_page_cost=4`, `seq_page_cost=1`, `enable_seqscan=on`.

### Plans and migration evidence

Every Linux plan retains a 62-node nested tree. In each, the owner CTE contains
`chats_owner_activity` with both `org_id` and `owner_user_id` index conditions
and partial predicate `(deleted_at IS NULL)`. Execution role is `lexon_app`,
org/user context is set, and chats/messages/runs have enabled and forced RLS.
There is no whole-table sequential scan on those tables. Final indexes used:
`chats_owner_activity`, `chats_pkey`, `chat_messages_tree`,
`chat_runs_org_id_run_id_key`, `ai_runs_org_id_id_key`, `ai_runs_pkey`.
No GIN index, RLS bypass, LEAKPROOF change or planner override was introduced.
Full local and Linux plan trees are available in their linked JSONL files.
The plan difference and hardware difference alone do not establish a cause for
the latency difference; no further optimization or causal claim is made.

Linux populated migration times were 6,033.37 ms for message vectors and
8,824.85 ms for answer vectors. Message relation bytes changed from
433,938,432 to 451,510,272; vectors total 51,304,300 bytes (p50/p95 87/89).
Run relation bytes changed from 264,003,584 to 277,135,360; vectors total
45,818,400 bytes (p50/p95 67/67). Post-migration ANALYZE and generated-column
write-prohibition checks passed. Synthetic-term compressibility remains a
limitation; this is not F8/S3 document-scale search evidence.

Work is stopped for the owner's decision. No further benchmark, optimization,
threshold change, timeout change or Task 14 implementation follows this miss.

## Owner acceptance and amended reference gate (2026-11-12)

The owner accepts measured run `43175713326` as Task 13 Linux evidence and
changes the gate to **p95 under 500 ms per class** on the GitHub-hosted
ubuntu-24.04 **4-vCPU reference runner**. The existing p95 values
405.30 / 401.93 / 407.02 / 227.88 ms all pass that amended requirement.
No rerun is performed now; historical artifacts and their original 300 ms
assertion failures remain unchanged. Local Apple-silicon runs are informative
only. The mandatory final-head isolated run will apply the 500 ms threshold.

Rationale: 300 ms was an initial owner target, not a measured product
requirement. The owner attributes the gap on identical code and owner-first
FORCE-RLS plans to the reference runner's slower single-thread CPU. This is
owner-accepted rationale; these measurements did not independently isolate CPU
speed as the cause. The fixture is an extreme long-term heavy user.
Query, RLS, timeout, fixture, sample counts and plan assertions stay unchanged.
No further search optimization is authorized in F4.

Chats search is implemented in Task 15, so UX compliance is not yet claimed.
Its acceptance now explicitly requires submit-triggered search, loading UI,
and deferred-response tests proving superseded queries (including late errors,
clear and tenant changes) cannot display out of order. Task 14 resumes first.
Production PostgreSQL tuning, including default 128 MB shared_buffers, belongs
to F20. Indexed FTS/trigram under RLS at document scale remains F8 / spike S3.

## Automatic Task 14 head run — amended gate miss (2026-11-12)

The preview push changed the Markdown lockfile, matching the dedicated job's
relevant-file filters. Automatic run
[43232959421](https://github.com/pahle/lexon-ai-v6/actions/runs/43232959421)
measured `8fe012d4081eb3e971e3f578e88e9d5214a8d05b` once. It missed
the amended **under-500-ms** gate in two classes. No manual dispatch or retry
was performed. The owner-accepted earlier run remains historically accepted;
it does not establish that this later head passed.

| Class    | Accepted run 43175713326 p95 ms | Task 14 head p50 ms | Task 14 head p95 ms | Task 14 head max ms |
| -------- | ------------------------------: | ------------------: | ------------------: | ------------------: |
| Stem     |                          405.30 |              520.43 |          **530.60** |              535.96 |
| Partial  |                          401.93 |              365.31 |          **536.09** |              541.68 |
| Article  |                          407.02 |              365.85 |              385.63 |              399.21 |
| No match |                          227.88 |              213.01 |              220.65 |              225.51 |

All 120 measured requests returned HTTP 200, 30 per class. The retained
[157-record head artifact](F4-search-task14-head-2026-11-12.jsonl) includes
all samples and four nested plans; SHA-256
`3e8e5885ccb4ca3e9f875968629dde77f88ffe930211c71604c6934a92263c5d`.
GitHub artifact ID is `13951876576`. The controller verified all 22 source
hashes against the producer and recomputed per-class statistics. Plans retain
the owner index and enabled/forced tenant RLS, with no whole-table sequential
scans of chats/messages/runs. Query, timeout, fixture and threshold are unchanged.

Actual runner: ubuntu-24.04 / image 20261101.360.1, AMD EPYC 7763, 4 available
CPUs, 16,760,344,576 bytes RAM. This is the same reported CPU model as the
accepted isolated run. The variation therefore cannot be attributed solely to
a different CPU model from these measurements; cause is unestablished.
No further optimization, threshold amendment or measured retry is authorized.
Task 15 is held for owner direction under the existing stop-on-miss rule.

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

## First run with split gate/target semantics

Automatic relevant-file run
[43257653026](https://github.com/pahle/lexon-ai-v6/actions/runs/43257653026)
at `373c1f4` passed the new blocking gate and all 500 ms targets.
All four classes completed 30/30 successful requests. Per-class p95 ms:
stem **367.78**, partial **401.79**, article **367.58**, no-match **208.19**.
The job log and GitHub step summary report PASS/NONE per class; JSONL contains
both policy limits and assessments. This is another observed run, not a retry
of either historical accepted run. Complete data is retained in
[F4-search-policy-gate-2026-11-12.jsonl](F4-search-policy-gate-2026-11-12.jsonl).
The controller checked producer source hashes against the recorded head.
The final-head isolated run is still required; no final-head claim is made.

## Task 15 pushed-head trend — 2026-11-13

Automatic isolated [run 43354598506](https://github.com/pahle/lexon-ai-v6/actions/runs/43354598506)
passed at `dd31b54894048b631a785c162be3df9730a89e9d`. This was triggered by
relevant Task 15 files, not a manual retry. The [full JSONL artifact](F4-search-task15-head-2026-11-13.jsonl)
contains 156 records; SHA-256
`57266eff538f62881fdede4563e27c210135c82edd4e08947d7787c8e48eb59e`.

| Class    | p50 ms | p95 ms | Max ms | Successful measured requests | Blocking / target |
| -------- | -----: | -----: | -----: | ---------------------------: | ----------------- |
| Stem     | 368.36 | 374.70 | 392.86 |                        30/30 | PASS / no warning |
| Partial  | 271.61 | 363.34 | 364.09 |                        30/30 | PASS / no warning |
| Article  | 280.76 | 289.49 | 303.42 |                        30/30 | PASS / no warning |
| No match | 159.64 | 165.13 | 165.48 |                        30/30 | PASS / no warning |

The controller independently verified all 22 producer source hashes, recomputed
nearest-rank p95 from the 120 successful HTTP samples, and inspected all four
plans: `chats_owner_activity` is used; the three tables retain enabled/FORCE
RLS; there are no whole-table sequential scans on chats/messages/runs. No query,
RLS, fixture, timeout or policy optimization was added for this run.

Runner: ubuntu-24.04 image `20261111.127.1`, Intel Xeon 6975P-C, four CPUs,
16,464,306,176 bytes RAM; Docker 28.0.4. PostgreSQL container has no explicit
memory/CPU limit, effective CPUs 0–3; exact image, cgroups and application-session
settings are in the artifact. `shared_buffers` remains 128 MB. This differing
runner is recorded for trend context, not an isolated causal explanation.
The mandatory final-head run still applies before handoff; this intermediate
result is not final-head evidence for tasks that have not landed yet.
