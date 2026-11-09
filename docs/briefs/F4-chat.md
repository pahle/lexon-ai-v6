# F4 — Chat

## Goal

Make Lexon's first real AI feature: a signed-in user asks a legal question,
watches the answer stream in, and can come back to the conversation later.
F4 connects the F3 AI Run Engine to the product: conversations and messages
in PostgreSQL, run endpoints through the outbox, the SSE stream hub with
`Last-Event-ID` replay (LEX-ARC-001 §4.1), a `ChatTransport` for
assistant-ui, the Deep thinking toggle, AI-generated titles, regenerate and
edit with branches, feedback, and a Chats page with full-text search,
rename, and permanent delete.

F4 also closes spike **S2** (end-to-end streaming, LEX-ARC-001 §10).

The visual target is the approved prototype in `docs/design/f4-prototype/`
(23 screens, light and dark). Its README maps every screen to the shadcn or
assistant-ui component it is built from.

## Users and permissions

| Actor | Can | Cannot |
|---|---|---|
| Signed-in member (any role) in the active organization | Create chats; send, edit, regenerate, stop; read, rename, search, delete **their own** chats; rate answers | Read, search, stream, rename, delete, or rate another user's chat, including as org owner/admin; reach chats of another organization |
| Org owner/admin | Same as a member | Read members' chats (chats are private to their creator in F4; sharing comes in F6) |
| Platform admin | Nothing extra | Read any customer chat (no break-glass in F4, LEX-ARC-001 §6.2) |
| AI Worker | Read the chat path it needs for a run, write the run's output, write the title | Read other chats; act outside the run's tenant and actor |

A chat belongs to one user in one organization. Switching the active
organization shows only that organization's chats. A removed member loses
access immediately (F1 offboarding already revokes sessions; chat rows stay
until F18 retention rules exist).

## Decisions already made (product owner, 2026-11-09)

1. **Prototype first:** the approved screens in `docs/design/f4-prototype/`
   are the visual target (LEX-DS-001 §5 visual-target rule).
2. **No model picker.** One allowlisted model (`openai/gpt-6-luna`). Every
   chat answer uses reasoning effort **`high`**. A **Deep thinking** toggle in
   the composer sends **`max`** for **that message only** (it resets after
   sending). OpenRouter exposes this as `reasoning.effort`; Luna supports
   `none`, `low`, `medium`, `high`, `xhigh`, `max` with default `medium`
   (verified on OpenRouter `/api/v1/models`, 2026-11-09). Reasoning tokens
   are billed as output tokens.
3. **Thinking display:** show "Thinking…" while the model reasons, then
   "Thought for N seconds". If the provider returns a readable reasoning
   summary, show it in a collapsible block (collapsed by default) and store
   it with the message. Encrypted or redacted reasoning is never shown or
   stored.
4. **Titles are AI-generated** after the first answer; until then the title
   is an excerpt of the first message. A user rename always wins.
5. **Thread features in F4:** regenerate the last answer; edit a user message
   with branches; full-text search of titles **and message text**; copy;
   thumbs up/down feedback (rating only, no comment form).
6. **Privacy:** chats are private to their creator.
7. **Delete is permanent** after a confirmation dialog.
8. **Navigation:** the sidebar's Home becomes **New chat**; add a **Chats**
   page and a **Recent** group (six most recent chats plus "View all chats").
   No attachment button until F7. Disclaimer under the composer:
   "Lexon can make mistakes. Verify important legal information."

## In scope

### Conversations and messages

1. Tables for chats, messages, and message feedback, all with `org_id` under
   FORCE RLS (`withTenant`) plus an owner predicate: every query also filters
   by the chat's `user_id` through the authorization predicate builder
   (LEX-ARC-001 §3.2). Content is K1 (never logged).
2. Messages form a **tree**: each message has a parent (null for the first).
   A chat shows one path from root to a leaf. The chat stores the leaf the
   user last viewed, so a reload shows the same branch.
3. A **user message** holds the text (limit: the engine's 16,384-byte prompt
   limit; the composer shows an error before sending if exceeded) and the
   Deep thinking choice. An **assistant message** links to exactly one run
   and shows that run's output, status, reasoning summary, and reasoning
   duration. One source of truth for the answer text: the design picks
   either the run output or a copy written atomically at completion, and
   proves no drift between them.
4. **Send** creates the user message (and the assistant placeholder), the
   run, and its outbox entry in **one transaction** (LEX-ARC-001 §4.1 step 1).
   F3's `RunService.start` opens its own transaction today; F4 adds a
   transaction-aware start on the engine's public contract instead of
   writing run rows from the chat module.
5. **Idempotent send:** the client generates the user message id; a repeated
   request with the same id returns the existing run and creates nothing.
6. **One active answer per chat.** While a run is `queued`, `running`, or
   `cancelling`, sending, editing, and regenerating in that chat are refused
   with a clear message; the composer shows Stop instead of Send.
7. **Regenerate** (last assistant message only) creates a sibling assistant
   message with a new run on the same parent. **Edit** of a user message
   creates a sibling user message plus a new run; earlier branches stay and
   are reachable through the branch picker ("2 / 2") on both user and
   assistant messages.
8. **Context:** a chat-history context provider (LEX-ARC-001 §4.7) gives the
   model the current path only (never sibling branches), newest messages
   first within the profile's context budget, dropping the oldest first;
   tested at the budget edge. Earlier assistant output is labeled as such.
9. **Run profile `chat`** (registered, not a branch in the engine):
   `ai-interactive` queue, `openai/gpt-6-luna`, no tools in F4 (F5 adds
   them), budgets sized for effort `high`; the Deep thinking path gets a
   larger output reservation. Budget numbers come from research and the
   real smoke, are recorded in the spec, and pass F3's conservative
   admission.

### Reasoning effort (engine contract change)

10. Extend the run-profile contract with the **reasoning efforts a profile
    allows, its default, and per-effort output limits**. A run request may
    name one allowed effort; anything else is refused before any network
    call. The model gateway sends OpenRouter `reasoning.effort` alongside
    the existing ZDR and provider preferences (assert on the outgoing
    request with the mock model). This is a general engine capability, not
    a chat-specific branch; record it as an F3 contract revision in the spec.
11. Add **reasoning stream events** to the versioned event schema in
    `shared/` (start, delta, end, following the AI SDK UI message stream
    protocol), checkpoint the reasoning summary like text, and record
    reasoning duration. If the provider returns only encrypted reasoning or
    none at all, emit only start/end (for "Thinking…" and the duration) and
    store no reasoning text.

### Streaming (S2)

12. `GET /api/runs/{runId}/events` (SSE) on the Backend API. It checks that
    the caller owns the run's chat in the active organization before
    anything else, then follows LEX-ARC-001 §4.1 step 4 exactly: one hub per
    process with one dedicated Valkey connection (`XREAD BLOCK` multi-key,
    short block), `XRANGE` replay for `Last-Event-ID` on a shared
    non-blocking connection, de-duplication by entry id across the replay →
    live switch, frame `id` = stream entry id, periodic heartbeat, and a
    per-user connection limit.
13. **Replay gaps:** F3 trims streams (`MAXLEN`) and expires them after
    finish. If `Last-Event-ID` is older than the first retained entry, or
    the stream is gone, the endpoint sends a `reset` and the client loads
    the message from PostgreSQL (final text or last checkpoint, with run
    status) (§4.1 step 6). Tested.
14. **Graceful shutdown:** on Backend API stop, the hub closes SSE
    connections in a controlled way; clients reconnect with `Last-Event-ID`
    to the new instance and lose no frames (S2 deploy criterion).
15. `POST /api/runs/{runId}/cancel` uses F3's cancel service (owner only).
    The partial answer stays and shows "Stopped".
16. Caddy is not in scope (F20), but the SSE response sets the headers that
    stop proxy buffering, and the Next.js app never proxies this path
    (LEX-ARC-001 §3.5).

### Client (`frontend/`)

17. A custom `ChatTransport` in `frontend/src/lib` (LEX-ARC-001 §4.1 client
    integration) that sends through the chat endpoints and connects or
    reconnects to the SSE endpoint, with assistant-ui on AI SDK 7. The design
    chooses between `useChat` with the custom transport and the external
    store runtime, based on what branching, persisted history, and resume
    need; record the choice and why.
18. Screens and states exactly as the prototype: new chat (welcome + composer),
    thinking, streaming, reasoning collapsed/expanded, complete with action
    bar, copied + feedback toast, inline edit, branch picker, stopped, run
    error with Try again (safe copy mapped from F3 error codes, never
    provider text), reconnecting, loading skeleton, and dark theme.
19. **Sidebar:** New chat (with a keyboard shortcut; pick one that does not
    clash with browser shortcuts and document it), Chats, Recent (six most
    recent by last activity), "View all chats", per-chat ⋯ menu with Rename
    (inline) and Delete. The title updates in place when the AI title
    arrives, without a page reload.
20. **Chats page:** list grouped by date (Today, Yesterday, Previous 7 days,
    older by month), cursor pagination, search field, empty state, no-results
    state with Clear search.
21. **URLs:** New chat at the current workspace home route; a chat at a
    stable route containing the chat id; the Chats page at its own route.
    A chat id from another user or organization renders the not-found page
    (no hint that it exists). Exact paths are a design decision.
22. **Feedback:** Good/Bad per assistant message, one rating per user per
    message, can be changed or cleared; toast "Thanks for your feedback."
    Ratings are stored for evaluation, never shown to others in F4.
23. **Copy** copies the answer as Markdown text.

### Titles

24. After the first answer completes, a separate run with a small
    **`chat-title` profile** (effort `low` or `none`, tight budget) generates a
    title of at most 60 characters in the language of the conversation, with
    no quotes or trailing punctuation. Its usage is recorded like any run.
    It never overwrites a user rename. If it fails, the excerpt stays and
    nothing is shown to the user.

### Search, rename, delete

25. **Search** covers chat titles and message text of the user's own chats in
    the active organization, using PostgreSQL FTS with the configured
    language (LEX-TS-001: `english` in v1) plus `pg_trgm` for partial and
    article-number matches (for example "1320"). Results show the title,
    date, and a snippet with the matched words highlighted. Highlighting must
    be injection-safe: return match offsets or escaped text, never server
    HTML. Ranked, paginated, and covered by query-plan checks with RLS on.
26. **Rename:** 1–120 characters, trimmed; marks the title as user-set.
27. **Delete** (after the confirmation dialog): stops an active run first,
    then removes the chat, its messages, feedback, runs and their
    steps, attempts, checkpoints, and operations, and the Valkey stream, in
    a way that is safe to retry. `usage_events` stay (they hold no content).
    Writes an audit event with ids only. A deleted chat's URL renders
    not-found. Backups and the deletion ledger are F18.

### Audit and usage

28. Audit events (ids and safe metadata only, no content): chat created,
    renamed, deleted; message sent, edited, regenerated; run cancelled;
    feedback set. Usage for chat and title runs is recorded by the engine
    (F3).

### Evals

29. Add `evals/` cases for the `chat` and `chat-title` profiles with the
    mock model in CI: multi-turn context follows the current branch only;
    context truncation drops the oldest messages; an injected instruction
    inside an earlier assistant message or user text does not change system
    behavior; the title respects its limits and ignores "set the title to…"
    instructions in the chat. The manual real-model workflow gains a chat
    case at effort `high` and one at `max` within the existing US$0.10 cap.

## Out of scope

| Item | Slice |
|---|---|
| Tools in chat, approval cards, approval expiry | F5 |
| Projects, sharing chats, project instructions | F6 |
| Attachments and documents | F7 |
| Citations | F8 |
| Memory | F9 |
| Workflows and quick actions in the composer | F10 |
| Model picker (when a second model is allowlisted) | later revision |
| Per-org quotas, rate limits on AI endpoints, cost display | F17 |
| Retention, deletion ledger, legal hold, chat export | F18 |
| Word add-in chat | F19 |
| Caddy SSE configuration in production | F20 |
| Full-screen mobile Settings pattern | later UI refinement |
| Indonesian FTS configuration | LEX-TS-001 "Next" item |

## User flows

1. **Ask:** New chat → type → Send (Deep thinking off) → URL changes to the
   chat → "Thinking…" → answer streams → action bar appears → sidebar shows
   the excerpt title, then the AI title.
2. **Deep thinking:** turn the toggle on → send → the run uses `max` → the
   toggle is off again for the next message.
3. **Refresh during streaming:** reload the page mid-answer → the chat loads
   from PostgreSQL → the client reconnects with `Last-Event-ID` → the answer
   continues with no lost or doubled text.
4. **Long answer, expired stream:** reopen after the stream expired → the
   final text loads from PostgreSQL.
5. **Stop:** Stop during streaming → partial text stays with "Stopped" →
   Send is available again.
6. **Failure:** the provider fails → safe error with Try again → Try again
   regenerates that answer as a new branch.
7. **Edit:** edit an earlier user message → Send → a new branch answers →
   the branch picker shows "2 / 2" → switching branches shows the old path →
   reload keeps the last viewed branch.
8. **Regenerate** the last answer → a sibling answer streams → "2 / 2" on the
   answer.
9. **Search:** Chats → type "wanprestasi" → matching chats with snippets →
   open one → the chat opens.
10. **Rename / delete** from the sidebar menu; delete asks for confirmation,
    removes the chat everywhere, and leaves the user on New chat if it was
    open.
11. **Worker crash mid-answer:** the stream receives `reset`, the partial
    in-progress text is discarded on the client, and the resumed run
    continues (F3 behavior, now visible end to end).
12. **Backend API restart:** clients reconnect and the answer continues.

## Data and contracts

- `shared/`: request/response schemas for chats, messages, feedback, search;
  the stream event schema version bump with reasoning events; safe error
  codes mapped to UI copy.
- Endpoints (names are a design decision; behavior is fixed): create chat
  with first message, send message (with parent and optional Deep thinking),
  regenerate, list chats (cursor, search), get chat (messages with branch
  structure and active leaf), set active leaf, rename, delete, set/clear
  feedback, run events (SSE), cancel run.
- Every endpoint validates with Zod (Standard Schema) from `shared/`, runs
  in `withTenant`, and is owner-checked.
- New tables and every new read path get negative tests: another user in the
  same org, another org, no tenant context (zero rows), the SSE endpoint, and
  search.

## Non-functional requirements

- **S2 load:** at least 500 concurrent SSE connections against one Backend
  API process with a fixed number of Valkey connections (measured, committed
  as evidence like F3's hop-latency JSON).
- **Latency:** time to first frame after send, measured locally with the
  mock model and recorded (no hard target yet; record the number).
- **Privacy:** no K1 (messages, titles, reasoning, search terms) in logs,
  traces, errors, or Sentry. Search terms are K1.
- **Accessibility:** axe passes on every new page and state; streaming text
  is announced politely without re-reading the whole answer; Stop, Deep
  thinking (`aria-pressed`), branch picker, and action bar have labels;
  focus returns to the composer after sending and after closing dialogs.
- **Visual acceptance:** screenshots of every prototype state in light and
  dark at desktop width, plus New chat, a thread, and the Chats page at
  mobile width; product-owner approval before merge; then locked as
  Playwright baselines (cross-cutting rule).
- **CI:** open the draft PR from the feature branch at the start so every
  task runs in CI (STATE follow-up from F3).

## Research first

- LEX-ARC-001 §3.2, §3.5, §4.1, §4.7, §5.3, §5.4, §6, §10 (S2); LEX-DS-001
  §5, §5.1, §6; LEX-TS-001 (AI SDK 7, `@ai-sdk/react` 4, assistant-ui 0.15,
  NestJS 12, Valkey 9.0.x, PostgreSQL 17 FTS + `pg_trgm`).
- F3 on `main`: `RunService`, `CancelService`, run registry and profiles,
  stream scripts (`MAXLEN`, TTL), `shared/src/ai-run.ts`, and
  `docs/references/F3-*.md` (capacity numbers and rulings).
- AI SDK 7: transport https://ai-sdk.dev/docs/ai-sdk-ui/transport, resume
  https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams, persistence
  https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence, stream
  protocol https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol.
- assistant-ui (index: https://www.assistant-ui.com/llms.txt): AI SDK runtime
  https://www.assistant-ui.com/docs/runtimes/ai-sdk, external store
  https://www.assistant-ui.com/docs/runtimes/custom/external-store,
  branching https://www.assistant-ui.com/docs/guides/branching, Reasoning
  https://www.assistant-ui.com/docs/ui/reasoning, ActionBar and BranchPicker
  primitives, feedback adapter, ThreadList primitives.
- OpenRouter reasoning: https://openrouter.ai/docs/use-cases/reasoning-tokens
  and the model entry for `openai/gpt-6-luna` on `/api/v1/models`
  (`reasoning.supported_efforts`, `default_effort`). Check what Luna returns
  as reasoning (summary, encrypted, or nothing) with the real smoke.
- `@openrouter/ai-sdk-provider` 3.1.0: how to pass `reasoning` in provider
  options and how reasoning parts reach the AI SDK stream.
- NestJS SSE https://docs.nestjs.com/techniques/server-sent-events and the
  HTML SSE spec https://html.spec.whatwg.org/multipage/server-sent-events.html
  (`Last-Event-ID`, `retry`); Valkey `XREAD` https://valkey.io/commands/xread/.
- PostgreSQL 17 text search controls (`ts_headline`, ranking)
  https://www.postgresql.org/docs/17/textsearch-controls.html and `pg_trgm`.

## Skills to use

`.agents/skills/`: `ai-sdk`, `assistant-ui`, `runtime`, `shadcn`, `valkey`,
`vitest`, `playwright-cli`, `karpathy-guidelines`.
Propose any new vendor skill to the product owner first.

## Acceptance criteria

- [ ] Screens match `docs/design/f4-prototype/` in layout, content, and
      states (light, dark, mobile set); product owner approved; baselines
      locked.
- [ ] Send writes message + run + outbox in one transaction; repeated send
      with the same message id creates nothing new.
- [ ] One active answer per chat enforced on the server.
- [ ] Regenerate and edit create branches; context uses the current path
      only; active leaf persists across reload.
- [ ] Effort `high` by default and `max` with Deep thinking, asserted on the
      outgoing request; disallowed efforts refused before network.
- [ ] Reasoning start/delta/end events validate against `shared/`; summary
      stored only when readable; duration shown.
- [ ] SSE: owner check first; replay → live without loss or duplication;
      reset + PostgreSQL fallback for trimmed or expired streams; heartbeat;
      per-user connection limit; graceful close on shutdown with lossless
      reconnect.
- [ ] S2 evidence: ≥ 500 concurrent SSE connections with fixed Valkey
      connections; time to first frame recorded.
- [ ] Cancel keeps the partial answer; failure shows safe copy with Try
      again.
- [ ] AI title generated once, ≤ 60 characters, never overwrites a rename;
      failure leaves the excerpt.
- [ ] Search over titles and message text with injection-safe highlights;
      owner and tenant scoped; query plans checked with RLS on.
- [ ] Rename and permanent delete (retry-safe, stream removed, audit
      event); deleted chat URL is not-found.
- [ ] Feedback stored per user per message; changeable; toast shown.
- [ ] Cross-user and cross-org negative tests for every endpoint, the SSE
      endpoint, search, and the worker's chat reads.
- [ ] No K1 in logs, traces, or errors (tests).
- [ ] Mock evals for `chat` and `chat-title` pass in CI; real-model cases
      added to the manual workflow within the existing cap.
- [ ] axe passes on all new pages and states.

## References

- LEX-ARC-001 §3.2, §3.5, §4.1, §4.7, §6.1, §6.2, §10 (S2); LEX-DS-001 §5,
  §5.1, §6; LEX-TS-001.
- `docs/design/f4-prototype/` (approved 2026-11-09).
- F3 brief and `docs/references/F3-final-review.md` (engine contracts,
  capacity, rulings).
- STATE follow-ups carried here: SSE hub over F3 streams; ChatTransport
  replaces F2's inert runtime; open the draft PR early for CI.

## Open questions

1. **Reasoning content from Luna through OpenRouter's Azure ZDR route:**
   readable summary, encrypted, or none. The design handles all three; the
   real smoke records which one we get.
2. **Budgets for `high` and `max`:** set from research and the smoke, then
   recalibrated before F8 with the estimator follow-up.
