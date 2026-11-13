# F4 compensating mutation evidence

Status: complete; main accepted Task 16A on 2026-11-14 after fresh spec and quality review and a scoped provenance correction re-review. The four backend scopes and aggregate exceed 80; all 35 frontend unit and two real Compose demonstrations have actual assertion RED and restored GREEN. This compensates for earlier tests-after work in Tasks 5, 8, 13 and 15 without rewriting that chronology. Final F4 handoff gates remain outstanding.

## Backend scope and baseline

The existing public services/providers/repository/hub are exercised directly.
External IO is faked; selection, parsing, serialization and decision logic remain
real. No new production helper, export or test backdoor was added.

| Production module                                                                                                                  | Mutation scope and rules                                                                  | Original compensation baseline unit coverage                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [backend/src/modules/chat/chat-search.service.ts](../../backend/src/modules/chat/chat-search.service.ts)                           | entire file: cursor binding/schema, ranked pagination, snippets and safe timeout mapping. | [backend/test/unit/chat-search.service.spec.ts](../../backend/test/unit/chat-search.service.spec.ts): 19 passed.                                         |
| [backend/src/modules/chat/chat-history-context.ts](../../backend/src/modules/chat/chat-history-context.ts)                         | entire file: terminal text selection, reasoning exclusion, UTF-8 and model-input bounds.  | [backend/test/unit/chat-history-context.spec.ts](../../backend/test/unit/chat-history-context.spec.ts): 9 passed.                                        |
| [backend/src/infrastructure/db/ai-chat-resource.repository.ts](../../backend/src/infrastructure/db/ai-chat-resource.repository.ts) | entire file: owned live resource mapping and deletion-fence decisions.                    | [backend/src/infrastructure/db/ai-chat-resource.repository.spec.ts](../../backend/src/infrastructure/db/ai-chat-resource.repository.spec.ts): 16 passed. |
| [backend/src/infrastructure/queue/stream-hub.ts](../../backend/src/infrastructure/queue/stream-hub.ts)                             | lines 750–809 only: numeric cursor/order, reset/signature and UTF-8 wire/buffer policies. | [backend/test/unit/stream-hub.spec.ts](../../backend/test/unit/stream-hub.spec.ts): 14 passed.                                                           |

The original scoped compensation cohort was 58 tests: search 19, history 9,
resource 16, and StreamHub 14. After the approved colocated resource-repository
test was included in the normal backend unit project, the final dedicated
baseline was 83/83 passed: search 29, history 9, resource 16, and StreamHub 29. The
controller mutation run also completed its baseline successfully. Tests-only
scope inventories were checked by the controller per file. Preflight fixture
arithmetic, typed request limits and fake IO expectations were corrected in
tests; none was classified as an original-code RED or used to authorize a
production change.
The case-normalization fixture uses alphabetic UUIDs. Positive queue fixtures
are schema-valid events in normal frames of at most 4096 encoded bytes;
malformed JSON and cursor fixtures are intentional negative cases. The synthetic
no-ID reader fixture measures byte policy only and does not prove real Redis ID
behavior. Resource repository tests are colocated under
`backend/src/infrastructure/db/` so lint accepts the existing database boundary;
that boundary was not changed.

The StreamHub range includes all six original pure helpers, from compareIds
through parseCursor. Lines 1–749 coordinate Redis/PG/socket delivery and are
outside this focused pure-policy score; real Valkey/recovery tests remain
authoritative. The other three selected files are measured in full. This scope
boundary is recorded before measurement, and is not an exclusion of surviving
mutants. No mutation kind is suppressed. Any later exclusion needs its written
reason and an explicit record here.

Tooling uses the installed Stryker core/runner 10.1.1 and Vitest 5.0.5, following
F1's dedicated configuration. The runner's installed peer requirement is
`vitest >=2`. The checked command was
`pnpm --filter @lexon/backend exec stryker run stryker.chat.config.mjs`. The
dedicated test-only configuration keeps break 80 and copies no production
behavior. A GREEN compensation baseline grants no permission to change business
code. Stryker uses its sandbox; frontend deliberate mutations use a separate
owned checkout.

## Accepted backend measurement

At source head `5509e249b40b76cb0e4a3d08341900f238e9fcbe`, the controller recorded
83 baseline tests passing and, in the final post-format rerun, aggregate score
**87.04%** in 40.654 seconds, above the
80% aggregate and per-module threshold. The selected scores were Resource
93.75%, History 92.54%, Search 86.11%, and StreamHub lines 750–809 80.77%.
Across 409 mutants, 345 were killed, 11 timed out, 47 survived and 6 had no
coverage. There were no excluded mutants, suppressions, scope changes, threshold
changes or business-code changes. The compact
[backend report](F4-mutation/backend-report.json) records source and final
harness hashes and the final raw report SHA-256
`eac660ffed96a13d446547d15537febe211d91c9ba25c6d813f675d1d26dc49d`.
The checked final controller record and log are
[`phase-16a-22-controller-mutation.json`](../../.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-16a-22-controller-mutation.json)
and
[`phase-16a-22-controller-mutation.log`](../../.superpowers/sdd/2026-11-09-f4-chat/recovery/phase-16a-22-controller-mutation.log).

Earlier aggregate measurements of 78.24%, 86.55% (StreamHub 78.21%) and 86.80%
(StreamHub 79.49%) are retained only as intermediate history; they do not pass
the selected per-module gate, even where Stryker exited successfully. Fixture
failures during test development were not production-behavior REDs. These
mutation results do not substitute for PostgreSQL/RLS, trigger, Valkey, runtime,
security, integration or browser evidence.

## Frontend rule inventory

Task 15 source provenance: a64b139, with review corrections 164ccca,
4911883 and 8047ff7. Controlled demonstrations cover submit/loading,
stale requests and owner changes, paging/deduplication/cache synchronization,
literal snippets, persisted branch targeting/scroll/two-second highlighting,
Recent/history grouping and scoped keys, inline rename, concurrent deletion
rollback and navigation safety, mounted title refresh, and mobile close/focus.
Existing behavior tests and the browser layer remain. Missing behavior coverage
identified during the controlled demonstrations was added before each
corresponding deliberate break was accepted.

## Controlled frontend and mobile demonstrations

At the same production source head, 35 frontend unit mutations each produced a
qualified assertion RED and a restored GREEN. The frontend report records the
exact mutation, test command, output hashes and unchanged source/test hashes.
After the visible-literal assertion was added, the complete literal text
baseline passed 13 tests; its deliberate mutation then produced RED and restored
GREEN. Four initial
attempts are retained in the report but not credited: stale completion, owner
isolation, clear and delete-owner guard did not initially trigger an assertion.

| Behavior rule                                                                                                                | Controlled mutation name(s)                                                                                                                                                         | Covering test                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Search submits only on demand, loads pages and cursors, deduplicates, renders a literal excerpt and marks the returned range | `search-submit-only`, `search-loading`, `search-page-cursor`, `search-page-deduplication`, `search-literal-highlight-range`, `literal-excerpt-text`                                 | [chat-search.spec.tsx](../../frontend/test/chat-search.spec.tsx)    |
| Search result navigation resolves branches, handles expired ownership and retains title-only branch state                    | `match-branch-resolve`, `match-expired-owner`, `title-only-preserves-branch`                                                                                                        | [chat-search.spec.tsx](../../frontend/test/chat-search.spec.tsx)    |
| Search request ownership, tenant isolation, clear, and synchronized rename/delete cache behavior                             | `search-stale-completion`, `search-owner-isolation`, `search-clear`, `search-rename-cache`, `search-delete-cache`                                                                   | [chat-search.spec.tsx](../../frontend/test/chat-search.spec.tsx)    |
| Recent/history paging and date groups, scoped cache keys, and inline rename rules                                            | `recent-six`, `history-page-cursor`, `history-date-groups`, `owner-cache-key`, `rename-trim`, `rename-escape`, `rename-unicode-limit`, `rename-stale-owner`, `recent-inline-editor` | [chat-history.spec.tsx](../../frontend/test/chat-history.spec.tsx)  |
| Delete optimistic state, rollback, route behavior, owner guard, concurrent snapshots and mounted-scope callback behavior     | `delete-optimistic-removal`, `delete-refusal-rollback`, `delete-current-route`, `delete-current-redirect`, `delete-owner-guard`, `delete-concurrent-snapshot`                       | [chat-history.spec.tsx](../../frontend/test/chat-history.spec.tsx)  |
| Mounted title refresh, late initial title, and matched-message scroll/highlight duration and reduced-motion behavior         | `mounted-title-refresh`, `late-initial-title`, `matched-message-scroll`, `matched-message-highlight`, `matched-message-duration`, `matched-message-reduced-motion`                  | [chat-thread.spec.tsx](../../frontend/test/chat-thread.spec.tsx)    |
| Mobile Recent and View all close the sheet and focus the destination heading                                                 | `mobile-close-recent-and-view-all`, `mobile-focus-recent-and-view-all`                                                                                                              | [chat-history.spec.ts](../../backend/test/e2e/chat-history.spec.ts) |

The two mobile demonstrations used the same unchanged real Compose E2E test
(`e0a0772f850001569affe8f3c39666b88b990b34600befcc2f723dce97d7fd12`). The
close mutation made both Recent and View all remain open; the focus mutation
left both headings unfocused. Each mutation had one failing E2E test and passed
after restoration. A grep anchored at the start of the test name initially
selected zero tests; the corrected unanchored selector ran the intended test and
the baseline passed in 46.261 seconds. The compact
[frontend report](F4-mutation/frontend-report.json) and [mobile report](F4-mutation/mobile-report.json)
retain the demonstrations and provenance.

All production source remained unchanged at `5509e249b40b76cb0e4a3d08341900f238e9fcbe`.
The latest root lint (99 passed), workspace types, full format checks and full
root regression passed. Final documentation formatting and the fresh task
review with scoped re-review also passed. Main accepted Task 16A; these
demonstrations do not replace security, runtime or integration evidence.

The pure-policy score does not establish PostgreSQL RLS, triggers or content-write
fences. Existing cross-tenant/no-context negatives and real integration/browser
tests remain unchanged. No RLS/LEAKPROOF/SECURITY DEFINER bypass, threshold change,
paid call or credential access is authorized by this verification task.
