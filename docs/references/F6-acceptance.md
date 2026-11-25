# F6 acceptance evidence

Status: in progress. Task evidence is recorded per task as it lands on the
`f6-projects` integration branch. Task review and owner acceptance remain
pending. This is not F6 completion.

Design and plan: [design spec](../superpowers/specs/2026-11-25-f6-projects-ethical-wall-design.md),
[implementation plan](../superpowers/plans/2026-11-25-f6-projects-ethical-wall.md).

## Task 0 — F5 carry-over: four minors

`backend/src/modules/chat/run-routing.ts` (new, shared `isRouting`),
`backend/src/modules/chat/expiry-sweep.ts`,
`backend/src/modules/chat/step-coordinator.ts`,
`frontend/src/lib/chat-stream.ts`,
`backend/test/integration/expiry-sweep.spec.ts`,
`frontend/test/chat-stream-ops.spec.tsx`,
`backend/test/e2e/chat-tools.spec.ts`,
`frontend/test/thread-a11y.spec.tsx`.

- **0.1 shared priority check.** `isRouting` (safe-integer priority 1–10,
  `ai-interactive`/`ai-batch` queue) moved verbatim from `step-coordinator.ts`
  into `run-routing.ts`; both call sites import it. Before this change the
  sweep accepted `typeof priority === 'number'`, so a run whose stored
  `resolved_config` carried `priority: 1.5`/`0` reached
  `OutboxRepository.append`, threw `Invalid outbox routing` inside the
  candidate transaction, rolled the expiry CAS back and re-listed forever —
  the latent poison loop from `reviews/F5-review.md` deferred minor 1. Now an
  invalid routing is skipped (the `run.resume.v1` outbox row keeps
  `queue_name`/`priority` NULL → default queue), the candidate commits, and a
  single K1-free warn `ai_operation_expiry_invalid_routing`
  (`{event, runId, operationId, safeCode}` — ids and a safe code only) is
  emitted after commit via the `invalidRouting` flag on the resume
  publication. `approval.service.ts` keeps its own local check — it was not
  in the task's file list (its decide path fails the request rather than
  looping); flagged for the controller.
- **0.2 reassembled tool input.** `chat-stream.ts` accumulates
  `inputTextDelta` text per `toolCallId` in `state.toolInputText` (cleared on
  `tool-input-start`, `reset`, `snapshot-reset`, `snapshot-start`) and a bare
  `tool-input-available` (§9 over-cap, `input` dropped on the wire) now emits
  the JSON.parse of the accumulated text instead of `{}`; unparseable or
  absent text still falls back to `{}`. `onOperationSummaryMissing` still
  fires so the tree refetch fills the row's detail fields.
- **0.3 worker sweep return.** `chat-tools.spec.ts` asserts
  `await workerSweep(runId)` is exactly `{swept: true}` — the return value
  the real `OperationExpirySweep.sweep()` handler reports through the
  worker's `/run/lexon/health/chat-proof.sock` control socket, not only the
  database side effects.
- **0.4 a11y header citation.** `frontend/test/thread-a11y.spec.tsx` header
  now cites the real browser contrast pass: `runBrandAxe` (axe `brandAxeTags`,
  WCAG 2.0/2.1/2.2 A and AA) inside `captureBrandViews` in
  `backend/test/e2e/brand-visual-support.ts`, run on every capture in both
  themes — not `chat-accessibility.spec.ts`.

### RED (before implementation)

- `pnpm vitest run --project backend-integration backend/test/integration/expiry-sweep.spec.ts`
  → new test 'a candidate with an invalid resume priority skips the override,
  logs without K1 and is not retried' **failed**: the op stayed
  `awaiting_approval` (append threw inside the transaction; rollback →
  re-list → retry). Expected — the poison loop the fix removes.
- `pnpm vitest run --project frontend frontend/test/chat-stream-ops.spec.tsx`
  → new test 'keeps the delta-reassembled input when a capped
  tool-input-available drops the wire input' **failed**: the emitted chunk
  carried `input: {}`. Expected — `item.input ?? {}` clobbered the
  reassembled input.
- 0.3 is a missing-assertion gap, not a behavior bug: the socket already
  returns `{swept: true}`; the spec simply never inspected it (spec §2:
  "fails today — not inspected"). The assertion was added and run green
  against the real compose stack.
- 0.4 is a comment-only change; no test beyond lint.

### GREEN (after implementation)

- `pnpm vitest run --project backend-integration backend/test/integration/expiry-sweep.spec.ts`
  → **7 passed** (the new test asserts: three candidates with
  `resolved_config` `{queue:'ai-interactive', priority: 1.5 | 0 | null}` —
  jsonb cannot hold NaN, `JSON.stringify(NaN)` is `'null'` — all expire, runs
  resume on the default queue (`queue_name`/`priority` NULL), exactly three
  K1-free warns, and a second sweep adds nothing).
- `pnpm vitest run --project backend-integration backend/test/integration/ai-queue-routing.spec.ts`
  → **17 passed** (coordinator routing regression cover).
- `pnpm vitest run --project frontend frontend/test/chat-stream-ops.spec.tsx`
  → **16 passed**; `pnpm vitest run --project frontend frontend/test/thread-a11y.spec.tsx frontend/test/chat-transport.spec.tsx`
  → **51 passed**.
- `pnpm test:e2e backend/test/e2e/chat-tools.spec.ts --project chat-browser`
  → **5 passed (17.5s)** on a fresh isolated compose stack
  (`lexon-e2e-d364e54742e2337b`), including the expiry test that now asserts
  the `{swept: true}` socket return.

### Gate

- `pnpm exec eslint <changed files>` → exit 0.
- `pnpm --filter @lexon/backend typecheck` → exit 0;
  `pnpm --filter @lexon/frontend typecheck` → exit 0.
- `pnpm exec prettier --check <changed files>` → exit 0 (one spec file
  reformatted by `prettier --write` first).
