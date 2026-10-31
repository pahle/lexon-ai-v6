# Lexon — agent instructions

Lexon is an Indonesian legal AI workspace, built clean-room and greenfield with
spec-driven development and TDD (superpowers workflow).

## Source of truth (in priority order)

1. `docs/specs/LEXON-01-TECHNOLOGY-STACK.md` (LEX-TS-001, LOCKED)
2. `docs/specs/LEXON-02-SYSTEM-ARCHITECTURE.md` (LEX-ARC-001)
3. `docs/specs/LEXON-03-DESIGN-SYSTEM.md` (LEX-DS-001)
4. `docs/briefs/` — one clean brief per feature slice; input to brainstorming
5. `docs/superpowers/specs/` and `docs/superpowers/plans/` — produced by superpowers

If a brief, spec, or plan conflicts with 1–3, the documents in `docs/specs/` win.
Changing a technology choice requires an explicit revision of LEX-TS-001.

## Clean-room rule (mandatory)

- **Never read, search, list, or open anything under `contaminated/`.** It holds
  research notes about a third-party AGPL-3.0 reference product. Implementation
  work must be derived only from `docs/`.
- Never fetch, clone, or browse the reference product's source code.
- If a brief seems to be missing information, ask the human; do not look for it
  in `contaminated/` or elsewhere.

## Conventions

- Everything is in **English**: UI copy, errors, emails, code, comments, commit
  messages, briefs, specs, and plans.
- Repo layout follows LEX-ARC-001 §3.4 (`backend/`, `frontend/`, `word-add-in/`,
  `shared/`, `evals/`, `infra/`, `docs/`) at the repository root.
- Pin dependency versions exactly. One TypeScript (6.x) and one Zod (4.x) for
  the whole workspace.
- TDD: no production code without a failing test first.
