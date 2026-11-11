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
