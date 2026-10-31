# Playbook: write a slice brief

1. **Sync.** `git fetch origin`; read `STATE.md`, `main`'s
   `docs/briefs/README.md` (slice row, dependencies, cross-cutting rules),
   the three `docs/specs/` documents, and the code on `main` that the slice
   touches (what already exists, what names and interfaces to build on).
2. **Scope questions.** List decisions the documents leave open and that
   change what gets built. Ask the product owner in Indonesian, a few short
   numbered questions. Record them as pending in `STATE.md` until answered.
3. **Reference research (dirty side).** Clone the reference at the pinned
   commit into a scratch directory (never into the repo). Use
   `notes/feature-inventory.md` and `reference/mike-diagrams/` to find the
   relevant routes, pages, and flows. Write behavior notes in
   `notes/F<n>-<name>.md`: user flows, edge cases, permission rules, error
   states. No code, no identifiers, no SQL, no prompt text.
4. **Library research.** Check official docs at the pinned versions
   (`main`: `docs/references/sources.json`, `scripts/fetch-docs.mjs`) for any
   library fact you put in the brief.
5. **Write the brief** on a temporary branch from `origin/main`:
   `docs/briefs/F<n>-<name>.md`, using the template in
   `docs/briefs/README.md` (Goal, Users and permissions, In scope, Out of
   scope, User flows, Data and contracts, Non-functional, Research first,
   Skills to use, Acceptance criteria, References, Open questions).
   - Behaviors are numbered, observable, testable.
   - Every out-of-scope item names the slice that owns it.
   - Include negative tests (cross-tenant, cross-project, unauthorized).
   - Carry relevant follow-ups from `STATE.md`.
   - Use our own words; translate reference behavior into Lexon terms.
6. **Docs drift.** If the slice needs a document change (new decision,
   correction), edit `docs/specs/` in the same PR with a change-history row.
7. **Skills.** If an official vendor skill would help (search the skills.sh
   registry; official orgs only), propose it to the product owner first;
   vendor it into `.agents/skills/` with `skills-lock.json` after reading it.
8. **PR** to `main` (draft, Squash and merge), link it in `STATE.md`, update
   the slice row in `docs/briefs/README.md` (Brief column).
9. Give the product owner the Codex prompt:
   `Brainstorm slice F<n> using docs/briefs/F<n>-<name>.md`.
