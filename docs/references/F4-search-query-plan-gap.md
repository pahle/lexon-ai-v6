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

| Query class | Samples | p50 ms | p95 ms | Maximum ms | Failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| stem | 30 | 246.60 | 281.75 | 283.26 | 0 |
| partial | 30 | 223.51 | 237.41 | 259.13 | 0 |
| article (`1320`) | 30 | 224.45 | 231.26 | 260.06 | 0 |
| no-match | 30 | 168.18 | 173.22 | 174.37 | 0 |

All four measured p95 values are below the owner-approved 300 ms target. The
earlier failed warmup run remains documented as historical; it did not
contain a complete measurement set and was not used to claim a p95 miss. The
artifact is `test-results/f4-search/gate-2026-11-12T03-54-29.116Z-39372.jsonl`.
Its source SHA-256 manifest includes the 0035/0036 migrations, repository,
schema, fixture, benchmark helper, service, and performance test. Host was
Apple M4/macOS 27.0/arm64 with 10 CPUs and 16 GiB; Docker Desktop VM had 10
CPUs and 8,217,059,328 bytes, with container limits unlimited inside the VM.

This is bounded evidence for the accepted per-owner chat-search fixture. It
does not establish indexed full-text or trigram behavior under RLS at document
scale; the separate F8 retrieval and S3 spike remain responsible for that
scale requirement.
