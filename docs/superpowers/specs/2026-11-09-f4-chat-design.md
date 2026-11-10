# F4 — Chat design

Date: 2026-11-09. Status: product-owner approved with corrections on 2026-11-09.
Branch: `f4-chat`; never commit or push to `main`.

## Intent and scope

Give a signed-in legal professional a private, durable conversation: ask a
question, watch an answer, stop it, revisit it, explore alternative branches,
and find earlier work. F4 connects the headless F3 engine to real product
endpoints and the existing workspace shell. The approved visual target is
[the F4 prototype](../../design/f4-prototype/README.md), including all 23
screens inspected during design, supplemented by mobile and dark captures.

The controlling documents are LEX-TS-001 v1.12, LEX-ARC-001 v1.7, and LEX-DS-001 v2.2 (the document
control table and change history on main identify v2.2; its YAML frontmatter
still says v2.1). The F4 brief and the owner's clarifications below govern
slice details. Record every new exact dependency pin in stack v1.12 before
installation; no unlisted dependency is authorized by this design.

Goals: durable private chats and message trees; effectively-once send and
branch creation; authenticated SSE replay and recovery; explicit reasoning
effort and summary-only display; searchable history; feedback; AI titles;
retry-safe permanent deletion; durable content-free usage; S2 evidence.

Non-goals: tools and approval UI/expiry (F5), projects/sharing (F6), attachments
(F7), citations (F8), memory (F9), workflows (F10), customer quotas/cost UI and
remote unknown-cost reconciliation (F17), retention/backup deletion ledger and
legal hold (F18), add-in (F19), production TLS/firewall/hardening (F20).
There is no model picker or client model invocation.

Anti-goals: client-authoritative history, hidden provider retries, lost usage
on deletion, restored deleted content, leaked raw reasoning or search terms,
per-client Valkey connections, and screenshots accepted only because tests pass.

## Approaches and owner decision

1. **Selected, subject to early proof:** AI SDK `useChat`, a Lexon
   `ChatTransport`, and assistant-ui `useAISDKRuntime`. PostgreSQL owns the
   full parent-linked message tree and saved viewed leaf. SDK parsing and
   assistant-ui primitives reduce the amount of client message machinery.
   The adapter's tree/history interfaces and reset behavior need an actual
   integration proof rather than an assumption based on available types.
2. **Pre-authorized fallback:** `useExternalStoreRuntime`, with Lexon owning
   the tree projection and stream reducer. More explicit state ownership,
   but more application message-processing code. Choose this if approach 1
   needs internal patches or repeated thread reconstruction to satisfy the
   proof. The backend does not depend on the chosen runtime.

The owner selected approach 1 and explicitly authorized switching to approach 2
if the proof fails. No other client/runtime framework or hosted persistence is
introduced. A custom Node proxy was proposed and rejected; use Caddy below.

## Early client proof: before screen implementation

After the minimal real backend contracts and Caddy routing exist, use a
small test-only client fixture with the mock model and actual authenticated
HTTP/SSE endpoints. It is not a second product UI or a substitute for the
approved screenshots. Prove all five conditions:

1. Load the full server tree, including parent IDs, and render its saved
   viewed branch. A real branch-picker switch persists the selected leaf;
   reloading restores it.
2. Edit and regenerate transmit the correct parent and create siblings on
   the server. Local `useChat` path changes are presentation only, never
   instructions to truncate, replace, or rewrite server history.
3. Reload during streaming reconnects with `Last-Event-ID` with no lost or
   duplicate text. A reset discards the interrupted attempt's partial text.
4. Trimmed/expired streams fall back to final text or the last checkpoint
   from PostgreSQL, matching live completion and reasoning labels.
5. Stop, safe error/Try again, and one-active-answer-per-chat work as required.

Use only the pinned adapter's public tree seed/history, branch-change,
message, and transport interfaces. A normal initial tree load or documented
recovery resynchronization is allowed. Rebuilding the thread on every branch
switch, patching internals, or maintaining a competing hidden history store
fails the proof. Stop approach 1 at that point, record why, and implement the
pre-authorized external-store fallback. Run the same five proofs against it.
Record source revision, commands/results, limitations, and the final choice in
Research notes and F4 acceptance evidence. Current result: **not run**.

## Ownership, tenancy, and authorization

A chat belongs to one organization and one creating user. Every tenanted table
has `org_id`, ENABLE/FORCE RLS, and fail-closed tenant policies. Every chat query
also uses the central authorization predicate builder for owner and nondeleted
state. No owner/admin/platform role bypass exists. Guards derive the actor
from the server-side session, verify membership and organization 2FA, and pass
explicit context to `withTenant`. Body/query/header tenant overrides remain
forbidden. Worker history reads enforce the same owner and deletion predicate.

No-context tests cover fresh and reused connections. Same-org other-user and
cross-org negatives cover every endpoint, search/snippets, SSE, worker context,
feedback, and indirect message/run identifiers. Unauthorized and marked chats
return the same not-found behavior as nonexistent IDs.

An SSE connection is not a permanent authorization grant. Revalidate its
session, active organization, membership, owner, and deletion state in short
transactions during delivery, with prompt invalidation and bounded polling
fallback. On revoked access or organization change, drop buffered frames and
close. No transaction or authorization row lock is held over model, Valkey, or
socket I/O. Existing identity refresh, sign-out, and tenant-cache clearing apply
to chat queries and runtime/transport teardown as well.

## Data model and canonical content

| Record                  | Principal fields and invariants                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.chats`             | UUID, org/user IDs, title, title source (`excerpt`, `ai`, `user`), title version, viewed leaf, activity timestamps, deletion marker/time           |
| `app.chat_messages`     | UUID, org/chat IDs, parent UUID nullable, role, user text and effort choice OR one unique run ID for an assistant placeholder, creation order/time |
| `app.message_feedback`  | Org/chat/message/user IDs, Good/Bad rating, timestamps; unique per message/user; only its owner may set/change/clear                               |
| Run-to-chat association | Explicit org-scoped association for answer and title runs, with immutable resource IDs; available to generic engine resource checks and cleanup    |
| Deletion work           | Durable ID-only cleanup identity and phase/progress sufficient to retry after content rows are gone; no recoverable user content                   |
| `app.usage_events`      | Usage-owned attempt ledger described below; no FK into deletable content/execution tables                                                          |

Parent and viewed-leaf references must belong to the same chat and tenant.
Parents precede children, roles alternate on valid answer paths, and no cycles
or cross-chat edges are possible. Regeneration creates an assistant sibling;
editing creates a user sibling and its assistant child. Root edits have a null
parent. Stable sibling ordering uses creation order plus ID as a tie-breaker.

**Canonical assistant text is the run output, not a copy in the message.**
Message DTOs resolve committed run output plus the current durable checkpoint
for an in-progress run. A failed/stopped run exposes only its retained partial
answer. Reasoning summary and measured timing follow the same run/checkpoint
projection. The client never writes assistant content. Search uses the same
canonical projection, with appropriate indexes on user text and run output;
no separately maintained answer body may drift from it.

The full tree DTO includes parent IDs and the saved viewed leaf. Use a bounded,
paginated tree-load protocol if needed; it must load the entire required tree
before declaring the runtime history complete. The API validates any requested
leaf against this chat. Builder choice: last committed explicit selection wins
across tabs; an in-flight generation's input path is immutable and is not changed
by a later view selection. Do not turn loading/synchronizing history into an
implicit branch write.

## Mutations and engine contract revisions

Chat services and controllers stay in `modules/chat`; infrastructure remains
free of domain imports. Repositories provide transactional facts and writes;
policy and orchestration stay in modules. Usage ledger policy is in Usage.
Identity/resource decisions stay behind the authorization policy contract.

General engine changes, recorded as revisions of F3's public contract:

- A transaction-aware run start accepting the caller's `TenantSession`, plus
  the existing convenience `start` wrapper. Validation, authorization, capacity,
  run/step insertion, audit, and outbox stay in the engine. Chat never inserts
  engine rows independently. Capacity boot configuration is performed before
  request transactions, not through nested initialization during send.
- Profile-allowed reasoning efforts, default effort, and per-effort output and
  run token limits. Resolve and snapshot them at start. Reject unknown/disallowed
  effort before any attempt or network request. The gateway sends the resolved
  effort with all existing provider/ZDR preferences.
- Generic resource identity/liveness fencing and transaction-safe lifecycle
  integration for context, checkpoint, completion, and feature follow-up work.
  No `if profile === chat` branches in the engine. Database enforcement of chat
  deletion is detailed below.
- Reasoning signals, summary-only checkpoints, measured timing, and a new
  version of the shared run event contract. Do not change old applied migrations.
- Durable Usage-owned events, independent of removable execution records.
- Cleanup-accessible existing terminal/capacity and owner-fenced permit release
  paths. Add reusable release-by-reference where needed, not a second counter.

**Send:** lock the live chat; verify owner, parent, and inactive-answer state;
insert client-ID user message, assistant placeholder, run, initial step, audit,
and outbox in one tenant transaction. First send creates the chat in that same
transaction. Roll back all rows if admission or any write fails. Unique message
IDs make exact repeats return the original message/run; conflicting reuse is
refused safely. Check chat liveness before returning an idempotent result, so
retrying after deletion cannot revive or reveal it. A retry for an already
accepted message is resolved before the active-run conflict for a new message.
Use the same idempotency discipline for edit/regenerate request identities.

**One active answer:** queued/running/cancelling answers block send/edit/
regenerate under the chat lock, with a database invariant protecting concurrent
requests. No tools are registered for these profiles in F4. An unexpected
awaiting-approval answer must not permit a second answer. Separate title runs do
not count as answers, though they use ordinary F3 global/org capacity.

**Context:** bind the run to its exact message parent/path at creation. Collect
only ancestors on that path under owner/tenant/deletion checks. Choose the newest
eligible messages that fit the context budget, dropping oldest first; render
selected messages in conversational order with explicit roles and delimiters.
Previous assistant text is untrusted data, never instructions. Current user text
is included once. Earlier completed answers and retained stopped, failed, or
output-limited answers are eligible; label partial answers with their terminal
status. Exclude in-flight snapshots, provider error details, and assistant
answers with no text. Retain the associated user turn when eligible under the
budget. Only the visible answer text of earlier turns is supplied: no reasoning
summary or other reasoning is ever included. No sibling branches, search queries, or
client-supplied transcript is injected. The existing 16,384-byte prompt limit
applies to each user message, not the entire conversation. Context budgets and
reservation accounting include serialization, system instructions, and overhead.

### Versioned chat instructions

The owner approved these behavior requirements. Instructions are written in
English, live in code, and have an explicit version identifier recorded on every
run. The run profile resolves a trusted instruction ID/version through the
registry, snapshots the resolved version, and passes those instructions through
the general engine contract. No chat-specific instruction branch is added to
the executor; user-controlled context cannot replace the trusted instructions.

- Answer in the language of the latest user message unless the user requests
  another language. The English engineering/UI language scope does not require
  English model answers to Indonesian questions.
- Focus on Indonesian legal work. When confident, give the specific legal basis:
  regulation name, number, year, and article. Identify uncertainty, including
  when a provision may have been amended or revoked, and say it should be
  verified against an official source. Never present uncertain law as settled.
- Ask for missing material facts rather than assuming them.
- Never invent sources, case numbers, or quotations. Never claim to have read
  documents, searched, or researched: F4 has no attachments, retrieval, or web
  tools.
- Do not append a generic "this is not legal advice" disclaimer to every answer;
  the audience is legal professionals and the composer already has a disclaimer.

Chat evals explicitly cover the language, no-invented-sources, and
no-claimed-research rules, plus instruction version capture and resistance to
earlier-message instructions. Mock tests establish prompt assembly, expected
fixture behavior, and contract enforcement; they do not establish real-model
legal accuracy. Real-model observations remain separately labeled and gated.

## Proposed unverified profiles and smoke gate

These are builder proposals for conservative admission, **not measured
recommendations or a billing ceiling**. All output bounds include reasoning
output tokens. Keep F3's estimator unchanged until measurements justify a
reviewed calibration, with its version stored in accounting.

| Profile / effort                |       Prior-history byte budget | Max output tokens per attempt | Run token budget | Attempts per step |
| ------------------------------- | ------------------------------: | ----------------------------: | ---------------: | ----------------: |
| `chat` / `high` (default)       |                         131,072 |                        16,384 |          360,448 |                 2 |
| `chat` / `max`                  |                         131,072 |                        32,768 |          393,216 |                 2 |
| `chat-title` / `none` (default) | 4,096 bounded first-turn source |                           512 |           16,384 |                 2 |

`chat` uses `ai-interactive`, priority 1, one generation iteration, no tools.
`chat-title` uses `ai-batch`, priority 5, one iteration, no tools. Output-limit
exhaustion must retain partial text and expose a safe incomplete-answer result;
never silently add an unbudgeted continuation. Resolved effort is immutable for
the run and recorded in usage. An edit uses its explicitly selected effort;
a regeneration/Try again uses the original user turn's choice. Deep thinking
resets after an accepted send; a failed submission preserves the draft choice.

One token per serialized UTF-8 byte plus 64 per message, 256 per tool schema,
and 1,024 fixed overhead is the existing estimator. Reserve at most **163,840
estimated input tokens per attempt**, including instructions and framing. The
history collector retains up to 131,072 UTF-8 bytes, then drops oldest eligible
messages further if the actual full serialized input would exceed that estimated
input cap. This matters for JSON escaping; raw byte counts alone are insufficient.
Never truncate the current user message to make it fit. Bound the versioned
trusted instructions to 8,192 serialized bytes and keep framing bounded. If the
mandatory current turn and trusted framing alone cannot fit, refuse safely.

The run budgets are computed as `2 * (163840 + maxOutputTokens)`: **360,448**
for high and **393,216** for max. Thus two full reservations fit even if the
first attempt becomes unknown and retains its reservation. This is a general
profile input-estimate bound, enforced before each model call, not a tokenizer
change. A design-time calculation using the actual F3 estimator, 131,072 bytes
of ASCII history, a 16,384-byte current message, 8,192 instruction bytes, and
F3-style nonce fences produced **157,247 estimated input tokens**, leaving 6,593
under the cap. Implementation tests must cover full ordinary history as well as
escape-heavy input and compute the exact assembled prompt, not rely on that
illustrative fixture. All bounds remain **unverified by real smoke**. Reported
usage above reservation still stops further calls with the safe budget error.

The owner confirmed account setup on **2026-11-09**: dated ZDR-only attestation,
no Safety Retention, first-party OpenAI endpoints disabled with Azure enabled,
training/discount options off, prompt/response observability off, and no trace
destinations. The replacement development key is local and uncommitted; the
separate CI key has a USD 0.10 limit and the required repository attestations.
No key or local environment value was read for this design.

Plan an explicit **owner-run local smoke gate** after effort/reasoning contracts
exist. The owner loads their local environment. The task runs synthetic inputs
at `high` and `max`, recording sample counts by case (summary-only, raw-only,
encrypted-only, none/no signal, mixed, and unclassifiable), measured durations
only where present, estimated/reported input ratios, reported reasoning/output
tokens, safe finish reasons, observed provider, declared region, and costs.
Record absent usage as unavailable; do not invent missing measurements or infer
physical region from `azure/us`. No raw response, summary text, user text, or
credentials go into evidence.

Proposed smoke allocation: up to 2 samples per effort, 4 requests total,
USD 0.10 cumulative maximum, zero hidden retries; a request starts only when
its conservative price ceiling fits the remaining allocation. Stop early if it
does not. Samples are observations, not estimated population frequencies. The
owner may run more only under a separately explicit allocation. Replace proposed
budgets with measured, reviewed values after this gate; record any incomplete
calibration honestly. The manual real-eval workflow remains manual-only within
its existing USD 0.10 / 16-request invocation bounds, with high/max cases.
Mock coverage of all cases is mandatory and independent of smoke availability;
other implementation tasks do not wait for paid/model access. Final acceptance
must distinguish pending smoke/calibration from completed mock evidence.

## Reasoning privacy and timing

Only an explicit OpenRouter `reasoning.summary` is eligible for display,
streaming, checkpointing, or storage. Discard `reasoning.text`, encrypted,
redacted, unknown, and ambiguous content. Never log them or attach them to
telemetry/errors. Mixed responses retain only individually classified summaries;
no inference from content or provider/model name is allowed.

Pinned provider 3.1.0 merges summary and raw reasoning into the same untyped
SDK reasoning deltas, and does not emit a reasoning-start for encrypted-only
content. Its later metadata includes accumulated typed details, which is too
late for first-signal timing and unsafe as a general client metadata payload.
Therefore classification/timing happens **inside infrastructure/ai at the raw
provider stream boundary**, before that merge, using the provider's supported
custom fetch seam and the existing gateway boundary. Do not patch dependencies,
create a second model client, or expose provider payloads outside infrastructure.

The raw SSE observer records the earliest typed reasoning signal timestamp,
including encrypted-only details, and the first answer-text timestamp. It strips
forbidden reasoning before it can enter SDK content/metadata and emits only
allowlisted summary events plus content-free timing signals into the engine.
Untyped SDK reasoning deltas are never treated as summaries. If a type cannot
be reliably established, drop the content. Bound parser frames and summary
buffers; malformed/oversized input fails safely without echoing the payload.
Summary size bounds must be explicit in implementation and consistent with the
stream memory/event bounds; excess summary text can be discarded without losing
timing or the answer. Do not buffer an entire raw response for classification.

Reasoning start/delta/end events follow the AI SDK UI-message protocol within
the versioned Lexon envelope. A signal with no summary emits start/end without
text. Duration is first typed signal to first answer text, using a monotonic
clock. Persist nullable measured duration with the same durable answer/checkpoint
state that the client reads. With no signal, show Thinking while waiting, remove
it at the first answer, store no duration, and never add a Thought-for label on
reload. With a measured duration but no summary, show Thought-for without an
expandable body. A readable summary is collapsed by default. Do not derive
timing from queue/admission/request-start timestamps or assistant-ui auto timing.

Retry/reset discards the interrupted attempt's visible text/summary/timing and
starts a fresh attempt view. Successful committed prior steps are not duplicated.
If a signaled attempt stops before answer text, timing remains unmeasured; do
not invent the specified endpoint. The stopped/error indicator replaces a
pending Thinking indicator. These defaults are builder calls.

Tests include summary-only, raw-only, encrypted-only, none/no-signal, mixed
summary/raw, unknown type, redaction, fragmented frames, and forbidden metadata
at the actual mocked HTTP/provider boundary as well as the engine/client layers.
Assert forbidden canaries absent from stream, checkpoints, database, logs,
traces, and safe errors. Reload equivalence is asserted for every timing case.

## SSE hub, recovery, and topology

`GET /api/runs/:runId/events` authorizes the owning live chat before setting SSE
headers, allocating a subscription, or reading Valkey. Backend API owns one hub
with one dedicated blocking connection and one shared nonblocking reader,
independent of subscriber count. Use multi-key `XREAD BLOCK` with a proposed
1-second block, bounded COUNT and subscriber buffers; `XRANGE` supplies replay.
Never use one blocking or Pub/Sub connection per browser connection.

Capture a replay/live boundary without a race: provisionally buffer live frames
only after authorization, establish a high-water ID, replay through it, drain
newer buffered frames, and deduplicate by entry ID. First entry / last entry
checks and stream generation identify trimming, expiry, replacement, malformed
cursors, and a cursor ahead of the actual stream. Stream frame `id` is the
Valkey entry ID. Lexon reset controls are distinguishable from stream frames;
do not fabricate a Valkey entry ID for a server-generated fallback control.

Checkpoint DTOs pair text/summary/timing and part identity with a replay watermark
and attempt/generation so the client never mixes a snapshot with an incompatible
suffix. The implementation proof must establish this pairing with real stream
entries; a timestamp approximation does not pass. For a retained suffix,
resume from the snapshot watermark. For a gap, expired stream, or attempt reset,
discard the incompatible in-progress view, fetch canonical PostgreSQL state,
then resume from its safe watermark or wait for a new durable checkpoint.
A terminal snapshot ends recovery even if the stream is gone. No concatenation
of an arbitrary checkpoint and a complete replay is allowed.

Proposed operational defaults, boot validated: heartbeat 15 seconds, 6 SSE
connections per user, 64 KiB subscriber queue, and 5-second socket-drain deadline.
At the default per-user limit of 6, atomically evict that user's oldest
connection and admit the new one instead of refusing it. Ordering and eviction
are shared across API processes; another user's connection is never displaced.
Close the evicted socket, discard its queued frames, and invalidate its lease
so a stale process cannot renew it. Test the seventh connection, reconnects,
concurrent admissions, and cross-process eviction, including stale Caddy
upstream connections. A slow client is disconnected and reconnects/reloads; it never grows an unbounded
buffer or stalls other clients. Enforce the user connection limit across API
processes with expiring operational leases, not only per process. Keep Valkey
connection count fixed; avoid high-cardinality metric labels. Close hooks release
subscriptions and connection-limit leases. Headers include event-stream,
no-cache/no-transform, and `X-Accel-Buffering: no`; no response compression or
content logging. Heartbeats carry no content and do not advance replay IDs.

On shutdown stop new subscriptions, close existing sockets in a controlled way,
and release readers/resources within the container grace period. Test restart
through Caddy while generation continues in the separate worker, using the last
received entry ID. Dedicated Stop calls the cancel endpoint; navigation, tab
close, and transport abort only disconnect the subscriber and never cancel a run.

### Caddy scope and proposed technology revision

Owner decision brings development/E2E Caddy forward from F20 and explicitly
approves **LEX-TS-001 v1.12**, adding Caddy **2.11.9** to the version baseline
and naming its development/E2E role. The same revision must list every new F4
dependency with its exact version, including the Markdown renderer, its notable
transitive packages, and the k6 image or binary pin, plus a change-history row.
Research and record those pins before installing anything new. This approval
permits the source-spec revision; it does not permit an unlisted dependency.
Proposed official image, verified 2026-11-09:

`caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee`

Pin it in the same `config/container-images.env` source used by Compose/test
loaders. Caddy joins `edge` only and publishes plain HTTP on host loopback.
Use an unprivileged container listener (proposed 8080) mapped to the local
public port (normally 3000); it must listen on its container interface, not
container loopback. No TLS, ACME, public admin API, or credential-bearing access
logs. Existing frontend/API host ports may remain loopback diagnostic endpoints;
all browser tests and normal development use the Caddy URL as public/auth origin.

Keep the minimal file at `infra/Caddyfile`; F20 extends that file for TLS,
production hardening, host firewall, and the add-in domain. Route `/api/*` to
`api:3001` without stripping `/api`; route everything else to `frontend:3000`.
Use `flush_interval -1`, no response_buffers, and HTTP transport `read_timeout
60s`, comfortably exceeding the 15-second heartbeat interval. This is the wait
for the next upstream read, not a 60-second total conversation limit. Do not
set a total downstream write deadline that kills healthy SSE. Preserve
`Last-Event-ID`, cookies, and origin semantics. Remove Next.js API rewrites;
server rendering still calls BACKEND_INTERNAL_URL with forwarded cookies.

Tests must validate/adapt the actual pinned Caddyfile, prove frames arrive before
a deliberately blocked response finishes, prove Last-Event-ID reaches the real
backend on reconnect, and demonstrate the SSE route works while Next.js cannot
serve API traffic. Use bounded test barriers, not a timer-only assertion that a
stream was probably incremental. Also test subscriber cleanup on disconnect:
Caddy documents that low-latency mode can affect upstream cancellation, so
Backend API must not assume a browser disconnect always immediately aborts its
upstream response. Use bounded lease/revalidation cleanup and demonstrate no
permanent connection/subscription leak. No custom Node proxy is added.

## HTTP contracts and client behavior

All contracts are strict Zod schemas in `shared/`; IDs use UUIDs where generated
by Lexon. Opaque SDK part IDs and cursors are bounded strings. All mutations use
existing cookie/origin/CSRF policy; frontend never uses Bearer tokens.

| Endpoint                                                 | Behavior                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/chats`                                        | First message and chat atomically; client chat/message/request IDs make retry safe |
| `POST /api/chats/:chatId/messages`                       | Send with validated parent and effort choice                                       |
| `POST /api/chats/:chatId/messages/:messageId/edit`       | New user sibling + assistant/run, never UPDATE old text                            |
| `POST /api/chats/:chatId/messages/:messageId/regenerate` | New assistant sibling, selected last assistant only                                |
| `GET /api/chats`                                         | Cursor list or ranked search, owner scoped; bounded page size                      |
| `GET /api/chats/:chatId`                                 | Tree, canonical projected content, viewed leaf and recovery state                  |
| `PUT /api/chats/:chatId/viewed-leaf`                     | Explicit branch selection after membership/owner validation                        |
| `PATCH /api/chats/:chatId`                               | Trimmed rename 1–120 characters; user title always wins                            |
| `DELETE /api/chats/:chatId`                              | Irreversible marker + outbox; immediate disappearance                              |
| `PUT /api/chats/:chatId/messages/:messageId/feedback`    | Good/Bad/null; one rating per owner/message                                        |
| `GET /api/runs/:runId/events`                            | Authorized SSE replay/live/reset                                                   |
| `POST /api/runs/:runId/cancel`                           | Owner-authorized F3 cancel; retains partial output                                 |

Paths are builder choices. Normal workspace home remains `/workspace` (New chat),
`/chats` is history, `/chats/:chatId` is a stable thread URL. Use scoped not-found
routes that compile under Next.js's dynamic-segment rules; guessed/foreign/
deleted chat IDs render the in-shell 404 without title/content hints.

The transport submits only new action identifiers, text, parent, and effort;
never trust the SDK-supplied full messages array as server history or accept
client instructions/tools. It owns bounded reconnect/backoff, Last-Event-ID,
reset and snapshot handling, safe errors, and resource cleanup. Runtime instance
scope includes user, org, and chat; tenant transitions/sign-out dispose it and
clear K1 memory/caches. No browser persistence of transcripts or tokens.

Keep the existing shell, Settings dialog and role gates. Sidebar becomes New
chat, Chats, Recent (six by last activity), View all chats, and existing authorized
platform destination. Settings remains in the user menu. Use assistant-ui thread
and branch/action/reasoning primitives and Base UI shadcn menus/dialogs, no direct
Radix imports. Remove the inert attachment control; no nonfunctional actions.
The prototype's Ctrl+Shift+O conflicts with browser bookmark management;
proposed New chat shortcut is Ctrl+Alt+N / Cmd+Alt+N, ignored while composing,
with a matching visible hint and accessibility test. Record this adaptation.

Preserve the prototype's hierarchy, welcome copy, composer placement, disclaimer,
messages, edit mode, branch picker, safe errors, reconnect status, skeleton,
menus, and destructive confirmation. Copy gives Markdown, feedback toasts
"Thanks for your feedback." Both feedback choices can be changed/cleared.
Deep thinking is a labeled aria-pressed toggle. Keyboard/focus and reduced motion
follow LEX-DS-001; polite incremental announcements do not reread the full answer.
Use a safe Markdown renderer without raw HTML; links and highlighting must not
introduce scriptable markup. Proposed Markdown package is the assistant-ui
registry's matching renderer, pinned exactly if needed; verify its license,
transitive requirements, and exact registry dependency before installation.

## Titles, Recent, and search

The first successfully completed answer schedules an idempotent title job in
its completion transaction via the existing outbox. The title worker starts a
separate `chat-title` engine run through the public transaction-aware contract.
Capacity refusal retries title scheduling without failing the completed answer.
Only one logical title task is eligible; model attempts obey the profile limit.
Failed/stopped first answers retain the excerpt until an eligible first answer
completes. A user rename, deletion, or an already committed AI title makes a
late title application a no-op under the chat lock/title-version precondition.

Output is at most 60 characters, no quotes/trailing punctuation, in the
conversation language. A bounded validator rejects unsuitable output; do not
silently ask an unbudgeted second model call. Failure leaves the excerpt with
no user-facing failure. Model input is bounded first-turn data inside untrusted
delimiters; instructions to choose a particular title cannot override policy.
Title runs and their output are K1 and deleted with the chat, usage is retained.
For the open thread observe title completion through a safe notification that
invalidates owner-scoped query data; other pages refresh Recent on navigation/
focus and an appropriate bounded query refresh. Never reload the whole page.

Normal history uses activity timestamp/ID cursor order, grouped in the user's
local calendar: Today, Yesterday, preceding seven days excluding those groups,
then month/year. List mutation races must not duplicate rows on append. Ranked
search uses score then activity/ID ties and a cursor bound to the query/sort;
never place raw search terms in cursor payloads, URLs, logs, traces, or Sentry.
Use an authenticated owner-scoped search request without URL-encoded K1 terms
if the chosen HTTP query form would otherwise expose them (builder choice:
`POST /api/chats/search`, replacing the search variant of GET above).

Search spans titles, all user messages, and canonical assistant answer text,
including inactive branches; not reasoning. English FTS and pg_trgm combine
ranked lexical and partial/article-number matches. Use GIN-supported candidates
and EXPLAIN ANALYZE with RLS enabled and representative data. Do not disable RLS
or force index scans to manufacture acceptable evidence. Highlight snippets are
plain text with validated offsets/text segments, never ts_headline HTML rendered
as HTML. Test stemming, numeric article terms, partials, accents/Unicode, hostile
HTML, pagination, cross-owner candidates, and deletion during search.

One result per chat chooses its best-ranked message match. Clicking a message
match selects a deterministic descendant leaf containing it (prefer the saved
leaf if it contains the match, otherwise the most recent eligible descendant),
persists that viewed branch, scrolls to the message, and briefly highlights it
with motion preferences respected. Validate the target again when opening;
stale/deleted matches cannot leak content. Title-only matches open the saved
branch without changing it. Proposed highlight duration: 2 seconds.

## Permanent deletion, usage survival, and capacity

User confirmation means permanent delete. In one tenant transaction, lock the
chat, mark it irrevocably deleted, write an ID-only deletion-requested audit,
and append a cleanup job through F0's outbox. No restore/undo path. The chat
immediately disappears from list/Recent/search and its URL becomes not-found;
new SSE, send/edit/regenerate, rename, feedback, and history context refuse it.
Open SSE connections are closed and their buffered content discarded. The same
message idempotency keys cannot recreate it after physical removal; retain only
bounded ID-only deletion/idempotency facts sufficient to enforce this rule.
These operational retry facts are not the F18 restore-time deletion ledger.

**Content fence:** the deletion marker and checkpoint, answer, reasoning, title,
and message writes serialize on the same locked chat state inside their write
transactions. Migrator-owned constraints/triggers enforce this for run and
checkpoint tables too; preflight checks alone are insufficient. Define and test
one consistent chat/run/step/attempt lock order with F1 actor locks. After run
removal, missing foreign/claim identity also rejects content writes. Fence
stream publication by the same persisted generation/liveness authority so an
old worker cannot recreate deleted stream keys. Tests park a worker before a
write, commit deletion, then release it, asserting no content or stream revival.

**Cleanup:** configurable cancellation grace defaults to 30 seconds, cleanup
target 60 seconds from the request while PostgreSQL, Valkey, and workers are
available. Begin cancellation immediately through F3. After grace do not wait
for the model call, which may run for F3's 60-second timeout: fence it and purge
chat/messages/feedback, answer/title runs, steps/attempts/checkpoints/operations,
associated stream/guard/registry entries, and content-bearing follow-up work.
Jobs/outbox contain only IDs; late deliveries become no-ops. Preserve safe job
receipts and the deletion work identity until completion is durably known.

Each phase is repeatable, with persisted phase/progress or equivalent
idempotent evidence. Retry Valkey cleanup after a crash between systems; do not
claim distributed atomic deletion. Emit content-free cleanup retry/overdue
metrics or fixed-code logs. Dependency outages do not make the chat visible;
the target resumes when services are available and overdue work is surfaced.
Completion audit (IDs only) is written once after actual cleanup, using a
stable event identity. Repeated cleanup after completion changes nothing.

**Usage ledger:** `app.usage_events` belongs to Usage, FORCE RLS by org, one
row per unique attempt ID. Fields are content-free: org/actor/run/step/attempt
IDs, model/provider, effort/profile ID, reservations and estimator version,
reported input/output/cached/reasoning tokens, cost, outcome and timestamps,
and generation ID for later F17 reconciliation. Keep references as plain
values: no FK into runs, steps, attempts, chats, messages, or another table
whose cascade would erase usage. It holds no prompt, title, summary, tool
arguments, connection string, key, or chat-derived text.

F3's reservation/metadata/settlement and crash-to-unknown paths write the ledger
going forward in the same transaction as their accounting change. Keep current
attempt rows for live-run admission/budgets; do not backfill guessed usage or
change conservative admission. At deletion, copy/upsert every existing attempt's
known facts and mark unsettled attempts unknown before execution rows disappear.
Persist enough accounting identity before the external request that a late
trusted worker outcome can settle the ledger without a run or live step claim.

Uniqueness and conditional transitions prevent duplicate settlement and reject
conflicting repeated results. Unknown may be enriched by the original in-flight
request's later reported result exactly once; it creates no new content rights
or admission. This is receipt of a local outstanding call, not F17's deferred
remote-cost/admin-endpoint reconciliation. A crash with no reported result leaves
unknown, original reservation and generation identity intact. No admin API calls.
A late worker cannot create a usage event for an unreserved attempt.

**Capacity:** run deletion uses F3's existing slot lifecycle/FK release; the
organization/global active-run slot disappears once. Step permits use the same
owner-token conditional release used by normal completion, with durable run/
claim association sufficient for cleanup to invoke it without the original
worker object. Also release DB live-claim occupancy. Never decrement a parallel
counter or release a replacement owner's token. The late worker's renew/release
becomes a harmless no-op; do not wait for lease expiry. A permit is logical
admission, not proof an uncooperative upstream request physically stopped.

Mandatory combined regression: block the mock model past grace, delete, observe
cleanup complete and its once-only audit/capacity return, then release the
response. No content is written, usage is recorded once with known reported
facts (or unknown if irretrievable), capacity stays at baseline, and repeated
cleanup/result/cancel delivery changes nothing. Repeat with a crashed worker,
a title run, unknown outcome, and interruption between DB and Valkey cleanup.
Cross-tenant/no-context ledger negatives are required. F17 builds views and
customer quotas from this retained ledger.

## Verification, review, and evidence

The plan must open a draft PR at execution start so each pushed task runs CI.
Keep all work on `f4-chat`; push completed tasks for review, never main. Use TDD
and existing independent `pnpm test` / package commands: Vitest global-setup
Testcontainers once per run, template-cloned DB per file, isolated Valkey prefix
and S3 bucket, no reuse by default or CI. Compose `pnpm test:e2e` remains the
separate real-topology layer, now through Caddy. No new test framework.

Required evidence groups:

- Shared contracts, transaction rollback and concurrent idempotency/one-answer
  admission, parent/leaf invariants, policy negatives and no-context RLS.
- Public-engine contract regressions: effort snapshot and outgoing preferences,
  usage survival, claim/permit/run-slot races, terminal invariants, deletion
  versus completion/checkpoint/title and late responses.
- The five-condition early runtime/transport proof before screen work; failing
  approach 1 triggers the already authorized fallback rather than workaround.
- Reasoning case matrix at raw provider, engine, SSE, client and reload levels.
- Hub replay/live races, trimming/expiry/reset, checkpoint cursor pairing,
  slow consumers, per-user connection limits, revocation/deletion and shutdown.
- Incremental Caddy delivery and Last-Event-ID pass-through with real backend;
  Next.js is not the SSE proxy.
- S2 k6 load with at least 500 simultaneous authenticated SSE connections on
  one Backend API process, multiple users to respect the connection limit,
  fixed reader connection counts measured before/during/after, bounded memory,
  and orderly teardown. Respect F3's 24 active-run cap: many subscribers may
  share authorized test runs; do not create 500 active runs. Record exact load
  fixture, durations, samples, resource limits, source revision and connection
  inventory. Record local mock send-to-first-frame latency without inventing
  a pass threshold. Tool approval UI remains F5; report S2's corresponding
  subcriterion as deferred rather than claiming it was exercised by F4 UI.
- FTS/trigram query plans with RLS, safe snippets and matching-branch navigation.
- Mock evals through the backend's one public evaluation entry: branch-only
  context, budget-edge truncation, status-labeled partial answers, exclusion of
  all reasoning from later context, hostile earlier content, title constraints,
  answer language, no invented sources, and no claimed research. Assert the
  trusted instruction version recorded on each run.
  Real eval high/max cases stay guarded/manual/capped.
- Privacy tests for messages, titles, summaries, search terms, provider metadata,
  request logging and error paths; no real data or keys in artifacts.
- Every prototype state rendered in light/dark desktop, plus mobile New chat,
  thread and Chats. Include measured/no-signal/no-summary reasoning variants,
  search branch highlight and deletion. Axe on all relevant states, keyboard,
  focus return, reduced motion, 767/768 boundaries and no horizontal overflow.

Use stable PNG names, deviceScaleFactor 1, and an index/hash manifest. Main
session compares each affected rendered UI with matching approved prototype,
records the comparison and adaptations, and presents the full set/deviation
table for owner approval before locking Playwright Linux CI goldens. Add early
informal previews after the first complete thread and after history/sidebar,
so owner feedback is not delayed until the final set. Do not reinterpret a
preview as formal visual acceptance. Do not update existing F2.1 goldens simply
to hide unrelated regressions; intentional F4 navigation/content changes need
recorded approval. Screenshots are synthetic data only.

Full gates include build (route-tree compilation), typecheck, lint/boundaries,
format check, independent tests, Compose E2E, evals and scoped/full branch
review as the eventual approved plan requires. Evidence names proposed:
`F4-acceptance.md`, `F4-runtime-proof.md`, `F4-sse-load.json`,
`F4-stream-latency.json`, `F4-smoke.json`, and an F4 visual index/deviation table
under `docs/references/`. Real observations and pending gates are never mixed.

## Research notes

Read date for all entries: **2026-11-09**. Public documentation can track newer
patches; installed sources/types are the authority for APIs at Lexon's exact
pins. No dependency upgrades, model calls, account/admin API calls, or product
implementation were performed during this research.

| ID  | Source / exact version examined                                                                                                                                                                                                                                                                                                                                                                   | Finding and decision supported                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | [F4 brief](../../briefs/F4-chat.md), [prototype README](../../design/f4-prototype/README.md), all 23 PNGs; main `6b33826`                                                                                                                                                                                                                                                                         | Approved scope and hierarchy; synthetic Indonesian conversation text, English UI. No prototype HTML copied into product.                                                                                                                                                                                                                                             |
| R2  | LEX-TS-001 §§2–3, 7–9; LEX-ARC-001 §§3.2, 3.5, 4.1, 4.7, 5.3–5.4, 6, 10; LEX-DS-001 §§5–6; F3 public design/evidence and source                                                                                                                                                                                                                                                                   | F3 is headless, RunService owns its transaction, accounting is currently cascade-deleted `ai_attempts`, registrations empty, Next rewrites all API. Defines necessary revisions and topology change.                                                                                                                                                                 |
| R3  | [AI SDK transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport), installed `ai@7.0.159` docs and `src/ui/chat-transport.ts`                                                                                                                                                                                                                                                                       | sendMessages/reconnectToStream and `resumeStreamIsReplay` are available; custom transport must map Lexon's action and replay contracts. No model API on frontend.                                                                                                                                                                                                    |
| R4  | Installed AI SDK resume-streams, message-persistence and stream-protocol docs; [resume](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams), [persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence), [protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)                                                                                                    | Disconnect differs from cancellation; suffix replay requires compatible parser state/part identity. Next Route Handler and resumable-stream examples are not Lexon's architecture. Proof must establish checkpoint + suffix correctness.                                                                                                                             |
| R5  | [assistant-ui runtime overview](https://www.assistant-ui.com/docs/runtimes/ai-sdk/overview), [branching](https://www.assistant-ui.com/docs/guides/branching), [external store](https://www.assistant-ui.com/docs/runtimes/custom/external-store), [index](https://www.assistant-ui.com/llms.txt); installed `@assistant-ui/react@0.15.32`, `@assistant-ui/ai-sdk@0.0.16`, `@ai-sdk/react@4.0.163` | AI SDK adapter uses external-store machinery. Public messageRepository seeds a tree once while SDK messages are empty; unstable_onBranchChange signals explicit switches. onEdit/onReload change the local visible list. These facts motivate the owner-required early proof; they do not prove server history preservation.                                         |
| R6  | [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens); installed provider `3.1.0` dist source, streaming transformer                                                                                                                                                                                                                                          | reasoning.text and reasoning.summary both call emitReasoningChunk without per-delta type metadata; encrypted is not emitted there. Accumulated typed details appear at reasoning-end/finish. Classify/timestamp at raw stream boundary, never infer summary from untyped delta.                                                                                      |
| R7  | Installed `ai@7.0.159` stream-language-model-call.ts and provider source                                                                                                                                                                                                                                                                                                                          | SDK accumulates reasoning and provider metadata. A downstream UI-only filter is insufficient; strip forbidden content before that accumulation and avoid generic metadata persistence. Current gateway already supports custom fetch.                                                                                                                                |
| R8  | Public [OpenRouter model list](https://openrouter.ai/api/v1/models), exact `openai/gpt-6-luna` entry                                                                                                                                                                                                                                                                                              | Observed supported efforts max/xhigh/high/medium/low/none, default medium, context 1,050,000 and advertised max completion 128,000. Listed prompt/completion prices USD 0.10/0.50 per million below the long-context tier. Model metadata is not proof of Azure availability, ZDR, physical region, latency, or suitable budgets. Proposed bounds remain unverified. |
| R9  | [Nest SSE](https://docs.nestjs.com/techniques/server-sent-events), [HTML SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html); installed Nest `12.3.2`, Express adapter `12.3.2`                                                                                                                                                                                         | SSE IDs/reconnect semantics and close lifecycle. Authorize before flushing headers; verify actual pinned adapter behavior in tests, not just decorator examples. Reuse existing guards and short transactions.                                                                                                                                                       |
| R10 | [Valkey XREAD](https://valkey.io/commands/xread/), installed Valkey image `9.0.7-alpine3.24`, `ioredis@6.0.0`, F3 RunStreams/permit source                                                                                                                                                                                                                                                        | Multi-key blocking reader plus shared replay connection; fixed connection count. Keep MAXLEN 1024, 24 active/6 terminal, 6 MiB slots, 3600-second terminal TTL, 32 lifecycle-event bound and 250 ms publication bound. Cleanup must use owner-token release, not delete a replacement permit.                                                                        |
| R11 | [PostgreSQL 17 FTS controls](https://www.postgresql.org/docs/17/textsearch-controls.html), [pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html); installed PG `17.11`, Drizzle `0.45.4`, Kysely `0.29.7`, pg `8.23.1`                                                                                                                                                                        | English lexical ranking + trigram candidates, indexes under real RLS plans, safe text/offset highlights; ts_headline HTML is not safe renderable output. Use repository migration/transaction patterns.                                                                                                                                                              |
| R12 | [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [options](https://caddyserver.com/docs/caddyfile/options), [2.11.9 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.9), [official image](https://hub.docker.com/_/caddy), [tag metadata](https://hub.docker.com/v2/repositories/library/caddy/tags/2.11.9-alpine)                         | Official current release/tag and multi-platform digest above verified. SSE flushes immediately; explicit negative flush_interval disables buffering and affects upstream cancellation. read_timeout measures wait for next backend read. Propose stack v1.12 and test disconnect cleanup as well as frame/header forwarding.                                         |
| R13 | [Next dynamic routes](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes); installed Next `16.4.3`, React `19.3.1`; [React external store](https://react.dev/reference/react/useSyncExternalStore)                                                                                                                                                                         | Keep existing workspace provider, stable runtime scope, scoped not-found routes; no conflicting sibling dynamic names. Build is a route compilation gate. No new auth or server-side model path.                                                                                                                                                                     |
| R14 | [TanStack infinite queries](https://tanstack.com/query/v5/docs/framework/react/guides/infinite-queries), installed `5.105.0`; [Zod v4 release/migration](https://zod.dev/v4), installed `4.6.7`; existing shared contracts                                                                                                                                                                        | Owner/org-scoped query families and cursor pagination; strict shared schemas and validation. One workspace Zod and TS `6.0.3`, no new state library.                                                                                                                                                                                                                 |
| R15 | [assistant-ui Reasoning](https://www.assistant-ui.com/elements/reasoning), [shadcn Base AlertDialog](https://ui.shadcn.com/docs/components/base/alert-dialog), frontend components.json and kept elements; pinned shadcn CLI `4.23.0`, Base UI `1.9.0`, Sonner `2.0.8`                                                                                                                            | Use base-nova registry elements and existing owned components; no direct Radix. Lexon's persisted timing overrides automatic inference. Registry/CLI per-component inspection remains mandatory before each UI implementation task; no add/install during design.                                                                                                    |
| R16 | [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), installed `6.5.3` and F0 dispatcher/receipts                                                                                                                                                                                                                                                                           | Cleanup/title scheduling reuse outbox + stable job IDs + transactional receipts; a multi-phase external cleanup does not claim one distributed transaction.                                                                                                                                                                                                          |
| R17 | [Vitest global setup](https://vitest.dev/config/globalsetup), installed `5.0.5`; [Playwright visual comparison](https://playwright.dev/docs/test-snapshots), installed `1.64.1`; existing harness                                                                                                                                                                                                 | Preserve independent Testcontainers isolation, separate Compose layer, controlled mock barriers, owner visual gate and Linux goldens. k6 is already named by locked stack for S2; exact tool/image pin is a planning prerequisite.                                                                                                                                   |
| R18 | Installed AI SDK CHANGELOG entries 7.0.159–7.0.154 and pinned adapter/provider source                                                                                                                                                                                                                                                                                                             | Recent changes include stream-part type graduation and removed redundant SDK validation. Keep shared/runtime validation at trust boundaries. Do not upgrade packages to solve the proof without a reviewed dependency decision.                                                                                                                                      |

### Research outcomes still pending

- Five-condition runtime proof and fallback decision: not run; record before UI.
- Real high/max smoke: owner-run gated task; no samples yet, no case frequencies
  or measured budgets claimed. Record each case/sample count per effort, measured
  input ratio and known/unknown provider observations when available.
- Actual base-nova registry components, Markdown renderer transitive versions,
  Caddy validation/incremental behavior and exact k6 pin: verify before their
  implementation tasks. No invented successful compatibility claim.

## Builder check

A fresh software-engineering builder reviewed the draft without implementing
anything. It asked two questions: which chat instructions govern behavior, and
whether retained partial answers enter later context. The owner resolved both
on 2026-11-09; the instruction and context sections above incorporate the full
answers. No unresolved product question remains from that check. Runtime proof,
smoke, and compatibility gates remain unexecuted and are not builder approval
of the implementation.

## Builder calls for owner review

Run output as canonical assistant text; proposed profile budgets/efforts and
smoke allocation; routes and cursor/search request form; two-second search
highlight; New chat shortcut replacing the prototype's browser conflict;
last committed viewed-branch selection across tabs; no invented duration on a
stop before first answer text; Caddy 2.11.9 / approved stack v1.12; proposed SSE
buffer/heartbeat/connection defaults; early informal UI previews and final
owner screenshot gate. These are proposals, not prior owner approvals.

## Design approval and corrections (2026-11-09)

The owner approved the design with these changes: LEX-DS-001 v2.2 controls;
chat history is 131,072 bytes; high/max output limits are 16,384/32,768 with
recomputed two-attempt budgets, all smoke-unverified; the seventh SSE connection
replaces that user's oldest; stack v1.12 includes every exact new dependency
and notable Markdown transitive/k6 pin before installation. All other listed
builder calls, including the four-request/USD 0.10 smoke allocation, are approved.
Proceed to writing-plans; implementation still requires plan approval.

## Planning research supplement (2026-11-09)

- R19: Pinned shadcn CLI `4.23.0` read-only `view` inspected the current
  base-nova thread, thread-list, markdown-text, reasoning and elements-reasoning
  registry entries; `docs` resolved Base UI/shadcn references for AlertDialog,
  Toggle, Tooltip, Input, Skeleton and Empty. Current registry requires
  `@assistant-ui/react ^0.15.33` and renderer `^0.14.25`. The plan explicitly
  proposes `@assistant-ui/react 0.15.33` (patch upgrade) and
  `@assistant-ui/react-markdown 0.14.25`, keeping AI SDK adapter `0.0.16`.
  Official npm metadata and published tarballs for those exact patches were
  read without installation; React 19 / assistant-ui 0.15 peers are compatible
  by declaration, and the public useScrollLock export exists. Runtime proof and
  render tests still establish actual compatibility. Remove registry attachment,
  tool, export and image features outside F4 rather than installing their deps.
- R20: Official npm metadata verified renderer dependencies and selected
  notable transitive pins: react-markdown 10.1.0, remark-gfm 4.0.1, unified
  11.0.5, remark-parse 11.0.0, remark-rehype 11.1.2, remark-stringify 11.0.0,
  micromark 4.0.2, mdast-util-gfm 3.1.0, micromark-extension-gfm 3.0.0,
  mdast-util-to-hast 13.2.0, hast-util-to-jsx-runtime 2.3.6, vfile 6.0.3,
  classnames 2.5.1, @types/hast 3.0.5, micromark-util-html-tag-name 2.0.1,
  and @radix-ui/react-primitive 2.2.0. Sources are the version-specific
  `https://registry.npmjs.org/<package>/<version>` endpoints and published
  package tarballs. The last dependency is internal to the vendor renderer;
  Lexon-owned code still never imports Radix. The plan must put these pins in
  stack v1.12 and workspace overrides before installation, recording the entire
  resulting locked new dependency closure in acceptance evidence. Read the
  [react-markdown security documentation](https://github.com/remarkjs/react-markdown#security)
  and [remark-gfm documentation](https://github.com/remarkjs/remark-gfm): keep
  raw HTML disabled, safe URL handling, and no remote images in F4 answers.
- R21: [k6 v2.3.0 release](https://github.com/grafana/k6/releases/tag/v2.3.0),
  [constant VUs](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-vus/),
  [HTTP params](https://grafana.com/docs/k6/latest/javascript-api/k6-http/params/)
  and official Docker Hub tag metadata were read. Proposed tool pin is
  `grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8`.
  It runs only as a separate load-test tool/container; no AGPL runtime code is
  linked into Lexon. Native k6 HTTP can hold concurrent streaming responses
  with response bodies discarded; it does not prove per-frame arrival. Combine
  that connection/memory load with separate actual frame/replay tests through
  Caddy; no SSE extension or custom k6 build is needed. At the default 6 streams
  per user and 24 active owner-private runs, 500 sustained active subscriptions
  cannot be exercised simultaneously. Proposed isolated load configuration:
  two owners, one real active run each, 250 subscribers each, SSE per-user limit
  256 for this measured run only. Record that configuration prominently; separate
  tests prove the production default 6 and oldest-connection eviction. Do not
  raise F3 run capacity or waive owner authorization to manufacture load evidence.
- R22: F3's actual estimator was executed without a model request. The full
  ordinary-history illustration estimates 157,247 input tokens. A 163,840
  estimated-input bound and two-attempt formulas yield high 360,448 and max
  393,216 run budgets. Serialization-sensitive truncation/refusal tests and real
  calibration remain required; no new tokenizer dependency is introduced.
- R23: PostgreSQL 17's current official [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), and [numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html) documentation was read on 2026-11-09 against the pinned PostgreSQL 17.11 deployment. RLS defaults to deny when enabled without a matching policy and table owners bypass it unless `FORCE ROW LEVEL SECURITY` is set; `SELECT ... FOR UPDATE` locks selected rows until transaction end and blocks concurrent writers/lockers; unconstrained `numeric` is exact and does not coerce values to a declared scale, but accepts special values including Infinity and NaN. This supports the approved tenant policies with forced RLS, row-locked idempotent settlement, and explicit finite/nonnegative cost checks. No schema or behavior change was made from this documentation check.
- R24: Task 4 re-read the official [AI SDK 7 settings](https://ai-sdk.dev/docs/ai-sdk-core/settings), [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), and PostgreSQL 17 [GRANT](https://www.postgresql.org/docs/17/sql-grant.html)/[REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html) pages on 2026-11-10; checked installed `ai@7.0.159`, `@openrouter/ai-sdk-provider@3.1.0`, and Vitest `5.0.5` sources. The SDK forwards language-model reasoning settings, the pinned OpenRouter adapter accepts raw `providerOptions.openrouter` request fields, and OpenRouter uses `reasoning.effort`; SDK `maxRetries: 0` disables SDK retries. PostgreSQL exposes table-level DELETE and TRUNCATE as separate privileges, so migration 0024 revokes both while retaining the existing SELECT/INSERT/UPDATE grant. These checks support Task 4 effort forwarding and append-only usage event privileges; no package version changes.
- R25: PostgreSQL 17 official [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), and [trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html) pages read 2026-11-10 against installed PostgreSQL `17.11`; installed Drizzle is `0.45.4` and its current [transactions](https://orm.drizzle.team/docs/transactions) and [constraints](https://orm.drizzle.team/docs/indexes-constraints) pages were checked. A real Testcontainers query on PG17.11 confirmed that owner/org `UPDATE ... WITH CHECK` alone does not make a row hidden by the strict live-row SELECT policy updateable to `deleted_at IS NOT NULL`; PostgreSQL rejects it with SQLSTATE `42501` (`new row violates row-level security policy`). Keep deleted rows invisible in SELECT. The approved exception is one fixed-search-path SECURITY DEFINER marker primitive, callable only by `lexon_app`, which verifies the explicit organization/user against the tenant settings and row owner/live predicate, takes the tenant claim advisory guard before locking the chat row, and changes only the deletion marker. `ChatRepository` appends the typed ID-only cleanup outbox record through `OutboxRepository` in the same caller transaction. A forced-RLS PG race test confirms a direct run-output update waits behind the chat marker and then fails without a deadlock or content write. No dependency or stack revision.
- R26: PostgreSQL 17 official [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), and [trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html) were rechecked on 2026-11-10 against PostgreSQL `17.11`; Drizzle `0.45.4` [transactions](https://orm.drizzle.team/docs/transactions) were also checked. `FORCE ROW LEVEL SECURITY` keeps deleted chat-bound run/step/checkpoint/operation content hidden from the runtime role. Lifecycle recovery therefore uses two narrow fixed-search-path SECURITY DEFINER primitives: an owner/context/resource/expected-state facts function that locks claim guard → chat → run → step and returns only status/version/sequence/fence/lease and active attempt IDs; and an expected-state finalizer that preserves all step/run text and output, terminalizes status/sequence through the existing run trigger, and returns changed/attempt IDs. Usage-event settlement remains in the application accounting module in the same tenant transaction; no prompt/output/config/summary or arbitrary settlement payload crosses the definer boundary. Their execute grants exclude PUBLIC and `lexon_auth`; the only additional forced-RLS policies are SELECT/UPDATE for `lexon_migrator` on the two lifecycle tables, because the fixed function owner is subject to forced RLS. The policies do not grant `lexon_app` access. Testcontainers negative-context, cross-owner/cross-org, stale-claim, privilege, lifecycle, and capacity-trigger assertions support the boundary. Migration `0027_chat_owner_fence_fixes.sql` follows already-applied `0026_chat_tree.sql`; the next journal slot is `0028`. No dependency or stack revision.

The approved stack revision is now recorded in LEX-TS-001 v1.12, including
Caddy, k6, Markdown/GFM and notable transitive pins, before any installation.
The implementation plan verifies that gate; no package/lockfile was changed
during planning. The plan proposes the isolated S2 configuration in R21 for
owner review and preserves default-six eviction tests.
