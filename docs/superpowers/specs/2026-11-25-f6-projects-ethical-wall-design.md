# F6 — Projects & ethical wall — design spec

| Field | Value |
|---|---|
| Slice | F6 — Projects ("Matters") & ethical wall |
| Date | 2026-11-25 |
| Status | Draft for owner review |
| Depends on | F5 (merged through `790b61a2`), F4/F4.2/F4.4, F1 |
| Brief | `docs/briefs/F6-projects-ethical-wall.md` (decisions 1–9 settled 2026-11-25) |
| Visual target | `docs/design/f4.1-prototype/` revision 18 (16 Matters states already drawn, `planned` in `index.json`) |
| Next migration | `0043` |

## 1. Scope

Projects are private-by-default containers for chats plus an optional
instructions document. Chats are bound to a project at creation and never move
(brief decision 7). Project members read every chat in the project; only a
chat's owner writes in it. An organization owner/admin sets a per-project deny
(ethical wall) that overrides every other grant, including chat ownership. A
standalone chat (no project) can be shared read-only with organization members.

Out of scope per brief: documents (F7), retrieval (F8), memory (F9), ownership
transfer / break-glass / retention (F18), moving chats between projects,
org-wide visibility setting, external sharing, multi-author chats, FTS over
other people's chats (F8).

## 2. Task 0 — F5 carry-over (four minors, each RED first where behavior changes)

| # | Item | Location (evidence) | Change |
|---|---|---|---|
| 0.1 | Expiry-sweep routing check accepts only a safe-integer priority 1–10, sharing one helper with the step coordinator. A candidate with an invalid priority is skipped and logged without K1, not retried forever. | `backend/src/modules/chat/expiry-sweep.ts` (`isRouting` accepts any number) vs `step-coordinator.ts` (requires safe integer 1–10) | Extract the shared `isRouting`-style priority check into one helper used by both files. RED: integration test feeding an expiry candidate with `priority: 1.5` / `0` / `NaN` → skipped, logged, no retry. |
| 0.2 | Client keeps the reassembled tool input when a `tool-input-available` part arrives without `input` (over-cap fallback) instead of replacing it with `{}`. | `frontend/src/lib/chat-stream.ts` (~line 627): `input: item.input ?? {}` clobbers input reassembled from `tool-input-delta` chunks | When `item.input === undefined`, emit the delta-reassembled input instead of `{}`. RED: stream unit test — delta chunks then a bare `tool-input-available` → emitted part carries the reassembled object. |
| 0.3 | The task-10 E2E asserts the worker sweep's return value. | `backend/test/e2e/chat-tools.spec.ts` (worker-control socket `/run/lexon/health/chat-proof.sock` drives the real sweep) | Assert the exact return value the sweep reports through the control socket, not just side effects. RED: assertion fails today because the spec does not inspect the returned value. |
| 0.4 | The thread a11y spec header cites the correct source for the contrast pass. | `backend/test/e2e/thread-a11y.spec.tsx` header comment | The contrast pass runs through `captureBrandViews`/`runBrandAxe` in `backend/test/e2e/brand-visual-support.ts` (axe `brandAxeTags`, WCAG tags) on every capture in both themes — not `chat-accessibility.spec.ts`. Comment-only change; no test needed beyond lint. |

## 3. Data model

All new tables live in `app`, ENABLE + FORCE ROW LEVEL SECURITY, tenant
predicates in the existing `NULLIF(current_setting('app.org_id', true), '')::uuid`
fail-closed form, bypass policies for `lexon_migrator` where triggers or
maintenance need them, grants to `lexon_app` matching existing tables.

### 3.1 `app.projects`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | tenant key |
| `owner_user_id` | uuid NOT NULL | the single owner; implied by the row, not a member row (brief: "the owner is implied by the project, not a member row") |
| `name` | text NOT NULL | `CHECK (char_length(name) BETWEEN 1 AND 120)` |
| `matter_number` | text NULL | `CHECK (matter_number IS NULL OR char_length(matter_number) <= 64)` |
| `practice_area` | text NULL | `CHECK (practice_area IS NULL OR char_length(practice_area) <= 120)` |
| `instructions` | text NULL | `CHECK (instructions IS NULL OR char_length(instructions) <= 8000)` |
| `member_count` | integer NOT NULL DEFAULT 0 | maintained by member-row trigger; feeds org-admin metadata list without member-row access |
| `chat_count` | integer NOT NULL DEFAULT 0 | maintained by chat trigger; feeds the delete confirmation |
| `last_activity_at` | timestamptz NOT NULL DEFAULT clock_timestamp() | maintained by chat activity trigger (same pattern as `chats.last_activity_at`) |
| `created_at` / `updated_at` | timestamptz NOT NULL | |

Indexes: `projects_org_id_id` UNIQUE (org_id,id); `projects_org_activity`
(org_id,last_activity_at,id) for the Matters list; `projects_org_name`
(org_id,name,id) for name sort; pg_trgm on `name` and `matter_number`
(the brief allows B-tree prefix or trigram on these two columns only — same
precedent as F4 title search). No FTS anywhere in F6.

`matter_number`/`practice_area`/names are K1 and never appear in logs,
traces, errors, audit metadata, or `pg_notify` payloads.

### 3.2 `app.project_members`

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | FK (org_id,project_id) → projects ON DELETE CASCADE |
| `user_id` | uuid NOT NULL | |
| `role` | text NOT NULL | `CHECK (role IN ('viewer','editor'))` — owner is implied by `projects.owner_user_id` |
| `created_at` / `updated_at` | timestamptz | |

UNIQUE (org_id,project_id,user_id); index (org_id,user_id) for "my
memberships" (sidebar Matters group, Matters list `shared` filter).
`member_count` maintained by trigger (lexon_migrator internal policy).

### 3.3 `app.project_denies` (ethical wall)

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | FK (org_id,project_id) ON DELETE CASCADE |
| `user_id` | uuid NOT NULL | the denied member |
| `set_by_user_id` | uuid NOT NULL | the org owner/admin who set it |
| `created_at` | timestamptz | |

UNIQUE (org_id,project_id,user_id). Deny-add deletes any existing
`project_members` row for that user in the same transaction ("a deny removes
any existing project role at once and blocks future adds"); lifting a deny does
not restore a role (decision/brief item 15). The project owner cannot be denied
— refused with a clear message (brief decision 3).

### 3.4 `app.chat_shares`

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid NOT NULL | |
| `chat_id` | uuid NOT NULL | FK (org_id,chat_id) → chats ON DELETE CASCADE |
| `user_id` | uuid NOT NULL | recipient |
| `granted_by_user_id` | uuid NOT NULL | the chat owner |
| `created_at` | timestamptz | |

UNIQUE (org_id,chat_id,user_id); index (org_id,user_id,created_at,chat_id) for
the "Shared with me" list. Shares on project chats grant nothing — the access
predicate only honors shares when `chats.project_id IS NULL`, so the invariant
is self-enforcing at the predicate level in addition to the service refusal.

### 3.5 `app.chats` change

Add `project_id uuid NULL` + FK (org_id,project_id) → projects **ON DELETE
SET NULL** + index `chats_org_project`
(org_id,project_id,last_activity_at,id). Set once at creation; no
`UPDATE (project_id)` column grant for `lexon_app`, so the binding is
immutable at the privilege layer (decision 7). Existing rows get NULL
(standalone chats). `SET NULL` (not `CASCADE`) because project deletion
reuses the F4 tombstone flow: the chats are first marked `deleted_at`
(fencing active runs, emitting per-chat outbox/notify records), then the
project row goes — the tombstoned chats become invisible standalone rows
that the existing cleanup sweep hard-deletes on schedule (§8).

## 4. The one access rule

**Read access to a live chat** requires all of:

1. `org_id` = current tenant org and `deleted_at IS NULL`;
2. **deny wins:** if the chat has `project_id` P and a `project_denies` row
   exists for (org, P, caller), access is none — this beats ownership,
   project roles, and org owner/admin status;
3. at least one grant: owner (`owner_user_id` = caller), **or** project
   access (`project_id` P and caller is `projects.owner_user_id` of P or a
   `project_members` row for P — viewer or editor both read), **or** share
   (`chat_shares` row, only meaningful when `project_id IS NULL`);
4. current organization membership, enforced by the existing claim fence
   and session invalidation plus the shared `ops.lexon_org_member` check in
   the RLS predicate (brief item 11: "organization membership is required").

**Access level** for rendering/authorization: `owner` > `editor` > `viewer` >
none. On a chat: owner of the chat = `owner`; project role of the caller =
that role for project-page capabilities (composer, instructions editing);
share recipient = `viewer`. On a project: `projects.owner_user_id` = owner,
member row role otherwise, deny = none, no row = none.

**Writes stay owner-only** (brief item 26). Project membership never grants
chat writes. Project writes: settings/members/delete = project owner;
instructions = owner or editor; chats-create-in-project = owner or editor
(they become owner of the new chat).

### 4.1 Application predicate (`authorization-predicate.ts`)

`authorization-predicate.ts` gains one scope kind — e.g.
`ChatReadAuthorizationScope` — whose builder emits the rule above as a single
composable predicate (params `$org`, `$user`):

```sql
c.org_id = $org AND c.deleted_at IS NULL
AND ops.lexon_org_member(c.org_id, $user)
AND NOT EXISTS (SELECT 1 FROM app.project_denies d
     WHERE d.org_id=c.org_id AND d.project_id=c.project_id AND d.user_id=$user)
AND ( c.owner_user_id = $user
   OR (c.project_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM app.projects p
                 WHERE p.org_id=c.org_id AND p.id=c.project_id
                   AND p.owner_user_id=$user)
        OR EXISTS (SELECT 1 FROM app.project_members m
                 WHERE m.org_id=c.org_id AND m.project_id=c.project_id
                   AND m.user_id=$user)))
   OR (c.project_id IS NULL AND EXISTS (SELECT 1 FROM app.chat_shares s
        WHERE s.org_id=c.org_id AND s.chat_id=c.id AND s.user_id=$user)) )
```

`OwnedChatAuthorizationScope` (the existing owner-only scope) stays for every
write path and for owner-only reads (FTS search stays owner-only in F6 —
brief out-of-scope item). Every read path in §5 uses the new builder. There is
no unfiltered path.

`ops.lexon_org_member(org_id uuid, user_id uuid)` is a small
`SECURITY DEFINER` fixed-search-path function on `auth.member`
(`lexon_app` already holds `GRANT SELECT (id, user_id, organization_id, role)`
from migration `0004`); grants EXECUTE to `lexon_app`, revokes PUBLIC and
`lexon_auth`, same pattern as `ops.ai_chat_run_is_associated` (migration
`0028`). A companion `ops.lexon_org_owner_admin(org_id,user_id)` returns
`role IN ('owner','admin')` for org-owner/admin-gated policies.

### 4.2 RLS mirror — exact policy changes

Read policies widen to owner OR project access OR share; write policies stay
owner-only. `D` below = the deny `NOT EXISTS` clause; `M` = `ops.lexon_org_member`;
`G` = the grant disjunction; all scoped to `org_id = NULLIF(current_setting('app.org_id',true),'')::uuid`.

**`app.chats`** — replace `owner_live_chat_select`:

```sql
DROP POLICY owner_live_chat_select ON app.chats;
CREATE POLICY chats_access_select ON app.chats FOR SELECT TO lexon_app
USING (
  org_id = NULLIF(current_setting('app.org_id',true),'')::uuid
  AND deleted_at IS NULL
  AND ops.lexon_org_member(org_id, NULLIF(current_setting('app.user_id',true),'')::uuid)
  AND NOT (project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM app.project_denies d
        WHERE d.org_id=chats.org_id AND d.project_id=chats.project_id
          AND d.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid))
  AND ( owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
     OR (project_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM app.projects p
                   WHERE p.org_id=chats.org_id AND p.id=chats.project_id
                     AND p.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)
          OR EXISTS (SELECT 1 FROM app.project_members m
                   WHERE m.org_id=chats.org_id AND m.project_id=chats.project_id
                     AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
     OR (project_id IS NULL AND EXISTS (SELECT 1 FROM app.chat_shares s
          WHERE s.org_id=chats.org_id AND s.chat_id=chats.id
            AND s.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid))));
```

`owner_live_chat_update` stays owner-only (rename, `viewed_leaf_id`,
`active_answer_run_id`, tombstone fence all remain owner paths; readers never
mutate). `owner_live_chat_insert` gains the project-creation gate — the
caller may only create a chat in a project where they have editor-or-owner:

```sql
... AND ( project_id IS NULL
   OR ( NOT EXISTS (SELECT 1 FROM app.project_denies d
                     WHERE d.org_id=chats.org_id AND d.project_id=chats.project_id
                       AND d.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)
        AND ( EXISTS (SELECT 1 FROM app.projects p
                       WHERE p.org_id=chats.org_id AND p.id=chats.project_id
                         AND p.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)
              OR EXISTS (SELECT 1 FROM app.project_members m
                       WHERE m.org_id=chats.org_id AND m.project_id=chats.project_id
                         AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
                         AND m.role='editor'))))
```

**`app.chat_runs`** — `owner_chat_run_select` (0027) widens: same predicate
via the parent chat (`EXISTS app.chats WHERE org_id=cr.org_id AND
id=cr.chat_id AND <access rule>`). `owner_chat_run_insert` stays owner-only.

**`app.chat_messages`** — `owner_chat_message FOR ALL` (0026) splits into
`chat_message_access_select` (read rule via parent chat) plus owner-only
`FOR INSERT`/`FOR UPDATE`/`FOR DELETE` policies preserving today's write
behavior exactly (message inserts flow through the internal
mutation-request triggers as lexon_migrator regardless).

**`app.ai_runs`** — the RESTRICTIVE `ai_runs_owner_live_resource` (0028)
splits by command, because a member watching a project chat's run SELECTs
run rows under their own claim:

- `ai_runs_access_read` AS RESTRICTIVE FOR SELECT: the three existing arms,
  with the second arm's owner clause replaced by the chat-access rule
  (owner OR project access OR share on the associated chat). Queued
  unassociated and zero-resource arms unchanged.
- `ai_runs_owner_live_write` AS RESTRICTIVE FOR INSERT/UPDATE/DELETE:
  identical to today's arms with `initiating_user_id=app.user_id AND`
  owner-only chat clause — writes stay owner-only.

**`app.ai_steps`, `app.ai_checkpoints`, `app.ai_operations`** — same split of
their 0027 RESTRICTIVE `*_owner_run` policies: SELECT arm widened from
"caller is the run's initiating user" to "caller has read access on the
chat the run belongs to" (EXISTS over `chat_runs` → `chats` predicate);
write arms keep `initiating_user_id = app.user_id` (owner-only). Runs of
unassociated/zero-resource keep today's shape. `ai_attempts` gets the same
split if it carries an owner-run restrictive policy (plan verifies).

**New-table policies (`lexon_app`)**

- `projects` SELECT: `org` AND `ops.lexon_org_member` AND NOT denied AND
  (owner OR member EXISTS OR `ops.lexon_org_owner_admin`) — the admin arm
  exists for the metadata-only list; the API contract for that list
  returns metadata fields only, and every project-content path still
  requires membership (decision 3/4).
- `projects` INSERT: `org` AND `owner_user_id = app.user_id` AND
  `ops.lexon_org_member`.
- `projects` UPDATE: `org` AND (owner OR member `role='editor'` AND NOT
  denied). Column discipline is enforced by the service (editors may only
  update `instructions`; owners all settings) — RLS cannot differ per
  column, so the service is the enforcement point; the policy only narrows
  who may touch the row at all.
- `projects` DELETE: `org` AND owner only.
- `project_members` SELECT: `org` AND NOT denied-on-that-project AND
  (project owner OR member) — the members dialog and role labels.
  INSERT/UPDATE/DELETE: `org` AND project owner AND NOT denied, WITH CHECK
  additionally `ops.lexon_org_member(org_id, user_id)` on the target and
  `NOT EXISTS project_denies(target)` — a denied target can never be
  (re)added at the privilege layer either.
- `project_denies` SELECT/INSERT/DELETE: `org` AND
  `ops.lexon_org_owner_admin(org_id, app.user_id)` only. Project members
  never see deny rows; the denied user's world is 404-shaped by the
  dependent policies, not by reading this table.
- `project_chats` — not needed: `chats.project_id` column replaces a join
  table (decision 7, immutable binding).
- `chat_shares` SELECT: `org` AND (chat owner via `EXISTS chats.owner` OR
  `user_id=app.user_id`) — owner manages shares; recipient needs own rows
  for the Shared-with-me list and the predicate.
- `chat_shares` INSERT/DELETE: `org` AND chat owner AND (INSERT only)
  target is `ops.lexon_org_member` and `chats.project_id IS NULL`.

Grants: `lexon_app` gets SELECT on all four new tables; INSERT/UPDATE/DELETE
on `project_members`, `chat_shares`; INSERT/UPDATE/DELETE on `projects`
(column grants excluding `member_count`, `chat_count`, `last_activity_at`,
`project_id`-analog fields maintained by triggers); INSERT/DELETE on
`project_denies`. `lexon_migrator` internal FOR ALL bypass policies on all
new tables (existing convention).

**Chat creation plumbing:** chats are materialized by the
`chat_create_requests` trigger (migration 0029). The request table gains a
nullable `project_id` column; the create-request INSERT policy applies the
same editor-or-owner-in-project gate as `chats` INSERT, and the materialize
trigger copies `project_id` onto the new chat row. `chat_mutation_requests`
needs no change — only the chat owner mutates a chat, project or not.

## 5. Read-path inventory — every existing read path and how it gets the rule

| # | Read path | Code location today | F6 handling |
|---|---|---|---|
| 1 | Sidebar **Recent** + Chats page list | `ChatSearchRepository.list` | **Recent and Chats list the user's own chats** (brief items 19, 25) — they keep `OwnedChat` scope, **plus** the `D` deny clause (a denied owner loses their own project chats) and a join to `projects` for the project-name secondary text on own project chats. |
| 2 | Chats page **"Shared with me"** filter | new scope on the same list endpoint | `chat_shares` arm only (project chats can never appear here). |
| 3 | Chat **search** (FTS) | `CHAT_SEARCH_SQL` `owner_chats` CTE | Stays owner-only (FTS over others' chats is F8). The `D` clause is added to the CTE so a denied owner gets no hits on their own project chats. |
| 4 | `resolveMatch` (search → message navigation) | `ChatSearchRepository.resolveMatch` | Same owner+D scope. |
| 5 | Chat **detail / tree** | `ChatRepository.readLive` | Full new predicate (owner/project/share, deny-wins). |
| 6 | `lockLive` | `ChatRepository` | Owner-only — write fence. |
| 7 | `rename` | `ChatRepository` | Owner-only. |
| 8 | `selectLeaf` (viewed-leaf write) | `ChatRepository` | Owner-only; readers do not move the owner's leaf. |
| 9 | `markDeleted` | `ops.ai_mark_chat_deleted` fence | Owner-only; project deletion gets its own definer (§8). |
| 10 | **SSE replay + live** | `AiRunRepository.authorizedChatSnapshot`, `AiStepRepository.stream*Proof` chain in `chat-runtime.providers.ts` | Widened to the read predicate (viewer-level grants stream access). Every per-drain re-check re-evaluates it → revocation closes the stream ≤ `REVALIDATION_INTERVAL_MS` (5 s). |
| 11 | **Run context** (`historyForRun`, history collect) | `ChatMessageRepository`, `ChatHistoryContextProvider` | Owner-scope — only chat owners run chats. The owner-denied case is caught before collect by the capability gate (§9). |
| 12 | **Title invalidation** fan-out | `pg_notify('lexon_chat_title', {orgId,userId,chatId})` → `PgNotificationListener` → `RunEventsService` pendingChatIds | Payload drops `userId` → `{orgId,chatId}` (content-free). Server fans out to each connected user of that org **that currently passes the read predicate** (owner ∪ project members ∪ share recipients). Denied/removed users are deliberately not notified — their stale view is corrected by §10's stream close and by refetch 404s; notifying them would leak the chatId. Schema `ChatTitleNotificationSchema` and the listener parse updated; `chatId`-null `invalidateAll` path unchanged. |
| 13 | Access-change invalidation (member removed, deny set, share revoked, role change) | new emits on `lexon_chat_title` / `chat.invalidated` | Member/deny/share mutations emit `chat.invalidated` (`chatId:null` = refresh) to the affected user(s) — the target always gets it (they must refetch and hit 404s), plus project members when their visible set changed. Reuses the existing channel and event schema — no new channel. |
| 14 | F5 **operation/approval/question reads** (dock panels) | run snapshot serialization | Run/step rows become readable by viewers via §4.2, but **panels render only for the chat owner** — operation payloads are filtered out of the snapshot serialization for non-owner callers; waiting marker reads "Waiting for <owner>" (brief items 18, 24). API-level: decision endpoints stay owner-only (capability policy). |
| 15 | Matters list, sidebar Matters group, project page, project chats list, member list, org metadata list, shared-with-me list | new repositories | All built on the §4.1 builder + new-table policies. |
| 16 | Chat invalidation stream subscription itself | `RunEventsService` | Per-connection events now fan out per §12/§13; subscription unchanged. |

## 6. Deny matrix — identical 404s everywhere

For each path the test creates: nonexistent id N, real project chat C the
caller is denied on, real project chat the caller is a non-member of. Every
response is byte-identical (F4.4 error contract — status 404 + same body).
Item 150's split is asserted separately: a **member lacking the capability**
(e.g. viewer calling instructions-update or start-run) gets **403**; a
non-member or denied caller gets **404**.

| Path | Test (each at API + RLS level where feasible) |
|---|---|
| Matters list / sidebar group | denied project absent; `GET /projects/:id` → 404 |
| Project page, chats list, members, instructions | all → 404 |
| Chat detail/tree (`readLive`) | project chat → 404, incl. the denied user's **own** chat |
| Recent + Chats list | denied owner's project chats absent |
| FTS search + `resolveMatch` | no hits, no match |
| Shared-with-me | project chats can never appear (no share rows possible) |
| SSE replay start | subscribe → 404 before first event |
| SSE live stream | denied mid-stream → closes ≤ revalidation interval, client shows not-found |
| Run start in project chat | denied editor → 404 (chat invisible); never reaches admission |
| **Running chat owned by the denied user** | next capability phase → run fails `AI_ACCESS_REVOKED`, `chat.run_finished.v1` failure audit, terminal reference — the existing F5 access-loss path (`approval.service.ts` precedent) |
| Org metadata list (admin who is denied on P) | row absent — deny beats admin (NFR item 172) |
| Member/deny/share management on P | all → 404 (project invisible) except org admin paths, which succeed but operate on the deny table |
| Share list on a standalone chat owned by denied user | unaffected (deny is per-project) — asserted to catch over-broad predicates |
| pg_notify title fan-out | denied user receives no `chat.invalidated` for that chat (existence must not leak) |

## 7. TenantGuard — narrow per-route allowance

`tenant.guard.ts` rejects `userId` (and other tenant-override keys) in
query/body on all workspace routes. F6 endpoints that legitimately take a
target user id:

- `POST /projects/:id/members` body `{userId, role}`
- `PATCH /projects/:id/members/:userId` (path only — no body key needed;
  `project_members` is keyed by `(org,project,user)`, no surrogate id)
- `POST /org/projects/:id/denies` body `{userId}` (or `{userIds}`)
- `POST /chats/:id/shares` body `{userIds}`

Change: extend `ROUTE_ACCESS` metadata with an opt-in key list, e.g.
`allowUserIdKey: true` (or `allowBodyKeys:['userId']`), applied per-method on
those controllers only. The guard's rejection list stays unchanged
otherwise; the allowance is keyed to the exact route, not the key name
globally. The service layer then re-validates the target (`ops.lexon_org_member`
+ Better Auth membership via `OrganizationAuthPort`), so a userId key cannot
escape the tenant.

**Test (spec'd for the plan):** a route-inventory spec iterates every
registered controller workspace route and asserts a `userId` body key is
rejected — with an explicit allowlist equal to the F6 routes above; a second
spec hits each allowed route with a valid org-member userId (passes) and a
non-member userId (refused).

## 8. Project deletion

Owner-only, confirmation names `chat_count` (brief item 8). Chats cannot be
touched by the project owner's claim through the per-chat fence
(`ops.ai_mark_chat_deleted` verifies caller = chat owner — project chats of
**other** members would refuse). So a new `ops.project_delete`-style
`SECURITY DEFINER` primitive in one transaction:

1. verifies caller = `projects.owner_user_id` and locks the project row;
2. marks every project chat `deleted_at` — the same tombstone semantics as
   `ops.ai_mark_chat_deleted` — fencing active runs and emitting each
   chat's deletion outbox/notify records exactly as F4 single-chat delete;
3. deletes the `projects` row (`project_members`/`project_denies` cascade;
   `chats.project_id` goes `SET NULL`).

The tombstoned chats are now invisible everywhere and the existing F4
cleanup sweep hard-deletes them and their runs on schedule — no new
hard-delete path. Audited with `chatCount`. Plan-phase check: the worker's
mid-run next read sees the tombstone before the sweep, identical to F4.

## 9. `project-chat` run profile + project context provider + capability policy

- `CHAT_PROFILES['project-chat']` (`chat-profiles.ts`): same engines, tools,
  limits, and `contextBudgets` shape as `chat`, plus a `project` context
  entry (budget ~2,000 tokens; plan pins the number against the provider's
  context table).
- `ProjectContextProvider` implements the existing `ContextProvider`
  contract `{id:'project', version, collect({actor,runId,input,budget})}`
  and emits `ContextPiece[]` containing project name + instructions as
  delimited untrusted data (§4.7/`untrusted-context.ts` — instructions are
  untrusted, never grant tools, never change the model, never affect
  approvals).
- Registration: `createProductionRunRegistry([history, project])` in
  `chat-runtime.providers.ts` — **no engine branches**; the provider is
  selected purely by the profile's context list.
- Profile selection at admission: `ChatService.startChat` reads
  `chats.project_id` and sets `profileId='project-chat'` on the run's
  `resolved_config`; standalone chats keep `chat`. `chat_runs.kind`/profile
  resolution unchanged.
- **Capability recompute at start and resume** (brief item 23): extend
  `auth.lexon_ai_actor_facts` (`RunActorFactsRepository`, SECURITY DEFINER)
  to additionally return, for the chat in `resourceIds[0]`:
  `projectId`, `ownerProjectRole` (`'owner'|'editor'|'viewer'|null` — the
  **chat owner's** project standing, not the caller's), and
  `ownerDenied` boolean. `decideRunCapabilities` (capability-policy.ts)
  gains one rule: for `project-chat` runs, require
  `ownerProjectRole IN ('owner','editor') AND NOT ownerDenied`, else
  `AI_ACCESS_REVOKED`. Because `authorize` already runs at start, resume,
  tool, decision, and cancel phases, a mid-run demotion or deny fails the
  run on the next phase with the F5 access-loss path (failure + audit +
  terminal stream reference) — no new machinery.
- A viewer can never start a run (no composer, no admission — the chats
  INSERT gate and the service both refuse).

## 10. Sharing (standalone chats)

- `chat_shares` + endpoints: list shares (owner), add recipients (owner,
  org members only, chat must have `project_id IS NULL`), revoke (owner).
  Recipients get read-level access via the predicate.
- Recipient view: read-only client state — no composer, edit, regenerate,
  feedback, rename, delete, decision controls; label "Shared by <name> ·
  read-only"; pending-operation panels hidden; "Waiting for <owner>".
- Revocation/leaving: access ends on next request; open stream closes ≤ 5 s.
- Share rows self-invalidate on project chats at the predicate level
  (`project_id IS NULL` arm), so a share can never follow a chat into a
  project even if one were moved later.

## 11. Contracts (`shared/`)

New Zod schemas (all `strictObject`, existing error contract):

- `ProjectCreateInput` `{name, matterNumber?, practiceArea?}`;
  `ProjectSettingsInput` (same fields); `ProjectInstructionsInput`
  `{instructions ≤8000 chars}`.
- `ProjectRoleSchema = 'viewer'|'editor'`; `ProjectAccessSchema =
  'owner'|'editor'|'viewer'`.
- `MemberAddInput {userId, role}`; `MemberRoleInput {role}`;
  `DenyAddInput {userId}`; `ShareAddInput {userIds: uuid[] 1..50}`.
- `ProjectSummary` (id, name, matterNumber, practiceArea, owner, myRole,
  memberCount, chatCount, lastActivityAt) + `ProjectPage`;
  `OrgProjectSummary` (metadata only, no instructions);
  `ProjectMemberSummary` (memberId/userId/name/email/role — names resolved
  via `OrganizationAuthPort`/`listMembers`, same as membership.service);
  `DenySummary`, `ChatShareSummary`.
- `MattersListQuery {q?, filter:'all'|'owned'|'shared', sort:'name'|'activity',
  cursor?, limit?}`; `OrgProjectsQuery {q?, cursor?, limit?}`.
- `OrgMemberSearchQuery {q, limit?}` → `OrgMemberSummary` for the
  member/share pickers (name-or-email search over current org members;
  implemented via `OrganizationAuthPort`/`listMembers` — plan verifies the
  plugin's filterField covers user name/email or uses a bounded
  fetch-and-filter; denied members are marked unavailable only in the
  project-members picker response, never in org search).
- `ChatPage` item gains optional `projectName` (secondary text on own
  project chats — additive field).
- `ChatAccessSchema` on the chat detail payload — `'owner'|'reader'` so the
  client renders composer vs read-only/"Waiting for <owner>" without
  inferring from ids. (Additive.)

## 12. Routes (shape; exact paths in plan)

- `GET/POST /projects` (list = Matters page; create), `GET/PATCH/DELETE
  /projects/:id`, `PATCH /projects/:id/instructions` (owner+editor),
  `GET /projects/:id/chats`.
- `GET/POST /projects/:id/members`, `PATCH/DELETE
  /projects/:id/members/:userId` (owner).
- `GET /org/projects` (owner/admin metadata list), `GET/POST/DELETE
  /org/projects/:id/denies` (owner/admin).
- `GET /org/members/search?q=` (member/share pickers, §11
  `OrgMemberSearchQuery`).
- `GET/POST /chats/:id/shares`, `DELETE /chats/:id/shares/:shareId`,
  `GET /chats?scope=shared` (shared-with-me).
- Sidebar Matters group = `GET /projects?sort=activity&limit=5` (or a
  dedicated `recent` scope).

All routes sit behind the existing tenant claim fence; project routes are
`workspace` RouteAccess kind; the four target-user routes carry the §7
allowance.

## 13. Audit (K3 — ids and metadata only, never names/numbers/instructions/content)

New event types in `audit-event.ts` + validator, appended through the
existing audit service / `appendAuthAudit` in the same transaction:

- `project.created.v1`, `project.settings_updated.v1`,
  `project.instructions_updated.v1`, `project.deleted.v1` (metadata:
  `chatCount`);
- `project.member_added.v1`, `project.member_role_changed.v1`,
  `project.member_removed.v1` (subjectUserId, role fields);
- `project.deny_added.v1`, `project.deny_lifted.v1` (actor = org owner/admin;
  subjectUserId, setByUserId);
- `chat.shared.v1`, `chat.share_revoked.v1`.
- Deny-add that removes a member row emits both `project.deny_added.v1`
  and `project.member_removed.v1` (reason `deny`) — two concurrent admin
  deny/lift ops commit in row order, both audited (edge case item 149).

## 14. Performance gate

Seed: org with 500 projects, 50 members. Asserted in CI (same shape as the
F4 search gate: `EXPLAIN (ANALYZE)` plan artifact + p95 wall-clock under the
CI runner):

- Matters list (member join + NOT-denied probe + sort): index plan —
  `projects_org_activity` or `projects_org_name` + PK lookups on
  `project_members`/`project_denies`; blocking gate **p95 < 1,000 ms**;
  warning if > 300 ms.
- Org metadata list: same with the `ops.lexon_org_owner_admin` arm; the
  admin EXISTS is one `auth.member` PK lookup per page, not per row, via
  the definer's STABLE marking… verified in the plan's evidence (if the
  definer cannot be inlined, the admin check moves into a per-query
  lateral/CTE — plan must show index shape, no seq scans on
  `project_members`/`project_denies` beyond PK probes).
- Chat list with the widened predicate: three EXISTS arms, all indexed
  (`project_members(org,project,user)`, `projects(org,id)`,
  `chat_shares(org,chat,user)`); owner arm stays the
  `chats_owner_activity` index scan. Plan-shape evidence required.
- Benchmark script follows `testing/chat-search-benchmark.ts` precedent;
  output lands in `docs/references/F6-*-gate.jsonl`.

## 15. Security & tenancy negatives (API + RLS each)

Cross-org: member of org B sees/acts on nothing in org A (projects, chats,
member lists, denies, shares). Cross-project: member of project A cannot
read project B. Role: viewer cannot start chats/edit instructions (403);
editor cannot change settings/members/delete (403); non-owner cannot send in
another's chat (403 if member, 404 if non-member/denied — item 150).
Deny beats editor, beats org owner/admin, beats chat ownership (own project
chat → 404). Org owner/admin without membership cannot open chats or
instructions (decision 4). Platform admin sees nothing (§6.2). Removed org
member loses everything. Identical 404 for does-not-exist / non-member /
denied. Prompt-injection evals: instructions attempting unapproved rename,
cross-project disclosure, or capability claims have no effect (new
`evals/test/project-instructions.spec.ts` alongside `injection-tools.spec.ts`).

## 16. Frontend

- `ChatQueryScope` gains `shared` (Chats page filter); Recent keeps own
  scope; `chatListQueryKey` extended (chat-history.tsx already keys by
  scope — line ~44).
- New routes: `/matters` (list, data-views kit §5.7), `/matters/[id]`
  (project page), settings dialog → Matters tab (org metadata + restrict),
  share dialog (chat menu, team orgs, hidden on project chats),
  new-matter dialog, members dialog, delete confirmation, instructions
  panel (read/edit by role), project chat read-only view, shared chat
  read-only view, not-found reuse.
- The chat detail contract's `access` field drives composer-vs-read-only,
  panel hiding, and the "Waiting for <owner>" marker (items 18/24); the
  "Shared by <name> · read-only" label likewise.
- `chat.invalidated` handling already refetches lists/tree — access-revoked
  events land on the same handler; open streams closed by the server show
  the existing not-found state.

## 17. Visual / prototype

- `PROTOTYPE_REVISION` 17 → 18 in `scripts/visual-compare-prototype.mjs`;
  README lead line gains revision 18 (F6 Matters).
- The 16 `planned` Matters ids in `index.json` move to `pending` on first
  capture (states: matters-list, matters-empty, matter-new, matter-owner,
  matter-viewer, matter-instructions-edit, matter-members, matter-delete,
  matter-chat, matter-chat-readonly, settings-matters,
  settings-matters-restrict, chat-share, chat-shared-readonly, chats-shared,
  matter-personal — all `screens/r14/`).
- Owner eye review of CI sheets before any `approval.json` or golden
  writes; at most 2 Linux UI rounds.

## 18. Architecture spec state

LEX-ARC-001 v1.8 (already on main, changelog dated 2026-11-25) resolves the
brief-decision-1 conflict: §3.2 now reads "access to a project/matter is
based on explicit membership… in the MVP this is not configurable per
organization", and the deny list is owner/admin-set only. No spec text
changes are needed in this PR — this design conforms to §3.2 as revised,
and §4.7's run-profile/context-provider model, §5.1 untrusted-context
rules, and §6 audit/privacy rules all hold as written.

## 19. Key decisions (with alternatives)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D1 | `chats.project_id` column | separate `project_chats` join table | Decision 7 fixes the binding at creation → a column + FK is strictly simpler; one fewer join in every predicate; immutability enforced by column grant. |
| D2 | Owner on `projects.owner_user_id`; members table holds only viewer/editor | owner as a member row | Matches brief entity shape and `chats.owner_user_id` precedent; the "one owner" invariant is structural, not a partial-unique index. |
| D3 | Deny removes the member row at once | member row + deny flag overlay | Brief item 14: "removes any existing project role at once"; lifting doesn't restore. Overlay would keep hidden state and a second path to bugs. Predicate still checks deny first (deny wins even for owners, whose row can't be removed). |
| D4 | `ops.lexon_org_member` / `ops.lexon_org_owner_admin` SECURITY DEFINER predicates | inline `EXISTS auth.member` in policies | `lexon_app` already has column grants; a definer keeps auth access behind a fixed-search-path boundary consistent with 0027/0028 precedent and gives one definition shared by app predicate and RLS. |
| D5 | Title-notification payload drops `userId`, server fans out per access rule | keep per-user notify at write time | Writers don't know the full audience; fan-out at emit time evaluates the live predicate per connected org user — correct under membership/deny changes between write and notify. Denied users are excluded to avoid existence leaks. |
| D6 | `project-chat` profile reuses `chat`'s engines/tools + project context | engine branches or new tools | LEX-ARC-001 §4.7; registry selects contexts by profile — zero engine changes; capabilities decide rights, instructions never do. |
| D7 | FTS search stays owner-only | widen search to readable chats | Explicitly F8 scope (brief out-of-scope). The `D` clause still joins the owner CTE so denied owners lose their own hits. |
| D8 | Shares only honored when `project_id IS NULL` | forbid share rows on project chats by trigger alone | Self-correcting predicate — a share row can never grant project access even if written out-of-band; service still refuses to create one. |
| D9 | Project delete via new definer that marks each chat deleted | reuse per-chat owner fence | Project owner isn't the chat owner of members' chats; the F4 tombstone + cleanup sweep semantics are reused, only the authorization arm differs. |
| D10 | `member_count`/`chat_count`/`last_activity_at` denormalized by triggers | compute in queries | Admin metadata list needs the count without member-row SELECT; Matters list sorts by activity — per-row aggregation across 500 projects fails the perf gate shape. |

## 20. Research notes

| Source | Version / date | What it supports |
|---|---|---|
| [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [function security](https://www.postgresql.org/docs/17/perm-functions.html) | docs read 2026-11-25 against installed PG 17.11 | Permissive policies OR, RESTRICTIVE AND — hence the restrictive `*_owner_run` policies must split per command so SELECT can widen while writes stay owner. FORCE RLS + fail-closed `NULLIF` form unchanged. SECURITY DEFINER with fixed `search_path` for `ops.*` predicates. |
| Installed packages | `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-auth@1.7.14`, `@nestjs/core@12.3.2`, `pg@8.23.1`, `zod@4.6.7`, `next@16.4.6`, `ai@7.0.159`, `typescript@6.0.3` | No version changes; raw-SQL migrations + `schema.ts` updates per existing convention. |
| Better Auth [organization plugin](https://better-auth.com/docs/plugins/organization.md) (`llms.txt` in `.cache/docs/better-auth/`) | 1.7.14 / 2026-11-25 | Member search for the picker and member facts go through `tx.call('listMembers'| 'lexonOrganizationFacts')` on `OrganizationAuthPort` (membership.service precedent) — not raw `auth.member` reads; `lexon_app` keeps only the §4-column grant for predicate EXISTS. |
| Drizzle [transactions](https://orm.drizzle.team/docs/transactions), [indexes/constraints](https://orm.drizzle.team/docs/indexes-constraints) | 0.45.4 / 2026-11-25 | New-table definitions and index declarations follow `schema.ts` conventions; `searchVector`-style generated columns not needed. |
| F4 spec research notes R25–R28, F4-search gate (`docs/references/F4-search-*-gate-*.jsonl`) | 2026-11 | Restricive-policy split precedent, definer-fence precedent (`ai_chat_run_is_associated`, `ai_mark_chat_deleted`), gate file format, `NULLIF` fail-closed form. |
| F5 spec §6.5 + code (`run-events.service.ts`, `approval.service.ts`, `capability-policy.ts`, `step-executor.ts`) | merged `790b61a2` | `REVALIDATION_INTERVAL_MS=5000` stream-close path; `decideRunCapabilities` phases (start/resume/tool/decision/cancel); `AI_ACCESS_REVOKED` access-loss flow with `chat.run_finished.v1` audit; `lexon_ai_actor_facts` extension point. |
| F5 acceptance (`docs/references/F5-acceptance.md` task 6/10) + `expiry-sweep.ts`, `step-coordinator.ts`, `chat-stream.ts`, `brand-visual-support.ts`, `chat-tools.spec.ts` | merged | The four Task-0 minors: shared routing check (1–10 safe int), `tool-input-available` over-cap input retention, worker-sweep return assertion, a11y header citation (`runBrandAxe`/`captureBrandViews`). |

## 21. Builder check (self-review)

| Q | A |
|---|---|
| Every brief item mapped? | Items 1–26 map to §2–§17; NFRs to §14–§15; decisions 1–9 to §3–§9/§18. |
| One rule, one place? | §4.1 builder + §4.2 mirror; every read path enumerated in §5 uses it; owner-scope retained only where writes/owner-only semantics are required (FTS, fences). |
| Deny beats everything? | `D` clause precedes all grant arms incl. `owner_user_id`, project owner, org admin; assertable via the §6 matrix incl. denied-owner's own chat → 404. |
| Identical 404 vs 403 split? | Non-member/denied → 404; member-without-capability → 403 (item 150) — spec'd in §6 and the route table. |
| No engine branches? | Profile + context registration only (`createProductionRunRegistry`); capability gate is data-driven via actor facts. |
| K1 privacy? | No names/numbers/instructions/titles in notify payloads, audit metadata, logs, or metrics; payload is `{orgId,chatId}` content-free. |
| Perf gate? | §14 blocking/warning thresholds + plan-shape evidence + benchmark artifact path. |
| Task 0 first? | §2 is the first task; each minor names file + RED shape. |
| TenantGuard surface? | §7 allowance is per-route metadata; inventory test proves nothing else changed. |
| Open questions for owner? | None — brief decisions 1–9 settle all previously open points; plan-phase verifications listed below are implementation checks, not product questions. |

### Plan-phase verification points (not product decisions)

- Confirm `ai_attempts` carries an owner-run restrictive policy needing the same split (0027 covers `ai_steps`/`ai_checkpoints`/`ai_operations`; `ai_attempts` has lifecycle internal policies — verify at write-up).
- Confirm `chat.invalidated` `chatId:null` refresh semantics end-to-end in the client before using it for access-change fan-out (schema already allows null).
- Pick the `project` context token budget against the provider's context table in `chat-profiles.ts`.
- Confirm the admin-list definer inlines acceptably under the perf gate; if not, restructure as a per-query CTE.
- The exact shared priority helper for Task 0.1 (single helper imported by both `expiry-sweep.ts` and `step-coordinator.ts`).

## 22. Task outline (for the plan phase)

1. Task 0 — four F5 minors (§2).
2. Contracts + schema/migration `0043` (tables, `chats.project_id`, RLS, grants, definer functions, indexes).
3. Authorization predicate builder + repository widening (all §5 paths).
4. Projects module (CRUD, instructions, members) + TenantGuard allowance.
5. Ethical wall (org metadata list, deny add/lift, deny matrix tests).
6. Chat sharing (shares CRUD, shared-with-me, recipient view).
7. Run profile + project context + capability gate + SSE widening.
8. Project deletion + audit events.
9. Frontend pages/dialogs + access-aware chat view.
10. Perf gate + injection evals + prototype revision 18 captures.
