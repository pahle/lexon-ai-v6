# F4 runtime proof

Status: all five Task 10 runtime criteria passed. This hard gate is complete
before product chat screens. The proof uses the pinned public AI SDK and
assistant-ui runtime APIs with the real API, worker, PostgreSQL, Valkey, and
Caddy path; a test-only scripted model gateway supplies deterministic answers.

## Runtime and recovery contract

- Production uses public `useChat` and `useAISDKRuntime`. The client seeds the
  complete parent-linked PostgreSQL chat tree and uses the server-selected
  parent/leaf IDs for sends, edits, and regeneration. Branch changes persist
  their selected leaf. No message parent is inferred from the SDK's linear
  display list.
- Installed versions: `ai@7.0.159`, `@ai-sdk/react@4.0.163`,
  `@assistant-ui/react@0.15.33`, and `@assistant-ui/ai-sdk@0.0.16`. Official
  references checked on 2026-11-11: [AI SDK UI transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport),
  [AI SDK UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol),
  [assistant-ui AI SDK runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/overview),
  and [assistant-ui branching](https://www.assistant-ui.com/docs/guides/branching).
- `joinStrategy: "none"` preserves one visible assistant per persisted
  assistant node. The live branch/edit/send browser proof checks every visible
  message ID and role against the PostgreSQL selected ancestor path.
- Full-reload recovery sends the typed
  `X-Lexon-Stream-Recovery: snapshot` header and forwards the actual stored
  `Last-Event-ID`. A fully validated `snapshot-end` proves and stores a cursor
  only when its SSE ID matches the persisted generation and retained Valkey
  event. Replacement snapshots emit the public AI SDK `reset-step` chunk;
  malformed or incomplete frames cannot advance the cursor.
- The transport owns cancellation for pending fetches and active SSE bodies.
  A terminal `finish` settles the public runtime and cancels a still-open raw
  response body, while cleanup releases listeners and request tracking once.
- The product composer must use `ChatComposerCancel` for its visible Stop
  control. It prevents the primitive's disconnect-only cancellation, requests
  server cancellation first, and then stops the assistant-ui runtime. A safe
  alert reports cancellation failure; the control is not replaced by a
  separate test-only server-stop action.

## Verification

- `pnpm test:e2e -- --project chat-runtime-proof` — **3 passed** on
  `lexon-e2e-9acb7c490491fed9` (2026-11-11). The test stack used Caddy and the
  actual API/worker path with only the test-only scripted gateway.
- Scenario 1 passed browser send, server-created regeneration sibling,
  branch-switch persistence, full reload, nonroot edit, root edit, subsequent
  send, and exact visible selected-path comparison. Each follow-up mutation
  waited for the public runtime to become idle; fixture edit/regenerate actions
  are disabled while an answer is streaming. This avoids racing a browser
  mutation against the prior stream's terminal frame. The earlier Caddy
  mismatch was observed during such overlapping fixture actions; it did not
  establish an adapter incompatibility or a production server-tree defect.
  The test-only worker independently read the final PostgreSQL tree using the
  `lexon_app` role and transaction-local tenant context. The proof compared the
  viewed leaf, all message IDs/parents/roles/run statuses, and per-message text
  equality booleans with the authorized API tree; it returned no message text.
- Scenario 2 passed midstream reload using the actual cursor received from
  Valkey, then XTRIMmed that cursor and verified snapshot fallback, exact final
  text, and measured 17 ms reasoning. The same scenario verifies the no-signal
  answer has no duration label before and after reload. Expired-stream recovery
  was not separately exercised.
- Scenario 3 passed stop/cancel, active-answer conflict, a nonretryable safe
  provider error, and a separate explicit Try again run.
- `pnpm exec vitest run --project frontend frontend/test/chat-transport.spec.tsx frontend/test/chat-runtime.spec.tsx` —
  **31 passed**. Includes a held open-body stream proving running controls are
  disabled and terminal finish settles the runtime, closes the adapter stream,
  cancels the underlying response reader, and re-enables controls.
- `pnpm exec vitest run --project backend-integration backend/test/integration/chat-sse.spec.ts backend/test/integration/chat-sse-replay.spec.ts` —
  **31 passed** under normal concurrency.
- `pnpm --filter frontend typecheck`, `pnpm --filter backend typecheck`, and
  `pnpm lint` all passed. Lint includes **99 boundary/presentation checks**.
- Scoped `pnpm exec prettier --check` passed for all changed runtime, fixture,
  test, worker, and public proof files. `node --check` passed for both test
  worker scripts.
- The production frontend image excludes `/e2e/chat-runtime`; that route is
  copied into a separate test image only. The default production Docker target
  retains its existing document-worker command.

## Five owner criteria

1. Persisted tree, viewed branch, reload: **passed**. Live branch switching
   changes the canonical selected leaf, persists it, and reload restores that
   branch while preserving the full server tree.
2. Edit/regenerate parent and server-created siblings: **passed**. The proof
   exercises sibling regeneration, nonroot and root edits, then a new send;
   request IDs and the final rendered path match server parent relationships.
3. Midstream reload with actual `Last-Event-ID`: **passed**. The browser
   forwards its actual received Valkey cursor and renders the authoritative
   replacement prefix plus suffix without duplication.
4. Trim recovery and live-equivalent reasoning: **passed for trim**. XTRIM
   forces snapshot fallback; exact answer text and measured reasoning survive
   live delivery and reload. Stream expiry was not separately tested.
5. Stop, provider error/retry, active-answer conflict: **passed**. The actual
   HTTP/worker flow covers cancellation, conflict response, safe nonretryable
   error, and explicit user retry.
