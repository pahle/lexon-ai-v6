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
— refused with a clear message (brief decision 3). An org owner/admin **may
deny themselves** (recusal) but **must not lift a deny whose subject is
themselves** — another owner/admin lifts it; enforced in the deny definer and
the service (§4.2, §6).

### 3.4 `app.project_instructions`

Separate table because RLS cannot restrict columns: an org owner/admin reads
`projects` rows for the metadata list and must never see instructions
(decisions 3/4).

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | PK with org_id; FK (org_id,project_id) → projects ON DELETE CASCADE |
| `text` | text NOT NULL | `CHECK (char_length(text) <= 8000)` |
| `updated_by_user_id` | uuid NOT NULL | last editor |
| `updated_at` | timestamptz NOT NULL | |

Row created lazily on first instructions save (plan may instead have the
project-create trigger insert an empty row — either way the API shape is
`instructions: string | null`). SELECT requires project access (viewer+);
INSERT/UPDATE/DELETE require owner/editor — **never** the org-admin arm.

### 3.5 `app.chat_shares`

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

### 3.6 `app.chats` change

Add `project_id uuid NULL` + FK (org_id,project_id) → projects **ON DELETE
SET NULL (project_id)** + index `chats_org_project`
(org_id,project_id,last_activity_at,id). Set once at creation; no
`UPDATE (project_id)` column grant for `lexon_app`, so the binding is
immutable at the privilege layer (decision 7). Existing rows get NULL
(standalone chats). `ON DELETE SET NULL (project_id)` uses the PG 15+
per-column form — a blanket `SET NULL` on the composite FK would try to
null `org_id` (NOT NULL) and fail. `SET NULL` (not `CASCADE`) because
project deletion reuses the F4 tombstone flow: the chats are first marked
`deleted_at` (fencing active runs, emitting per-chat outbox/notify
records), then the project row goes — the tombstoned chats become
invisible standalone rows that the existing cleanup sweep hard-deletes on
schedule (§8).

## 4. The one access rule

**Read access to a live chat** requires all of:

1. `org_id` = current tenant org and `deleted_at IS NULL`;
2. **deny wins:** if the chat has `project_id` P and a `project_denies` row
   exists for (org, P, caller), access is none — this beats ownership,
   project roles, and org owner/admin status;
3. at least one grant, **disjoint by `project_id`:** a *standalone* chat
   (`project_id IS NULL`) grants owner (`owner_user_id` = caller) or share
   (`chat_shares` row); a *project* chat grants **only** project access —
   `ops.lexon_project_access(org,P,caller) <> 'none'` — and that includes
   the chat's owner: ownership of a project chat conveys no read rights by
   itself. A denied **or removed** member loses their own chats in the
   project the same way;
4. current organization membership, enforced by the existing claim fence
   and session invalidation plus the shared `ops.lexon_org_member` check in
   the RLS predicate (brief item 11: "organization membership is required").

**Access level** for rendering/authorization: `owner` > `editor` > `viewer` >
none. On a chat: standalone chat owner or project-chat owner with access =
`owner`; other project roles = that role for project-page capabilities
(composer, instructions editing); share recipient = `viewer`. On a project:
`projects.owner_user_id` = owner, member row role otherwise, deny = none,
no row = none.

**Writes stay owner-only** (brief item 26). Project membership never grants
chat writes. Project writes: settings/members/delete = project owner;
instructions = owner or editor; chats-create-in-project = owner or editor
(they become owner of the new chat).

### 4.1 Application predicate (`authorization-predicate.ts`)

`authorization-predicate.ts` gains one scope kind — e.g.
`ChatReadAuthorizationScope` — whose builder emits the rule above as a single
composable predicate (params `$org`, `$user`). It calls the same definer the
policies call — the query runs under `lexon_app` RLS, so it cannot read
`project_members`/`project_denies` directly either:

```sql
c.org_id = $org AND c.deleted_at IS NULL
AND ops.lexon_org_member(c.org_id, $user)
AND ( (c.project_id IS NULL AND (
         c.owner_user_id = $user
         OR EXISTS (SELECT 1 FROM app.chat_shares s
              WHERE s.org_id=c.org_id AND s.chat_id=c.id AND s.user_id=$user)))
   OR (c.project_id IS NOT NULL
        AND ops.lexon_project_access(c.org_id, c.project_id, $user) <> 'none') )
```

`OwnedChatAuthorizationScope` (the owner-only scope used by writes and by
owner-scoped reads — FTS, Recent, Chats list, `resolveMatch`, `selectLeaf`)
gains the same disjunction at the owner arm: `owner_user_id = $user AND
(project_id IS NULL OR ops.lexon_project_access(org,project_id,$user) <>
'none')`. A project chat is "yours" only while you still have access to
its project — a denied **or removed** member loses their own project
chats on every owner-scoped path too (§6). Every read path in §5 uses the
new builder. There is no unfiltered path.

### 4.2 The access definers

Because subqueries inside policies run with the caller's privileges and RLS,
any policy-side read of `project_denies` or `project_members` is unsound (a
member's deny probe would always be empty, and `projects` ↔ `project_members`
policy cross-reads recurse — "infinite recursion detected in policy"). All
project-access evaluation therefore lives behind one `STABLE
SECURITY DEFINER` function — same pattern as `ops.ai_chat_run_is_associated`
(migration 0028): fixed `search_path`, `REVOKE … FROM PUBLIC, lexon_auth`,
`GRANT EXECUTE … TO lexon_app` only:

```text
ops.lexon_project_access(org_id uuid, project_id uuid, user_id uuid)
  → text IN ('owner','editor','viewer','none')
```

Evaluation order inside the function (all reads as the definer role, which
the internal `lexon_migrator` bypass policies admit):

1. Fail closed: `org_id`/`user_id` must equal the current tenant claims
   (`app.org_id`/`app.user_id`), else `'none'` — it can never be used to
   probe another user's standing.
2. `ops.lexon_org_member(org_id, user_id)` false → `'none'` (brief item 11).
3. `project_denies` row exists → `'none'` (**deny checked before owner**).
4. `projects.owner_user_id = user_id` → `'owner'`; else `project_members.role`.
5. Output is the level only — a single text value, no names/ids beyond the
   inputs (K3).

Companion definers (same hardening), target-parameterized so they can be
called on users other than the caller — they verify only the `org_id`
context match:

- `ops.lexon_project_denied(org_id, project_id, user_id) → bool` — deny
  rows for the admin arm, the member-add gate, and the deny-add/lift flow.
- `ops.lexon_org_member(org_id, user_id) → bool` — `auth.member`
  membership (`lexon_app` already holds `GRANT SELECT (id, user_id,
  organization_id, role)` from migration 0004).
- `ops.lexon_org_owner_admin(org_id, user_id) → bool` —
  `auth.member.role IN ('owner','admin')`.

Deny writes go through two more definers (no `lexon_app` INSERT/DELETE
policies on `project_denies` at all — deny-by-default):

- `ops.lexon_project_deny_add(org_id, project_id, actor, target)` — verifies
  actor is org owner/admin, refuses target = `projects.owner_user_id`
  ("the project owner cannot be denied"), upserts the deny row, deletes
  any `project_members` row for target — one transaction.
- `ops.lexon_project_deny_lift(org_id, project_id, actor, target)` —
  verifies actor is org owner/admin **and `actor <> target`** (no
  self-lift); deletes the deny row.

The service calls these definers after its own checks so refusals return
clear messages; the definers re-verify everything as the second layer.

### 4.3 RLS mirror — exact policy changes

Read policies widen to owner OR project access OR share; write policies stay
owner-only. No policy reads `project_denies`, `project_members`, `projects`,
or `auth.member` directly — every project/membership question goes through
the §4.2 definers. `u` below =
`NULLIF(current_setting('app.user_id',true),'')::uuid`; the tenant clause is
the existing `NULLIF` form.

**`app.chats`** — replace `owner_live_chat_select`:

```sql
DROP POLICY owner_live_chat_select ON app.chats;
CREATE POLICY chats_access_select ON app.chats FOR SELECT TO lexon_app
USING (
  org_id = NULLIF(current_setting('app.org_id',true),'')::uuid
  AND deleted_at IS NULL
  AND ops.lexon_org_member(org_id, NULLIF(current_setting('app.user_id',true),'')::uuid)
  AND ( (project_id IS NULL AND (
           owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
           OR EXISTS (SELECT 1 FROM app.chat_shares s
                WHERE s.org_id=chats.org_id AND s.chat_id=chats.id
                  AND s.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
     OR (project_id IS NOT NULL
          AND ops.lexon_project_access(org_id, project_id,
               NULLIF(current_setting('app.user_id',true),'')::uuid) <> 'none')));
```

The owner arm is deliberately disjoint by `project_id`: it grants nothing
on a project chat, so a denied member cannot read their own project chat
through ownership — the only path to a project chat is
`lexon_project_access <> 'none'`, and that definer checks deny before
owner. (`owner_live_chat_update` keeps `owner_user_id` plus the row
must already be visible via SELECT to be targeted, so denied owners are
blocked at read — rename, `viewed_leaf_id`, `active_answer_run_id` stay
owner paths; readers never mutate.)

`owner_live_chat_insert` gains the project-creation gate in its
WITH CHECK — editor-or-owner on the project, deny and membership already
inside the definer:

```sql
... AND ( project_id IS NULL
   OR ops.lexon_project_access(org_id, project_id,
        NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor'))
```

**`app.chat_runs`** — `owner_chat_run_select` (0027) becomes
`chat_run_access_select`: `EXISTS (SELECT 1 FROM app.chats c WHERE
c.org_id=cr.org_id AND c.id=cr.chat_id)` — the parent read is itself
RLS-filtered by `chats_access_select`, so the whole rule is inherited with
no project-table reads. `owner_chat_run_insert` stays owner-only.

**`app.chat_messages`** — `owner_chat_message FOR ALL` (0026) splits into
`chat_message_access_select` (same RLS-filtered `EXISTS` on the parent chat)
plus owner-only `FOR INSERT`/`FOR UPDATE`/`FOR DELETE` policies preserving
today's write behavior exactly (message inserts flow through the internal
mutation-request triggers as lexon_migrator regardless).

**`app.ai_runs`** — the RESTRICTIVE `ai_runs_owner_live_resource` (0028)
splits by command, because a member watching a project chat's run SELECTs
run rows under their own claim:

- `ai_runs_access_read` AS RESTRICTIVE FOR SELECT: the three existing arms,
  with the second arm's `initiating_user_id` + owner clause replaced by
  `EXISTS (SELECT 1 FROM app.chat_runs cr WHERE cr.org_id=ai_runs.org_id
  AND cr.run_id=ai_runs.id AND
  cr.chat_id::text=ai_runs.resolved_config->'resourceIds'->>0 AND
  jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1)` — the
  `chat_runs` read is RLS-filtered all the way to the chat predicate, so
  no user clause is needed. Queued-unassociated and zero-resource arms
  unchanged.
- `ai_runs_owner_live_write` AS RESTRICTIVE FOR INSERT/UPDATE/DELETE:
  identical to today's arms (`initiating_user_id=app.user_id` + owner-only
  `EXISTS chats` clause) — writes stay owner-only. Under the disjoint
  owner arm, that `EXISTS` still passes for an owner **with access**
  (their chat is visible) and fails for a denied owner — which is
  correct: ordinary run writes stop at access loss, and the finalization
  that must still commit runs through definers, not these arms (§4.4).

**`app.ai_steps`, `app.ai_checkpoints`, `app.ai_operations`** — same split of
their 0027 RESTRICTIVE `*_owner_run` policies: SELECT arm becomes an
RLS-filtered `EXISTS` over `chat_runs` for the row's `run_id`; write arms
keep `initiating_user_id = app.user_id` (owner-only). Unassociated/
zero-resource arms unchanged. `ai_attempts` gets the same split if it
carries an owner-run restrictive policy (plan verifies).

**Recursion analysis (why this terminates):** policy evaluation DAG —
`ai_*` → `chat_runs` → `chats` → {definers, `chat_shares`}. `chat_shares`
has no policy that reads `chats` (below), `chats` reads no
`chat_runs`/`ai_*`, and no table's policy reads `projects`,
`project_members`, `project_denies`, or `auth.member` (definer-only). No
cycle exists → no "infinite recursion detected in policy".

**New-table policies (`lexon_app`)**

- `projects` SELECT: `org` AND `ops.lexon_org_member` AND
  (`ops.lexon_project_access(org,id,u) <> 'none'`
   OR (`ops.lexon_org_owner_admin(org,u)`
       AND NOT `ops.lexon_project_denied(org,id,u)`)) — the admin arm feeds
  the metadata-only list; deny still beats admin.
- `projects` INSERT: `org` AND `owner_user_id = u` AND `ops.lexon_org_member`.
- `projects` UPDATE: `org` AND `ops.lexon_project_access(org,id,u) =
  'owner'` — owner-only now that instructions live in their own table.
- `projects` DELETE: `org` AND `ops.lexon_project_access(org,id,u) = 'owner'`.
- `project_members` SELECT: `org` AND
  `ops.lexon_project_access(org,project_id,u) <> 'none'`.
  INSERT/UPDATE/DELETE: `org` AND `ops.lexon_project_access(...) = 'owner'`;
  INSERT/UPDATE WITH CHECK additionally
  `ops.lexon_org_member(org_id, user_id)` on the target and
  `NOT ops.lexon_project_denied(org_id, project_id, user_id)` — a denied
  target can never be (re)added at the privilege layer either.
- `project_instructions` SELECT: `org` AND
  `ops.lexon_project_access(org,project_id,u) <> 'none'` — no admin arm.
  INSERT/UPDATE/DELETE: `org` AND
  `ops.lexon_project_access(org,project_id,u) IN ('owner','editor')`.
- `project_denies` SELECT: `org` AND `ops.lexon_org_owner_admin(org,u)`.
  **No** INSERT/DELETE policies — all deny writes go through the §4.2
  definers (self-lift and owner-deny refused inside).
- `chat_shares` SELECT: `org` AND (`user_id = u` OR
  `granted_by_user_id = u`) — deliberately reads no `chats` rows, which is
  what keeps the `chats` ↔ `chat_shares` pair acyclic; the owner's share
  list queries `granted_by_user_id = u` (granted_by is always the owner).
- `chat_shares` INSERT: `org` AND `granted_by_user_id = u` AND
  `ops.lexon_org_member(org_id, user_id)` on the target AND
  `EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_shares.org_id
  AND c.id=chat_shares.chat_id AND c.owner_user_id=u AND c.project_id IS
  NULL)` — the chats read passes through `chats_access_select` (owner arm),
  which terminates without reading `chat_shares` back via policy… the
  share arm's `chat_shares` EXISTS sees only the caller-visible rows and
  adds nothing the WITH CHECK doesn't already require.
- `chat_shares` DELETE: `org` AND (`granted_by_user_id = u` OR
  `user_id = u`) — recipient self-removal is harmless; the API only
  exposes owner-revoke.
- `project_chats` — not needed: `chats.project_id` column replaces a join
  table (decision 7, immutable binding).

**Required RLS-level tests** (as `lexon_app` with tenant claims set via
`set_config`, not through the service — `psqlInTenant` precedent): a denied
editor and a denied **project owner** (deny row inserted directly as
migrator, bypassing the service refusal, to prove deny > owner
structurally) get **zero rows** from `chats`, `chat_messages`, `chat_runs`,
`ai_runs`, `ai_operations`, `projects`, `project_members`,
`project_instructions`; no recursion error on any new-table SELECT; and the
`lexon_project_access` output column set is the level only.

Grants: `lexon_app` gets SELECT on all five new tables;
INSERT/UPDATE/DELETE on `project_members`, `project_instructions`,
`chat_shares`; INSERT/UPDATE/DELETE on `projects` (column grants excluding
`member_count`, `chat_count`, `last_activity_at`); SELECT only on
`project_denies`. `lexon_migrator` internal FOR ALL bypass policies on all
new tables (existing convention).

**Chat creation plumbing:** chats are materialized by the
`chat_create_requests` trigger (migration 0029). The request table gains a
nullable `project_id` column; the create-request INSERT policy applies the
same `lexon_project_access IN ('owner','editor')` gate as `chats` INSERT,
and the materialize trigger copies `project_id` onto the new chat row.
`chat_mutation_requests` needs no change — only the chat owner mutates a
chat, project or not.

### 4.4 Finalization and cleanup paths under access loss

Once a project chat is invisible to its owner, the F5 access-loss
finalization still has to commit under their claim: `runs.transition` →
`failed`, `rejectApprovalForAccessLoss`, the two `chat.*` audit appends,
`terminalStreamReference`, `#notifyChatInvalidated` (the
`approval.service.ts` sequence). Under the §4.3 rules every one of those
repository reads/writes returns zero rows — the run row itself is
invisible under `ai_runs_access_read` — so the path **cannot** run
through `lexon_app` claims at all. Rule:

- **No `lexon_app` write arm reads `app.chats` for finalization.** The
  `*_owner_live_write` arms intentionally fail for a denied owner
  (§4.3) — ordinary run writes stop, which is correct.
- **Finalization executes inside definer-backed primitives as the definer
  role** — the same family the F4 lifecycle recovery uses (R26: the
  expected-state finalizer definer that terminalizes status/sequence
  through the run trigger) and the actor-facts definer the capability
  gate already consults. Detection stays under the owner claim
  (`lexon_ai_actor_facts` returns `ownerDenied`/`ownerProjectRole` — it is
  itself a definer and sees everything); the transition + step/operation
  terminalization + audit append + terminal stream reference are executed
  by definer functions that return only ids/status, never content (K3,
  same shape as existing `ops.*` primitives). The plan maps the exact
  reuse: extend the existing finalizer or add
  `ops.lexon_ai_finalize_access_loss` — never widen any read policy to
  make finalization work.
- **The F4 deletion sweep, `ops.ai_mark_chat_deleted`, and the §8
  `ops.project_delete` definer touch tombstoned or newly invisible chats
  the same way** — they run as `SECURITY DEFINER` or `lexon_migrator`
  internal-policy paths, never through `chats_access_select`.
- `ops.ai_mark_chat_deleted` gains the project-access clause for project
  chats (`lexon_project_access <> 'none'`, fail closed) so a denied owner
  cannot tombstone a chat they can no longer see — the service 404s
  first either way.

**Integration test (required):** deny the chat owner mid-run → the run
ends `failed` with `AI_ACCESS_REVOKED`, **exactly one**
`chat.run_finished.v1` audit event, a terminal stream reference is
produced, and no retry loop or error storm (watch the worker log). A
member removed from the project without a deny finalizes identically.

## 5. Read-path inventory — every existing read path and how it gets the rule

| # | Read path | Code location today | F6 handling |
|---|---|---|---|
| 1 | Sidebar **Recent** + Chats page list | `ChatSearchRepository.list` | **Recent and Chats list the user's own chats** (brief items 19, 25) — `OwnedChat` scope with the project-access disjunction on the owner arm (`owner AND (project_id IS NULL OR lexon_project_access<>'none')`) — a denied **or removed** member loses their own project chats here too — plus a join to `projects` for the project-name secondary text on own project chats still accessible. |
| 2 | Chats page **"Shared with me"** filter | new scope on the same list endpoint | `chat_shares` arm only (project chats can never appear here). |
| 3 | Chat **search** (FTS) | `CHAT_SEARCH_SQL` `owner_chats` CTE | Stays owner-only (FTS over others' chats is F8). The CTE gains the same `project_id IS NULL OR lexon_project_access<>'none'` conjunct, so a denied or removed owner gets no hits on their own project chats. |
| 4 | `resolveMatch` (search → message navigation) | `ChatSearchRepository.resolveMatch` | Same owner+project-access scope. |
| 5 | Chat **detail / tree** | `ChatRepository.readLive` | Full new predicate (owner/project/share, deny-wins). |
| 6 | `lockLive` | `ChatRepository` | Owner+access scope — a denied/removed member can't take the write fence on their own project chat. |
| 7 | `rename` | `ChatRepository` | Owner+access scope. |
| 8 | `selectLeaf` (viewed-leaf write) | `ChatRepository` | Owner+access scope; readers do not move the owner's leaf. |
| 9 | `markDeleted` | `ops.ai_mark_chat_deleted` fence | Owner+access scope — the definer gains the `lexon_project_access<>'none'` fail-closed check for project chats (§4.4); project deletion gets its own definer (§8). |
| 10 | **SSE replay + live** | `AiRunRepository.authorizedChatSnapshot`, `AiStepRepository.stream*Proof` chain in `chat-runtime.providers.ts` | Widened to the read predicate (viewer-level grants stream access). Every per-drain re-check re-evaluates it → revocation closes the stream ≤ `REVALIDATION_INTERVAL_MS` (5 s). |
| 11 | **Run context** (`historyForRun`, history collect) | `ChatMessageRepository`, `ChatHistoryContextProvider` | Owner-scope — only chat owners run chats. The owner-denied/removed case is caught before collect by the capability gate (§9). |
| 12 | **Title invalidation** fan-out | `pg_notify('lexon_chat_title', {orgId,userId,chatId})` → `PgNotificationListener` → `RunEventsService` pendingChatIds | Payload drops `userId` → `{orgId,chatId}` (content-free). Server fans out to each connected user of that org **that currently passes the read predicate** (owner ∪ project members ∪ share recipients). Denied/removed users are deliberately not notified — their stale view is corrected by §10's stream close and by refetch 404s; notifying them would leak the chatId. Schema `ChatTitleNotificationSchema` and the listener parse updated; `chatId`-null `invalidateAll` path unchanged. |
| 13 | Access-change invalidation (member removed, deny set, share revoked, role change) | new emits on `lexon_chat_title` / `chat.invalidated` | Member/deny/share mutations emit `chat.invalidated` (`chatId:null` = refresh) to the affected user(s) — the target always gets it (they must refetch and hit 404s), plus project members when their visible set changed. Reuses the existing channel and event schema — no new channel. |
| 14 | F5 **operation/approval/question reads** (dock panels) | run snapshot serialization | Run/step rows become readable by viewers via §4.3, but **panels render only for the chat owner** — operation payloads are filtered out of the snapshot serialization for non-owner callers; waiting marker reads "Waiting for <owner>" (brief items 18, 24). API-level: decision endpoints stay owner-only (capability policy). |
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
| **RLS level (as `lexon_app` + `set_config`, not via service)** | denied editor **and denied project owner** (deny row inserted as migrator to prove deny > owner structurally): zero rows from `chats`, `chat_messages`, `chat_runs`, `ai_runs`, `ai_operations`, `projects`, `project_members`, `project_instructions`; no recursion error on any new-table SELECT; `lexon_project_access` returns the level only |
| **Member removed without a deny** | member row deleted → their own project chats vanish from `chats`, `chat_runs`, `ai_runs`, FTS, Recent and the Chats list (`lexon_project_access` = 'none' — owner arm gives nothing on `project_id IS NOT NULL`) |
| Access-loss finalization | deny the chat owner mid-run → run `failed`/`AI_ACCESS_REVOKED`, **exactly one** `chat.run_finished.v1`, terminal stream reference produced, no retry loop (§4.4) |
| Org admin (non-member) instruction probe | zero rows from `project_instructions` at the RLS level — the admin arm does not exist on that table |
| Self-lift | admin who denied themselves calls deny-lift → refused by service and by `lexon_project_deny_lift` definer; another admin lifts successfully |

## 7. TenantGuard — narrow per-route allowance

`tenant.guard.ts` rejects `userId` (and other tenant-override keys) in
query/body on all workspace routes. F6 endpoints that legitimately take a
target user id:

- `POST /projects/:id/members` body `{userId, role}`
- `PATCH /projects/:id/members/:userId` (path only — no body key needed;
  `project_members` is keyed by `(org,project,user)`, no surrogate id)
- `POST /org/projects/:id/denies` body `{userId}` (or `{userIds}`)
- `POST /chats/:id/shares` body `{userIds}`
- `DELETE /chats/:id/shares/:userId` — recipient keyed by `(org,chat,user)`,
  no surrogate id; path param only, so it needs no allowance but is listed
  for the inventory |

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
3. deletes the `projects` row (`project_members`/`project_denies`/
   `project_instructions` cascade; `chats.project_id` goes
   `SET NULL (project_id)`).

The tombstoned chats are now invisible everywhere and the existing F4
cleanup sweep hard-deletes them and their runs on schedule — no new
hard-delete path. Audited with `chatCount`. **Deletion test:** after
project delete, zero chats with `deleted_at IS NULL` that belonged to the
project (and `project_id IS NULL` on the tombstoned rows); members' own
tombstoned chats are invisible to them on every read path. Plan-phase
check: the worker's mid-run next read sees the tombstone before the
sweep, identical to F4.

## 9. `project-chat` run profile + project context provider + capability policy

- `CHAT_PROFILES['project-chat']` (`chat-profiles.ts`): same engines, tools,
  limits, and `contextBudgets` shape as `chat`, plus a `project` context
  entry (budget ~2,000 tokens; plan pins the number against the provider's
  context table).
- `ProjectContextProvider` implements the existing `ContextProvider`
  contract `{id:'project', version, collect({actor,runId,input,budget})}`
  and emits `ContextPiece[]` containing project `name` (`projects`) +
  instructions `text` (`project_instructions`) as delimited untrusted data
  (§4.7/`untrusted-context.ts` — instructions are untrusted, never grant
  tools, never change the model, never affect approvals). It reads under
  the owner's claim through the normal RLS policies — an owner denied on
  the project fails the capability gate before collect.
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
- `GET/POST /chats/:id/shares`, `DELETE /chats/:id/shares/:userId`,
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
- Org metadata list: same with the `ops.lexon_org_owner_admin` +
  `ops.lexon_project_denied` arms — STABLE definers are per-row calls, so
  the gate's evidence must show PK-lookup cost on `auth.member`/
  `project_denies` inside the function, not per-row seq scans.
- Chat list with the widened predicate: owner arm stays the
  `chats_owner_activity` index scan; the project arm is one
  `lexon_project_access` call per row (PK lookups on
  `projects`/`project_members`/`project_denies` inside); the share arm is
  an indexed `chat_shares(org,chat,user)` EXISTS. Plan-shape evidence
  required — if per-row definer cost fails the gate, the plan may
  materialize the caller's project-access set in a per-query CTE
  (decided on measured evidence, not guessed).
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
| D4 | All project access evaluation behind `ops.lexon_project_access` (+ `lexon_project_denied`, `lexon_org_member`, `lexon_org_owner_admin` definers) | inline `EXISTS` on `project_members`/`project_denies`/`auth.member` in policies | Policy subqueries run under the caller's RLS — a member's deny probe would always be empty, and `projects`↔`project_members` cross-reads recurse. One STABLE definer (0028 precedent) fixes both and gives the app builder and every policy one definition. |
| D4b | Instructions in `app.project_instructions` | column on `projects` | RLS can't restrict columns — the admin metadata arm would leak instructions. Separate table has no admin arm; `projects` UPDATE becomes cleanly owner-only. |
| D4c | Deny writes via `lexon_project_deny_add`/`deny_lift` definers, no lexon_app write policies | lexon_app INSERT/DELETE policies on `project_denies` | The deny→member-row removal must be atomic under one actor whose RLS can't delete the member row; self-lift and owner-deny invariants live in one place next to the write. |
| D5 | Title-notification payload drops `userId`, server fans out per access rule | keep per-user notify at write time | Writers don't know the full audience; fan-out at emit time evaluates the live predicate per connected org user — correct under membership/deny changes between write and notify. Denied users are excluded to avoid existence leaks. |
| D6 | `project-chat` profile reuses `chat`'s engines/tools + project context | engine branches or new tools | LEX-ARC-001 §4.7; registry selects contexts by profile — zero engine changes; capabilities decide rights, instructions never do. |
| D7 | FTS search stays owner-only | widen search to readable chats | Explicitly F8 scope (brief out-of-scope). The `D` clause still joins the owner CTE so denied owners lose their own hits. |
| D8 | Shares only honored when `project_id IS NULL` | forbid share rows on project chats by trigger alone | Self-correcting predicate — a share row can never grant project access even if written out-of-band; service still refuses to create one. |
| D9 | Project delete via new definer that marks each chat deleted | reuse per-chat owner fence | Project owner isn't the chat owner of members' chats; the F4 tombstone + cleanup sweep semantics are reused, only the authorization arm differs. |
| D10 | `member_count`/`chat_count`/`last_activity_at` denormalized by triggers | compute in queries | Admin metadata list needs the count without member-row SELECT; Matters list sorts by activity — per-row aggregation across 500 projects fails the perf gate shape. |

## 20. Research notes

| Source | Version / date | What it supports |
|---|---|---|
| [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [function security](https://www.postgresql.org/docs/17/perm-functions.html), [FK referential actions](https://www.postgresql.org/docs/17/ddl-constraints.html) | docs read 2026-11-25 against installed PG 17.11 | Permissive policies OR, RESTRICTIVE AND — hence the restrictive `*_owner_run` policies split per command. Policy subqueries run with the caller's privileges and RLS — the reason every project/membership probe lives in STABLE SECURITY DEFINER functions (§4.2) and `chat_runs`/`chat_messages`/`ai_*` read arms use RLS-filtered `EXISTS` on the parent chat. FORCE RLS + fail-closed `NULLIF` form unchanged. `ON DELETE SET NULL (column_list)` (PG 15+) on the composite `chats(org_id,project_id)` FK — blanket SET NULL would fail on `org_id NOT NULL`. |
| Installed packages | `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-auth@1.7.14`, `@nestjs/core@12.3.2`, `pg@8.23.1`, `zod@4.6.7`, `next@16.4.6`, `ai@7.0.159`, `typescript@6.0.3` | No version changes; raw-SQL migrations + `schema.ts` updates per existing convention. |
| Better Auth [organization plugin](https://better-auth.com/docs/plugins/organization.md) (`llms.txt` in `.cache/docs/better-auth/`) | 1.7.14 / 2026-11-25 | **Two distinct `auth.member` paths, on purpose:** the access predicate and RLS read `auth.member` only inside the §4.2 definers (queries run under `lexon_app` RLS, so they cannot use the port or the service layer); the member/share pickers and org-facts reads go through `tx.call('listMembers'/'lexonOrganizationFacts')` on `OrganizationAuthPort` (membership.service precedent — names/emails never enter `lexon_app` tables). `lexon_app` keeps only the 4-column grant, consumed solely by the definers. |
| Drizzle [transactions](https://orm.drizzle.team/docs/transactions), [indexes/constraints](https://orm.drizzle.team/docs/indexes-constraints) | 0.45.4 / 2026-11-25 | New-table definitions and index declarations follow `schema.ts` conventions; `searchVector`-style generated columns not needed. |
| F4 spec research notes R25–R28, F4-search gate (`docs/references/F4-search-*-gate-*.jsonl`) | 2026-11 | Restricive-policy split precedent, definer-fence precedent (`ai_chat_run_is_associated`, `ai_mark_chat_deleted`), gate file format, `NULLIF` fail-closed form. |
| F5 spec §6.5 + code (`run-events.service.ts`, `approval.service.ts`, `capability-policy.ts`, `step-executor.ts`) | merged `790b61a2` | `REVALIDATION_INTERVAL_MS=5000` stream-close path; `decideRunCapabilities` phases (start/resume/tool/decision/cancel); `AI_ACCESS_REVOKED` access-loss flow with `chat.run_finished.v1` audit; `lexon_ai_actor_facts` extension point. |
| F5 acceptance (`docs/references/F5-acceptance.md` task 6/10) + `expiry-sweep.ts`, `step-coordinator.ts`, `chat-stream.ts`, `brand-visual-support.ts`, `chat-tools.spec.ts` | merged | The four Task-0 minors: shared routing check (1–10 safe int), `tool-input-available` over-cap input retention, worker-sweep return assertion, a11y header citation (`runBrandAxe`/`captureBrandViews`). |

## 21. Builder check (self-review)

| Q | A |
|---|---|
| Every brief item mapped? | Items 1–26 map to §2–§17; NFRs to §14–§15; decisions 1–9 to §3–§9/§18. |
| One rule, one place? | §4.1 builder + §4.3 mirror; every read path enumerated in §5 uses it; owner-scope retained only where writes/owner-only semantics are required (FTS, fences). |
| Deny beats everything? | `lexon_project_access` checks `project_denies` before the owner check, so deny > ownership/roles/admin structurally — proven at the RLS level by inserting a deny row against a project owner as migrator (§6). |
| RLS-subquery soundness? | No policy reads `project_members`/`project_denies`/`projects`/`auth.member` directly (§4.3 header + recursion analysis); all project/membership evaluation is inside STABLE definers; `chat_runs`/`chat_messages`/`ai_*` read arms inherit the rule through RLS-filtered `EXISTS` on `chats`. |
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
