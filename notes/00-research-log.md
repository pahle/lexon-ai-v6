# Research log

## Reference snapshot

- Repo: https://github.com/open-legal-products/mike (AGPL-3.0-only)
- Commit studied: `1f7ae19fd1643fd350d564bbdbbe5801611d0765` (2026-10-30)
- Re-clone per session into the scratchpad only:
  `git clone https://github.com/open-legal-products/mike.git && git -C mike checkout 1f7ae19`

## Reference stack (for contrast only — never adopted)

Express backend + Supabase (Postgres, auth, storage) + Bun/npm, Next.js
frontend, Word add-in (webpack), Electron desktop, `packages/contracts`.
Lexon's stack comes only from LEX-TS-001.

## Scope decisions by product owner (2026-10-31)

- In scope beyond the Lexon docs: workflows, playbooks, memory, subagents,
  web research, quick actions, personal data export.
- Out of scope: BYOK (user API keys), desktop app, CourtListener.
- MVP language: English everywhere.

## Session 1 (2026-10-31)

- Read LEX-TS-001 v1.6, LEX-ARC-001 v1.6, the measured design file, and the
  diagram README. Surveyed reference repo layout: backend routers
  (auth, chat, word-chat, models, projects, orgs, project chat, single
  documents, library, tabular review, workflows, quick actions, workflow
  add-ons, user memory, project memory, user, download, documents, audit,
  playbooks, upload sessions), ~48 frontend pages, ~80 SQL migrations.
- Revised docs to v1.7 / DS 1.0 (see change history in each doc).

## Session 1, continued (2026-10-31)

- Product owner approved slices F0–F19 (gaps filled: history, sharing, model
  selection, onboarding, templates, offboarding, org archive, add-in handoff).
- Implementer will be ChatGPT Codex running superpowers; guard is `AGENTS.md`
  on `main` plus this orphan branch (Codex checkouts of `main` never contain
  this material). `main` history was squashed so it never contained it.
- Reference docs in `docs/specs/` stay Indonesian; briefs/specs/plans/app English.
