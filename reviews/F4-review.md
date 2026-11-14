# F4 holistic review (head d4ae874, 2026-11-14)

Verdict: merge. Backend, data protection and tests are strong; risk is concentrated in the frontend chat client.

## Strong
- Privacy: FORCE RLS on chats, chat_runs, chat_messages, usage_events; chat and message policies check org AND owner_user_id AND deleted_at IS NULL. SECURITY DEFINER functions re-check context org/user and pin search_path; EXECUTE revoked from PUBLIC.
- Permanent delete: soft-fence (ops.ai_mark_chat_deleted) then physical DELETE in 0033_chat_cleanup.sql; usage_events survive.
- No logging, console or Sentry calls in the chat module (K1 safe by absence); no `as any`, ts-ignore, eslint-disable, TODO, or skipped tests in the diff.
- Test fixtures under src/**/testing are excluded from the production build (tsconfig.build.json).
- Coverage of the brief's hard cases: rename-vs-title races (3 tests), fence, delete races, SSE limits/replay, privacy/observability, search timeout. Defaults: 6 SSE per user, title <= 60 chars.

## Risks / follow-ups
1. Frontend chat client (Important, before F5): ~1,900 lines across chat-runtime.tsx, chat-transport.ts, chat-stream.ts; three state sources reconciled (AI SDK useChat messages, assistant-ui repository import/export, server tree). 13 of 21 commits touching these files are fixes; F4's last two regressions came from here. Uses unstable_onBranchChange and assistant-ui 0.3.32 import-path internals.
2. 1 s polling (Important, before F5): while a run is active, chat-runtime.tsx refetches the full chat tree (GET /chats/:id) every second in addition to SSE. Not exercised by the S2 load test (no browsers). 500 active answers => ~500 full-tree reads/s. Replace with SSE terminal event + one canonical refresh (bounded retry).
3. Org-wide advisory lock 'lexon.ai_step_claim:<org>' serializes step claims and chat deletes per organization; fine for small orgs, watch in F20 load qualification.
4. Known: indexed search under RLS at document scale (F8/S3); S2 on production-like hardware (F20); two flaky tests (F4.1).

Decision proposal: items 1-2 become a "chat client hardening" prerequisite task at the start of the F5 brief (F5 adds tool streaming to the same client).
