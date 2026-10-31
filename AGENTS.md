# Lexon — agent instructions

Applies to every coding agent (Codex, Claude Code, others). `CLAUDE.md` imports this file.

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

- Work only from `docs/`. Never fetch, clone, browse, or search for the source
  code of any third-party legal AI product, and never check out the
  `brief-generator` branch of this repository (it holds the brief generator's
  clean-room research about an AGPL-3.0 reference product and is never merged
  into `main`).
- If a brief seems to be missing information, ask the human; do not look for
  it elsewhere.

## Research first (mandatory, every slice)

Superpowers does not do library research on its own; this rule adds it.
Before proposing approaches in **brainstorming**, and again before writing
each task in **writing-plans**:

1. Read the slice brief and every `docs/specs/` section it references.
2. Read the **current official documentation** for every library, framework,
   and service the slice touches, at the exact version pinned in LEX-TS-001
   (start from the links in the brief's "Research first" section and from
   `docs/references/`; `node scripts/fetch-docs.mjs <id>` downloads a vendor's
   llms.txt into `.cache/docs/`). Do not rely
   on memory: NestJS 12, Next.js 16, AI SDK 7, Better Auth, BullMQ 6, Zod 4,
   TypeScript 6, and assistant-ui change quickly.
3. Check the installed package versions and their changelogs / migration
   guides when the pinned version is newer than what you know.
4. Record what you verified in a **"Research notes"** section of the
   superpowers spec: source URL, version, date read, and the decision it
   supports. Plans cite these notes instead of guessing APIs.
5. If official docs contradict `docs/specs/`, stop and ask the human; do not
   silently diverge. Library facts may justify a spec revision, never a quiet
   workaround.

## Agent skills

Vendor skills live in `.agents/skills/` (see its README). Use them for
library know-how, but they are advice: `docs/specs/` wins, and the README
lists known conflicts. Do not install new skills yourself; propose them to
the human.

## Conventions

- **English** everywhere: UI copy, errors, emails, code, comments, commit
  messages, reference documents, briefs, superpowers specs, and plans.
- Repo layout follows LEX-ARC-001 §3.4 (`backend/`, `frontend/`, `word-add-in/`,
  `shared/`, `evals/`, `infra/`, `docs/`) at the repository root.
- Pin dependency versions exactly. One TypeScript (6.x) and one Zod (4.x) for
  the whole workspace.
- TDD: no production code without a failing test first.
