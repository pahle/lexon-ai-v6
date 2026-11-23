# Playbook: support the implementer during brainstorming and planning

The product owner pastes Codex/superpowers output and asks what to do.

1. Superpowers brainstorming ends each message with **one question** and
   waits. Answer the question; that is normal, not an error.
2. If Codex reports a conflict between official docs and `docs/specs/` or the
   brief: **verify it yourself** against the official source. If Codex is
   right, fix the brief/specs via PR (with a change-history row) and say so;
   if wrong, explain with the source.
3. Recommend one option with reasons, in Indonesian, then give a
   **ready-to-paste English answer** in a code block that:
   - states the decision and the constraints Codex must keep;
   - names the PR that updated the brief/specs, if any;
   - says where it should be recorded (e.g. "answer to brief open question 2").
4. Reviewing the written spec or plan: check every brief item is covered,
   decisions match the documents, layering/boundaries are right, tests are
   real (not mocks where the brief requires real infrastructure), and the
   work stays on a feature branch (never commits to `main`). Approve with an
   explicit list of amendments.
5. Remind the product owner of process points when relevant: work on a
   feature branch, push after each task so you can review incrementally,
   Squash and merge, delete merged branches.

## Model policy for implementer sessions (owner, 2026-11-23)

- Every implementer prompt says: "Run in Fusion (frontier lead + SWE-2
  sidekick): the frontier lead does brainstorming, spec, plan and reviews;
  SWE-2 writes code and tests." Never name an Opus manager or Sonnet
  implementers in a prompt.
- Routine steps (CI checks, merging `main`, lint fixes, worktree cleanup)
  use SWE-2.
- The brief generator runs in Fusion too. Ask the owner to switch to Opus
  only for a heavy decision: the final spec review, a visual approval, a
  security finding, or a debugging dead end.
- Trial: F4.4 task 1 (dependency upgrades). Its review checks that every
  task shows RED -> GREEN evidence (failing command and output before the
  change, passing after), that the spec and quality reviews actually ran and
  their findings were handled, and that every report states the CI result of
  its head. Then recommend to the owner whether Fusion stays for the rest of
  F4.4.

### F4.4 setup (owner, 2026-11-23)

- The owner selects the model with `/fusion` before pasting a prompt (lead
  Claude Opus 5.5 at low effort, sidekick SWE-2). Prompts never set or name
  the model.
- SDD uses Devin's built-in subagents only; no custom subagent files.
  `subagent_general` inherits the parent's Fusion model and is used for
  implementers and task reviewers; `subagent_explore` is router-chosen and
  read-only, for research and reading code and docs. Every implementer
  prompt carries: "Use explore subagents for research and reading; use
  general subagents only for code changes and task reviews."
- Trial evidence: the implementer attaches `/session-stats` output (cost by
  model) before and after F4.4 task 1. The review assesses that cost plus
  the quality of the RED evidence and the reviews, and recommends keep or
  change (for example a medium-effort lead for the final whole-branch
  review).
