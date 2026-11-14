# F4 final review fixes

The whole-branch review at `5f07d1c52f09f090c93a4ab2fefdce813a5d26ae`
identified four Important findings and no Critical finding. This receipt records
the authorized fix wave. Hosted results and PR readiness are tracked by exact
head SHA in [PR #29](https://github.com/pahle/lexon-ai-v6/pull/29); this document
does not turn earlier runs into final-head evidence.

## Behavior and controller evidence

| Finding                            | Result                                                                                                                                                                                                                        | Controller verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 — lost blocking XREAD socket    | Reconnect the same shared blocking client after the existing bounded delay, preserving live cursors and the replay connection.                                                                                                | An existing subscriber missed the post-kill event in RED (1 failed / 20 passed). The frozen replay file passed 21/21 after the fix. Socket identity, ordered frames, unchanged generation, no duplicates and two live reader connections are asserted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I2 — server-active answer controls | Queued, running and cancelling answers keep Stop available and block send/edit/regenerate independently of SDK headers or the viewed branch. Canonical refresh preserves the selected branch and reconciles terminal content. | Public runtime/thread/ChatView tests cover cancelling, initial header wait, an off-branch answer, an already-open edit, terminal unlock and canonical text after branch selection. An earlier focused run passed 48/48; the final frontend run passed 339/339 across 38 files, including 49 cases in the three runtime/thread/ChatView files. An additional RED proved that an open SDK stream could ignore canonical completion and accept a late delta; GREEN verifies final text, retained draft, enabled Send, closed stream and no server-cancel request. A separate initial-header-wait RED proved that a late response could overwrite canonical completion while the SDK was idle; transport-generation invalidation now aborts that obsolete request, blocks late resumption and preserves the original close/disposal rejection contract. |
| I3 — ambiguous first-create retry  | Retain the three creation identities and exact text/effort for an unchanged manual retry; replace them for a deliberate changed operation and clear them after acknowledgment.                                                | Corrected frozen RED: 1 failed / 5 passed because the retry minted fresh IDs. GREEN: 6/6, including a single accepted logical run, original-result navigation, same-payload submission after acknowledgment, and text-only/effort-only changes. No automatic mutation retry is added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I4 — missing mutation audits       | Append strict IDs-only rename/edit/regenerate events in the mutation transaction. Accepted edit/regenerate replays return before a second append.                                                                             | Corrected frozen RED: 13 failed / 3 passed across Zod admission, PostgreSQL admission, successful/replayed operations and injected append failures. GREEN: 16/16, including refusal, rollback and content rejection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Controller commands, complete logs, source/test hashes, full-file scope checks
and phase snapshots are retained in the ignored
`.superpowers/sdd/2026-11-09-f4-chat/recovery/` directory. Representative immutable
output hashes are:

| Receipt                         | SHA-256                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| I1 qualified RED                | `cd5104024f06ab49dea1fd27fe33000334bbc4274649d51ab333a8d2a829ddbe`                                                                      |
| I1 normalized full replay GREEN | `d30dbb424bbbc72289e5db5ff40ca6530c0887a9952d5c1be85fca5b8eff8feb`                                                                      |
| I2 terminal regression RED      | `f2bd34dc7febe3333eb963f6f68fe15c446db008732d190659931aa3f8e4485e`                                                                      |
| I2 final focused GREEN          | `1299935cd31a00656151d1f356c6fdb09fc2a50d9162026c2d5fd902a234d424`                                                                      |
| I3 corrected RED / GREEN        | `f9f81c634a4a13724b750c4f48c4b83463cee8115b42b75f986c72a72c42b811` / `4eb665883a825ecba423c6657d8e8d7a53b699f4847c573c8ef8b3652db04a62` |
| I4 corrected RED / GREEN        | `19c53ba5f11c5ad1423aa00882a9b26dddfb85b7f16ed7d3d08c59cbc3ec32ed` / `e20ab1bf6559eab09d16a130f2358484c766852d87d9cdf449f5f9c85d08b876` |

The original I1 RED/GREEN used an identical frozen test hash. A later test-only
cleanup uppercased case-insensitive Redis CLIENT subcommands for the pinned
ioredis overloads; all assertions and limits remained, and the normalized file
passed 21/21. I3's misplaced post-success effort assertion was corrected before
a fresh RED against restored pre-fix production and exact restoration of the
approved implementation for GREEN. Test-only type/import cleanups preserved
emitted JavaScript where recorded. The final nullable-head type correction
also adds an explicit null guard; its emitted JavaScript differs, while null
still takes the prior membership-miss fallback. No byte-identity claim is made
for that correction.

The pinned adapter seeds `messageRepository` once. Public thread imports must
also carry fresh external-message bindings. Public observation additionally
showed that a live assistant can appear in `getState().messages` while being
absent from `export()`. Terminal reconciliation therefore captures the visible
assistant/leaf before local SDK teardown, restores only matching canonical
terminal data with a valid parent, and respects an explicit branch switch
during the await. Temporary diagnostic instrumentation was removed, restoring
the exact regression test before the final implementation and GREEN.

## Audit contracts

| Event                         | Metadata                                                        |
| ----------------------------- | --------------------------------------------------------------- |
| `chat.renamed.v1`             | `{ chatId }`                                                    |
| `chat.message_edited.v1`      | `{ chatId, messageId }`, identifying the new edited user node   |
| `chat.message_regenerated.v1` | `{ chatId, messageId }`, identifying the new assistant/run node |

All three require version 1, success, organization and actor identities. Zod
and the PostgreSQL row trigger reject content and malformed IDs. Migration
`0037_chat_mutation_audit` extends the existing validator routing and preserves
its security mode, search path and privileges; it adds no content-reading or
RLS bypass. Historical migrations are unchanged.

## Aggregate verification and limits

Frozen install, build, workspace types, lint (99 boundary checks), Node tooling
(262 tests) and separate mock evals (48 tests / 4 files) passed locally. A
preliminary full frozen local `pnpm test` run, before the final initial-header
transport follow-up, was **not clean**: **1,397 passed / 7 failed**
across 200 files in 506.62 seconds, log SHA-256
`dd42098d91f96c84cad075dad3e3fd17fa92ae997de820e80442f9948197c86e`.
All fix-specific files passed. Failures were in unchanged `ai-execution`,
`ai-queue-routing` and `ai-streams` integration files.

A same-configuration run of those three complete files passed all seven
original failing cases but failed two different short-lease cases:
**128 passed / 2 failed**, 84.40 seconds, log SHA-256
`074ac7557653171d990692ca6c530eaf7744b18d84a17788be38d11bfcafd074`.
The final frontend-only follow-up passed 339/339 with all existing transport
assertions unchanged. After a test-only nullable-signal/cleanup correction, the
controller restored pre-header production, observed the same late-header
behavioral RED, restored the exact approved implementation, and repeated all
339 frontend tests successfully with the corrected frozen test hash. This changing backend failure set supports timing sensitivity but does not establish
a specific cause or a local GREEN result. The direct RunStreams/StepExecutor
paths and those test files are unchanged. The 250 ms publication deadline,
lease settings, timeouts and assertions remain unchanged. Neither local run
is a waiver; the complete exact-head Linux suite must pass before handoff.

A single scoped re-review of this fix wave, exact-head normal Linux CI
(including retained baseline comparisons), isolated search and isolated S2
load are mandatory handoff gates. Their results belong to the head SHA linked
in PR #29. Earlier hosted runs are historical evidence only.

The [Task 19 gallery](F4-visual/README.md) and
[deviations](F4-visual/deviations.md) remain the owner's review set. No visual
approval is inferred. The 62 retained assertions, 20 owner-retired assertions
and F4.1 replacement obligation are unchanged. No paid call, dotenv access,
dependency change, threshold change, baseline update, main push or merge is
part of this wave.

Original Minor findings remain explicit follow-ups: M1 executor/title lifecycle
coupling, M2 inline grader readability, and M3 future recapture metadata
invalidation. These are not represented as fixed by the four Important fixes.
