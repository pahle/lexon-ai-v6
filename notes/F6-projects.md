# F6 Projects & ethical wall: reference behavior notes (2026-11-25)

Reference @ 1f7ae19. Behavior only, in our words. No code, identifiers, SQL or UI text go to main.

## What a project is
- A container for chats, documents (F7), tabular reviews (F13), and shared project memory (F9). Fields: name, an optional client-matter number, an optional practice area. Creator becomes the project owner.
- Projects can live in the personal workspace (private to the account) or in a team organization.
- List page: paged, searchable by name / matter number / practice, sortable, filter by practice and by "mine / shared with me / private / collaborative". Counts per row (documents, chats, reviews).

## Access model in the reference
- Three project roles, each including the one below: viewer (read everything, watch live answers), editor (chat, upload, edit, organize folders), owner (settings, sharing, delete). One capability table; routes ask for a capability, never compare roles.
- In an organization, projects are private by default: creator + people it was shared with. A per-member override sets Owner/Editor/Viewer or Deny. Deny walls the member off. A project can be made "public", which gives every member Editor.
- Sharing never reaches outside the organization.
- Chats and reviews inside a project inherit the project's access. A chat started outside a project in an organization stays private to its author; standalone chats can also be shared with role-aware grants to members.
- In project chat, write tools follow the caller's PROJECT role: a viewer gets no write tools, and delegated child runs cannot write either.
- Deny is set by whoever manages access on the project (project owner), not by a separate compliance role.

## Organization oversight
- Org owners do not automatically see members' private items. An audited "open private content" path exists for owners and for admins the owner explicitly permits; opening grants read-only access and writes an audit event in the same transaction; audit failure denies access. Closing revokes access; it never deletes.
- When a member leaves, their unshared private items are archived for 30 days; only owners can recover them to a current member or delete them. (Lexon: F18 offboarding/retention.)

## Edge cases seen
- Grant to the creator's own email must be refused (creator already owns).
- A failed read of the creator must fail the grant, not proceed as "no creator".
- Search/listing must apply the same access predicate as detail reads.
- Attachments into a project chat must come from the same workspace.

## Not in the reference
- Project instructions (Lexon roadmap item; reference has only per-user custom instructions and project memory).
- A compliance-level ethical wall that even the project owner cannot lift.
