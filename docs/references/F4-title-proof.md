# F4 Task 12: durable first-answer title evidence

Date: 2026-11-12. Task 12 implementation evidence for review; the controller-owned [F4 acceptance entry](F4-acceptance.md) is unchanged.

## Research

Task 12's cited design research R2, R8 and R16, the title requirements, dispatcher receipts, and current local interfaces were read before implementation. The current official BullMQ documentation and installed version were checked on 2026-11-12:

| Source                                                                                                                             | Version checked            | Decision                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) and [job IDs](https://docs.bullmq.io/guide/jobs/job-ids) | BullMQ 6.5.3               | Keep title scheduling retry-safe with the existing PostgreSQL outbox, deterministic per-chat task ID, and transactional processed-job receipt. No BullMQ API change or new dependency is needed. |
| [Design research R2, R8 and R16](../superpowers/specs/2026-11-09-f4-chat-design.md#research-notes)                                 | AI SDK 7 / pinned F4 stack | Continue through the existing registered profile, F3 run engine, database context and ordinary attempt accounting; do not call the model directly from the chat service.                         |

## Requirements and evidence

- The first completed answer schedules the unique `chat.title.v1` outbox task from its completion transaction. The title task runs through a registered `chat-title` profile and ordinary F3 engine/accounting.
- Receipt handling and title-run creation now share the same caller-owned transaction. Capacity admission failure rolls back the receipt, leaves the completed answer intact, and permits the same task to retry.
- The title run stores a bounded first-turn prompt, uses versioned trusted instructions to request the user's language, and resolves effort to `none`. The user question and answer are supplied as JSON values treated as untrusted content.
- Invalid or failed title output leaves the excerpt. Conditional update checks the saved title version, excerpt source, and live chat row. Rename during generation wins.
- No model call occurs when rename/delete happens before title-task start or after title-run creation but before its `run.start` delivery. A blocked real title generator released after delete cannot complete a run or change the deleted chat's excerpt.
- The Task 11 deletion proof's earlier statement that actual title production was future work is superseded by these Task 12 producer tests. The blocked late-finish test specifically covers the content fence; Task 11 remains the proof for cleanup, capacity release and late usage settlement.

## Verification

Actual behavior REDs recorded before the production fixes:

```text
pnpm exec vitest run --project backend-integration chat-title.spec
1 failed: completed first answer expected one chat.title.v1 outbox task, received zero
```

The delayed rename race separately observed two gateway calls where the expected count was one. Both behavior failures passed after the transactional scheduler and title-run preflight were implemented.

Latest focused result:

```text
pnpm exec vitest run --project backend-integration chat-title.spec
Test Files  1 passed (1)
Tests       12 passed (12)
```

Affected checks pass: `pnpm --filter @lexon/backend typecheck`,
`pnpm --filter @lexon/backend lint` (99/99 boundary checks), `pnpm format:check`,
and `git diff --check`. The prompt test includes control characters requiring
JSON escaping and remains within 4,096 UTF-8 bytes. No real model call or new dependency was used. The
controller owns acceptance and push; this note records bounded task evidence.

## Fix round 1: client invalidation and Unicode punctuation

The reviewed implementation had no consumer path for the existing title
notification. It now shares the process's existing PostgreSQL notification
listener and exposes authenticated `GET /api/chats/events`. Frames contain only
the strict `{ version, type, chatId }` invalidation contract. The service checks
the stream's current owner and organization, binds each callback to its
subscriber async context, and shares the existing six-connections-per-user
registry. A bounded 64-ID queue coalesces overflow into one `chatId: null`
owner-wide refresh; slow sinks close after the existing 5-second drain bound.
It does not add a PostgreSQL listener connection.

The public frontend helper subscribes with cookie credentials and invalidates
only `['tenant', orgId, userId, ...]` chat keys. Open and reconnect perform a
15-second-bounded refresh so a missed event is recovered. When an error-time
refresh completes before a change during the disconnect, reconnect schedules
one refresh at the end of the active 15-second throttle window. Dispose clears
the pending timer and event handlers and closes the source. No screen has
adopted this helper yet. Task 14/15
consumers should call `subscribeToChatInvalidations` with the active verified
org/user scope, and must not source that scope from event payloads.

Unicode punctuation validation now rejects trailing Unicode punctuation and
quotation-mark wrappers while preserving internal punctuation. The actual
producer test confirms `「Perjanjian」`, `‹Perjanjian›`, and `Perjanjian —`
retain the excerpt, while `Perjanjian — dasar hukumnya` is accepted.

Additional transaction tests confirm a failed or cancelled first answer can be
followed by an eligible completed answer, and an injected `chat.title.v1`
outbox insert failure rolls back the answer's completion transition and leaves
no title task. Stream unit tests cover overflow, slow-client cleanup, oldest
local eviction, and listener loss. Backend integration covers two simultaneous
owners through the real authenticated API and shared PostgreSQL notification
path. These tests do not claim an end-to-end queue-consumer test or any UI
screen wiring.

Official interface checks read 2026-11-12: the [WHATWG HTML Standard's
EventSource definition](https://html.spec.whatwg.org/print.pdf) confirms the
`withCredentials` constructor option; the [TanStack QueryClient
reference](https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryClient)
documents `invalidateQueries` query-key filters. The installed frontend pins
`@tanstack/react-query` 5.105.0.

## Fix round 2: reconnect recovery

The regression uses an active TanStack `QueryObserver`: the error-time fetch
returns the excerpt, the title changes while disconnected, and a reconnect
inside the throttle window must eventually refetch the new title. A single
deferred refresh is scheduled for the throttle boundary; disposing the helper
cancels it.

Focused frontend verification is recorded in the round-two task report.
