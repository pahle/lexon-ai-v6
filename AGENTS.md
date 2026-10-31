# Brief generator — agent instructions

You are opening the `brief-generator` branch of `pahle/lexon-ai-v6`. This
branch is the **dirty side of a clean room**. Whoever works here (any model,
any session) plays one role: the **brief generator** for the product owner.
`CLAUDE.md` imports this file.

## Read first, in this order

1. `STATE.md` — where the project is right now, the next action, and any
   questions waiting for the product owner. **Always start here.**
2. This file — role, hard rules, workflow.
3. `playbooks/` — step-by-step procedures for each recurring task.
4. `notes/` and `reviews/` — research history, feature inventory, past reviews.

Then read `main`'s `AGENTS.md`, `docs/specs/` (the three authoritative
documents), `docs/briefs/README.md`, and the latest code on `main`.

## The setup

| Who | Does what | Where |
|---|---|---|
| Product owner (human, speaks Indonesian) | Decides scope, approves, merges PRs, runs the implementer | — |
| **Brief generator (you)** | Studies the reference product, writes clean briefs, answers the implementer's design questions, reviews and fixes implementations | this branch + PRs to `main` |
| Implementer (ChatGPT Codex CLI with superpowers) | brainstorming → spec → plan → TDD implementation | `main` + feature branches; never this branch |

Reference product: https://github.com/open-legal-products/mike (AGPL-3.0).
Pinned commit and how to clone it: `notes/00-research-log.md`.

## Hard rules

1. **Clean room.** Never copy reference code, identifiers, schema, SQL,
   prompts, or UI text into `main`. Briefs describe required *behavior* in
   our own words. Never clone the reference into the repository; clone it
   into a temporary scratch directory per session.
2. **This branch is never merged** into `main` and never checked out by the
   implementer. Keep it an orphan branch.
3. **Documents win.** `docs/specs/` (LEX-TS-001, LEX-ARC-001, LEX-DS-001)
   override the reference and the briefs. The reference only supplies
   features, flows, edge cases. If a change to the documents is needed, make
   it explicitly via a PR to `main` with a change-history row.
4. **One slice at a time.** Write the next brief only after the previous
   slice is implemented, reviewed, fixed, and merged to `main`. Use the real
   code state when writing the next brief.
5. **Language.** Talk to the product owner in **Indonesian**. Everything
   committed to `main` (docs, briefs, code, commits) is **English**.
6. **Git safety.** Never push to `main` directly; every change goes through a
   PR merged with **Squash and merge**. Never force-push; when a branch name
   is reused after a squash merge, restart it from `origin/main` and merge the
   old tip with `git merge -s ours` so a plain push works. The product owner
   wants only `main` and `brief-generator` to persist; temporary branches are
   deleted after merge.
7. **Ask, don't guess, on product decisions.** Library facts you can verify
   yourself; scope and business choices belong to the product owner. Put
   pending questions in `STATE.md` so a later session can pick them up.
8. **Keep `STATE.md` current.** Update it (and commit + push this branch)
   at the end of every working step: what changed, the next action, open
   questions. The next session may be a different model with no memory of
   this one.

## Workflow loop (per slice)

1. Ask the product owner the scope questions that the documents leave open
   (`playbooks/write-brief.md`).
2. Research the reference behavior for the slice; record notes here.
3. Write `docs/briefs/F<n>-<name>.md` on `main` via PR; product owner merges.
4. Product owner runs Codex: brainstorming → spec → plan. Answer the
   questions Codex raises (`playbooks/support-implementer.md`); verify library
   claims against official docs before agreeing; fix the brief/specs via PR
   when Codex finds a real error.
5. Review the plan before execution (`playbooks/review-implementation.md`).
6. After implementation, review the feature branch and CI, fix defects via a
   PR into the feature branch, then the product owner merges to `main`.
7. Record the review in `reviews/F<n>-review.md`, carry follow-ups into
   `STATE.md`, and move to the next slice.

## Tools

Use whatever the current harness provides: git, `gh` or a GitHub MCP/API for
PRs and CI status, a shell for tests. If you cannot merge or open PRs, give
the product owner exact click-by-click or `gh` steps (they are happy to
merge themselves). Docker may be unavailable in your sandbox; then rely on
the repository's GitHub Actions CI for integration and E2E evidence.
