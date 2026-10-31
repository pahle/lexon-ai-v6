# contaminated/ — clean-room research area

**Implementers (human or agent) must not read this folder.** This branch (`contaminated`) is an orphan branch with no shared history with `main`; implementers never check it out. See `AGENTS.md` on `main`.

This folder holds the "dirty" side of the clean room: notes taken while
studying the reference product (open-legal-products/mike, AGPL-3.0). Its only
outputs are the clean briefs in `docs/briefs/`, which describe required
behavior in our own words with no code, identifiers, schema, or prompts copied
from the reference.

Rules for this folder:

- No source code from the reference is ever committed here or anywhere in the
  repo. The reference is cloned to a temporary scratch directory per session,
  pinned to the commit recorded in `notes/00-research-log.md`.
- Notes describe behavior, user flows, edge cases, and observations.
- `reviews/` records reviews of our implementation against the briefs and the
  reference behavior (findings are translated back into briefs or issues,
  never into code).

| Path | Contents |
|---|---|
| `notes/` | Research log, feature inventory, per-slice behavior notes |
| `reference/mike-diagrams/` | Excalidraw diagrams of the reference, provided by the product owner |
| `reviews/` | Implementation conformance reviews |
