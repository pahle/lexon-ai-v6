# F6 — Projects & ethical wall

| Field | Value |
|---|---|
| **Depends on** | F5 (merged), F4 (chat, ownership, deletion fence), F1 (organizations, roles, personal workspace) |
| **Architecture** | [LEX-ARC-001](../specs/LEXON-02-SYSTEM-ARCHITECTURE.md) §3.2 (authorization predicate builder, RLS, ethical wall), §4.7 (run profile, context provider, capability policy), §5.1 (prompt injection), §6 (audit, K1/K3) |
| **Design system** | [LEX-DS-001 v3.5](../specs/LEXON-03-DESIGN-SYSTEM.md) §4 (sidebar group **Matters**), §5.3 (chat), §5.7 (data views kit) |
| **Visual target** | `docs/design/f4.1-prototype/` revision 18 (drawn and approved before planning; its new states enter `index.json` `planned` in the same PR) |

## Goal

Give lawyers a place per client matter. A **project** (shown as a **Matter** in the interface) holds the chats about one matter and instructions that the assistant follows in every chat inside it; documents (F7) and memory (F9) join it later. In a personal workspace a project works like a folder with instructions, private to its owner. In a team organization it is private by default and shared only with the colleagues the owner adds. An organization owner or admin can wall a member off a project (ethical wall) for a conflict of interest, and nobody below them can lift that wall. A chat outside any project can be shared read-only with colleagues.

## Users and permissions

| Who | Can | Cannot |
|---|---|---|
| **Project owner** (the creator) | Everything an editor can; edit the project's settings (name, matter number, practice area); add, re-role and remove members; delete the project | Add or re-add a member who is denied; lift a deny |
| **Project editor** | Open the project and every chat in it (read-only for chats of others); start their own chats in the project; edit the project instructions | Change settings or members; send in, edit, regenerate, rename, or delete another person's chat |
| **Project viewer** | Open the project, its instructions, and every chat in it, read-only | Start chats in the project; edit anything |
| **Organization owner or admin** | See the list of the organization's projects as metadata only (name, matter number, practice area, owner, member count); deny a member access to a project and lift that deny | Open a project's chats or instructions unless they are themselves a member and not denied (decision 3) |
| **Denied member** | Nothing on that project: it does not appear in lists, search, or links, and direct requests answer 404 | — |
| **Chat owner** | Share a chat that is not in a project, read-only, with members of the same organization; revoke shares | Share a project chat (access follows the project) |
| **Platform administrator** | Nothing new (LEX-ARC-001 §6.2) | Read any project, chat, or wall |

A project chat is still owned by the person who started it. Only that person sends messages, edits, regenerates, answers questions, decides approvals (F5), renames, or deletes it. Members of the project read it.

## Decisions already made (product owner, 2026-11-25)

1. **Private by default.** A new project in a team organization is visible only to its owner and the members the owner adds. An organization role never grants project access by itself. LEX-ARC-001 §3.2 ("configurable per organization") is revised in this PR to "explicit membership only in the MVP".
2. **Two member roles, like Claude projects:** **Viewer** (read) and **Editor** (read, start own chats, edit instructions). The creator is the single **owner**. Ownership transfer is out of scope (F18 offboarding).
3. **Ethical wall set by the organization, locked.**
   - An organization owner or admin denies a member access to a specific project; the deny is removed only by an organization owner or admin.
   - Deny overrides every role, including the denied person's organization role. The project owner cannot lift it or add the person back.
   - To set a deny, owners and admins see the project list as metadata only. They do not see chats or instructions.
   - The project owner cannot be denied on their own project (the request is refused with a clear message); ownership transfer is F18.
4. **No break-glass access in F6.** Organization owners and admins cannot open private project content. An audited emergency path for recovering a departing member's work belongs to F18 (offboarding).
5. **Read-only sharing of standalone chats.** The chat owner shares a chat that is not in a project with chosen members of the same organization. Recipients read it (the current tree, including updates on reload) and cannot send, edit, regenerate, decide, rename, or delete. The owner revokes a share at any time.
6. **Project fields:** name (required), client/matter number (optional), practice area (optional, free text), and instructions (optional).
7. **Chats are bound to a project when created.** A project chat is started from inside the project. Chats cannot be moved into or out of a project in F6, so a chat's audience never changes after it is created.
8. **Deleting a project deletes its chats.** Only the project owner deletes, after a confirmation that names the number of chats. The delete is permanent and reuses the F4 deletion fence for chats with active runs. Retention and legal hold are F18.
9. **F5 carry-over is task 0** (see item 1).

## In scope

### Task 0: F5 carry-over

1. Four minors from the F5 final review, each with a RED test first where behavior changes:
   - The expiry sweep's routing check accepts only a safe-integer priority from 1 to 10, the same rule as the step coordinator (share one helper). A candidate with an invalid priority is skipped and logged without K1, not retried forever.
   - The client keeps the reassembled tool input when a `tool-input-available` part arrives without `input` (over-cap fallback) instead of replacing it with `{}`.
   - The task-10 E2E asserts the worker sweep's return value.
   - The thread a11y spec header cites the correct source for the contrast pass.

### Projects

2. **Create:** from the Matters page or the sidebar, "New matter" opens a form with name, matter number, practice area. The creator becomes the owner. In a personal workspace the member controls are hidden.
3. **List (Matters page):** built from the data views kit (LEX-DS-001 §5.7).
   - Shows the projects the user can open, with name, matter number, practice area, owner, the user's role, chat count, and last activity.
   - Search by name, matter number, and practice area; filter "All / Owned by me / Shared with me"; sort by name or last activity; paged.
   - Empty state with "New matter".
4. **Sidebar:** the **Matters** group (LEX-DS-001 §4) lists the user's five most recently active projects and "View all matters".
5. **Project page:**
   - Header with the name, matter number and practice area, and actions by role (Settings, Members, Delete for the owner).
   - A composer that starts a new chat in the project (owners and editors only).
   - The project's chats: title, owner, and last activity, newest first.
   - The instructions panel: read for viewers, editable for owners and editors.
6. **Settings:** the owner edits name, matter number, and practice area.
7. **Instructions:**
   - Plain text, at most 8,000 characters, edited in a text field with a character counter. (Tiptap is allowed for project instructions by LEX-TS-001 but is not needed for plain text; it arrives with composer mentions.)
   - Every run in a chat of that project receives the current instructions through a project context provider (LEX-ARC-001 §4.7), placed as delimited untrusted data under the system rules. A change applies to the next run, not a running one.
   - Instructions can never grant tools, change the model, or override approvals; the capability policy ignores them.
8. **Delete:** owner only, confirmation names the chat count; deletes the project, its chats, and their runs (decision 8). Chats with an active run are fenced first, as F4 delete does.

### Members and roles

9. **Members dialog (owner):** search members of the same organization by name or email, add as Viewer or Editor, change role, remove. Denied members are shown as unavailable with no reason given to the project owner beyond "Access restricted by your organization".
10. **Effects are immediate:** a removed or re-roled member loses or changes access on the next request; an open project page or chat stream of a member who lost access closes within the existing stream revalidation interval (F4.2 A-04) and shows the not-found state.
11. **Organization membership is required:** access to any project requires current membership of its organization. A member who leaves or is removed from the organization loses every project role there. Their own project chats and their owned projects are handled by F18; in F6 they become unreachable to that person and stay readable to the remaining members.
12. **Request bodies:** the member endpoints accept a target user id. TenantGuard (F1) rejects `userId` keys today; add a narrow per-route allowance for these endpoints only, with a test that every other workspace route still rejects them.

### Ethical wall

13. **Organization settings → Matters** (owners and admins): a table of every project in the organization as metadata only (decision 3), searchable, with a per-project "Restrict access" action.
14. **Deny:** choose one or more organization members; each becomes denied on that project. A deny removes any existing project role at once and blocks future adds. The project owner cannot be denied.
15. **Lift a deny:** owners and admins remove it. Lifting does not restore the previous role; the project owner may add the person again.
16. **Deny wins everywhere:** lists, search, sidebar, project page, chat pages, chat search, streams, share lists, and every run context. A denied member gets the same 404 as a project that does not exist.

### Sharing a standalone chat

17. **Share dialog:** from the chat's menu in a team organization (hidden in a personal workspace and on project chats). Pick members of the same organization; each gets read-only access. Shows who has access and lets the owner revoke.
18. **Recipient view:** the chat opens read-only: no composer, no edit, regenerate, feedback, rename, delete, or decision controls; a label "Shared by <name> · read-only". F5 panels for pending operations are not shown to recipients; the "Waiting for you" marker reads "Waiting for <owner>".
19. **Where shared chats appear:** a "Shared with me" filter on the Chats page. Recent stays the user's own chats.
20. **Revocation and membership:** revoking or the recipient leaving the organization removes access on the next request; an open stream closes within the revalidation interval.

### Project chats

21. A chat started in a project belongs to that project for life (decision 7) and to its creator.
22. **Run profile:** project chats run under a `project-chat` run profile registered through the existing registry (LEX-ARC-001 §4.7) with the same tools and limits as `chat` plus the project context provider. The engine gets no project parameters or branches.
23. **Capability policy:** a run in a project chat requires that, at start and at every resume, the chat owner still has Editor or Owner on the project and is not denied. Otherwise the run fails with `AI_ACCESS_REVOKED` (the F5 access-loss path, with its `chat.run_finished.v1` audit).
24. **Readers and streams:** project members can open a running project chat and watch it live (read-only), with the same replay behavior as the owner. Readers never see F5 question or approval panels; the waiting marker reads "Waiting for <owner>", as in item 18.
25. Recent and the Chats page list the user's own chats, including their project chats with the project name as secondary text.

### Audit

26. Events, ids and metadata only (K3), never names, numbers, instructions, or chat content:
    - project created, settings updated, instructions updated, deleted (with chat count);
    - member added, role changed, removed;
    - deny added, deny lifted (actor is the organization owner or admin);
    - chat shared, share revoked.
    The F17 views read them later.

## Out of scope

| Item | Slice |
|---|---|
| Documents, folders, uploads in projects | F7 |
| Retrieval over project documents | F8 |
| Project memory | F9 |
| Workflows run in a project | F10 |
| Tabular reviews in projects | F13 |
| Audit views of these events | F17 |
| Ownership transfer, departing-member archive and recovery, break-glass access to private content, retention and legal hold | F18 |
| Moving chats between projects or into/out of a project | Later, on owner request (decision 7) |
| Organization-wide project visibility setting ("all members see all projects") | Later, on owner request (decision 1; LEX-ARC-001 §3.2 revised) |
| Sharing outside the organization, guest access, share links | Not planned for the MVP |
| Collaborative editing of one chat by several people | Not planned for the MVP |
| Full-text search over other people's project or shared chats | F8 (indexed search under RLS, spike S3) |

## User flows

1. **Personal project:** Rina, solo practitioner, creates "PT Sinar — wanprestasi" in her personal workspace, writes instructions ("Answer with references to the Civil Code; Indonesian legal terms in italics"), starts a chat in it. The answer follows the instructions. No member controls appear.
2. **Team project:** Andi (member) creates a matter in "Kantor Hukum Adil", adds Budi as Editor and Citra as Viewer.
   1. Budi starts his own chat in the project and edits the instructions.
   2. Citra opens Budi's chat read-only and watches a live answer; she has no composer.
   3. Dewi (organization admin, not a member) does not see the project in her Matters list.
3. **Ethical wall:** the firm learns Budi once advised the other party.
   1. Dewi opens Organization settings → Matters, finds the project by matter number, restricts access for Budi.
   2. Budi's open project page and chat stream close within the revalidation interval; the project disappears from his lists; his link returns not found.
   3. Budi's own project chat stays in the project, readable by Andi and Citra. A run Budi had in progress fails with "access revoked".
   4. Andi tries to add Budi again: Budi is shown as unavailable ("Access restricted by your organization").
   5. Only Dewi or another owner/admin can lift the restriction.
4. **Share a chat:** Andi shares a standalone chat with Eka read-only. Eka finds it under Chats → Shared with me and cannot type in it. Andi revokes; Eka's next request returns not found.
5. **Delete:** Andi deletes the matter; the dialog says "This deletes 4 chats". After confirming, the project and its chats are gone for everyone.
6. **Edge cases:**
   - A project with no chats; a project whose only chat is running at delete time (fenced, then deleted).
   - The owner tries to share a project chat (no share action).
   - The owner tries to add someone outside the organization (not offered; API refuses).
   - An admin tries to deny the project owner (refused with a message).
   - Two admins deny and lift concurrently (last committed state wins, both audited, no duplicate rows).
   - A viewer calls the start-run or instructions-update route directly (403 for a member without the capability, 404 for a non-member).

## Data and contracts

- **Entities (meaning, not schema):**
  - Project: organization, owner, name, matter number, practice area, instructions, timestamps, last activity.
  - Project member: project, user, role (`viewer` | `editor`); the owner is implied by the project, not a member row.
  - Project deny: project, user, set by, set at. Deny-overrides in every access decision.
  - Chat share: chat (not in a project), recipient, granted by, granted at.
  - Chat: gains an optional project, fixed at creation.
- **One access rule** (`viewer` < `editor` < `owner`, deny wins, organization membership required) implemented once in the authorization predicate builder (LEX-ARC-001 §3.2) and mirrored in RLS. Every list, search, detail, stream, and run-context query uses it; there is no unfiltered path.
- **RLS:** new tables keep FORCE RLS with the `NULLIF` form. Chat, run, and message read policies widen from owner-only to owner OR project access OR share; write policies stay owner-only.
- **`shared/`:** Zod schemas for project create/update, members, denies, chat shares, the Matters list query, the organization metadata list, and the role and capability enums. Error codes reuse the existing error contract (F4.4).
- **Routes (shape, not paths):** projects CRUD and list; project chats list; project instructions update; members list/add/change/remove; organization project metadata list; deny add/lift; chat shares list/add/revoke; "shared with me" list.
- **Events:** the existing chat invalidation channel tells affected clients when access changes (member removed, deny added, share revoked) so lists refresh.

## Non-functional requirements

- **Security and tenancy (negative tests, each at the API and the RLS level):**
  - cross-organization: a member of another organization cannot see or act on any project, chat, member list, deny, or share;
  - cross-project: a member of project A cannot read project B's chats or instructions;
  - role: viewer cannot start chats or edit instructions; editor cannot change settings, members, or delete; non-owner cannot send in another person's chat;
  - deny: a denied member sees nothing on that project through every read path in item 16, including direct ids, search, streams, and a run's context; deny beats editor and beats organization owner/admin;
  - organization owner/admin without membership cannot open chats or instructions (decision 4);
  - platform administrator sees nothing;
  - a removed organization member loses all access.
  - Identical 404 for "does not exist", "not a member", and "denied".
- **Prompt injection:** project instructions are untrusted context. Evals cover instructions that try to rename the chat without approval, reveal another project's content, or claim extra permissions; none has an effect.
- **Privacy:** no K1 (names, matter numbers, instructions, titles, content) in logs, traces, errors, or audit metadata.
- **Performance:** the Matters list and the organization metadata list for an organization with 500 projects and 50 members use indexed equality predicates under RLS (no FTS on these lists; name and matter-number search may use B-tree prefix or trigram on those two columns only, as F4 does for titles). Gate as in F4: blocking = index plan shape, no errors, and p95 < 1,000 ms on the CI runner; p95 above 300 ms is a non-blocking warning.
- **Accessibility:** dialogs and tables keyboard operable, axe passes in both themes.
- **Visual:**
  - Revision 18 states drawn and approved before planning: Matters list (empty, populated, mobile), new matter dialog, project page (owner, editor, viewer), instructions panel, members dialog (with a restricted member), delete confirmation, Organization settings → Matters with the restrict dialog, share dialog, shared chat read-only view, not-found state.
  - Built from the data views kit and the existing chat parts. Capture ids enter `index.json` `planned` with the prototype PR.
- **Process (standing rules):** TDD with RED evidence; draft PR from the first task; every report states the CI result of its head; CI pending is not green; full `pnpm test` and whole-repo `pnpm format:check` before every merge; never weaken assertions; Docker only `lexon-e2e-*` by name; at most 2 Linux UI rounds; one worktree per parallel agent; owner stops before golden writes.

## Research first

- LEX-ARC-001 §3.2, §4.7, §5.1, §6; the F4 brief (ownership, deletion fence), F4.2 (stream revalidation), F5 (access-loss path, capability recompute on resume).
- Current code: `backend/drizzle/0026_chat_tree.sql` and later chat policies, `backend/src/modules/identity-access/tenant.guard.ts`, `backend/src/modules/chat/chat-profiles.ts`, `chat-history-context.ts`, the run registry, and the chat repository's list and search queries.
- PostgreSQL 17 row security policies with several permissive policies and `EXISTS` subqueries: plan shape and index use under FORCE RLS.
- Drizzle ORM at the pinned version for the new tables and migrations.
- Better Auth organization plugin at the pinned version: reading members and roles for the member picker without exposing secret columns.

## Skills to use

`.agents/skills/`: `organization-best-practices`, `better-auth-best-practices`, `shadcn`, `assistant-ui`, `runtime`, `vitest`, `playwright-cli`, `karpathy-guidelines`.

## Acceptance criteria

- [ ] Task 0: the four F5 minors fixed with tests.
- [ ] Projects: create, list (search, filter, sort, paging, empty), sidebar Matters group, project page, settings, instructions, delete with chat cascade and fence.
- [ ] Instructions reach every run in the project through the context provider as untrusted data; a change applies to the next run; instructions cannot grant tools.
- [ ] Members: add, re-role, remove; effects immediate; organization membership required; TenantGuard allowance limited to the member routes.
- [ ] Ethical wall: organization owners/admins list projects as metadata, deny and lift; the project owner cannot lift or re-add; the owner cannot be denied; deny wins on every read path in item 16 and stops a running chat with `AI_ACCESS_REVOKED`.
- [ ] Standalone chat sharing: read-only recipients, Shared with me filter, revoke, no sharing of project chats or across organizations.
- [ ] Project chats: `project-chat` run profile, capability recompute at start and resume, live read-only watching for members.
- [ ] Negative tests: every case in Non-functional → Security, at the API and the RLS level, with identical 404s.
- [ ] Audit events for every item in 26, with no K1.
- [ ] Evals for project-instruction injection in the CI subset.
- [ ] Performance check for the two lists at 500 projects.
- [ ] Revision 18 states approved and captured; the Linux CI comparison sheets reviewed by the owner by eye, at most 2 Linux UI rounds, remaining differences logged as deviations; the new app goldens pass the 1.5% gate.
- [ ] All F0–F5 tests pass; CI green on the final head.

## References

- LEX-ARC-001 §3.2, §4.7, §5.1, §6; LEX-DS-001 v3.5 §4, §5.3, §5.7; LEX-TS-001 v1.14.
- F1 (roles, personal workspace, TenantGuard), F4 (chat ownership, delete fence, search), F4.2 (stream revalidation), F5 (access-loss path, capability policy on resume).

## Open questions

None. The product owner settled scope on 2026-11-25 (decisions 1–9).
